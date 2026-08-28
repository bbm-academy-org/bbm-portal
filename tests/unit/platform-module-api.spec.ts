import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

/**
 * The `/api/p/<slug>/*` handler conventions (spec 311 §5/§6, EARS-436,
 * EARS-461, EARS-462, EARS-472, EARS-473; consolidation §5).
 *
 * This is the FIRST HTTP surface the platform's modules get, so the shape it
 * takes here is the shape #316 and #317 inherit. Three properties are the whole
 * point of having a factory at all rather than a convention in prose:
 *
 * 1. **The gate is not optional.** A handler built by these factories cannot
 *    forget to re-check the claim, because the check happens before the
 *    caller's function is reached (EARS-461, EARS-462). The guard
 *    `pnpm lint:endpoint-authz` then proves no handler is built any other way.
 * 2. **One zod schema on both ends** (EARS-436). The schema that TYPES the
 *    cabinet's data provider is the schema that VALIDATES the handler's input
 *    and its own answer — a handler that returns something else fails here, not
 *    in the browser.
 * 3. **A refusal names its reason** (EARS-472) and a constraint violation is the
 *    module's readable refusal rather than a raw error or a 500 (EARS-473).
 *
 * `@/auth` is mocked wholesale: these assertions are about the frame, and a
 * real Auth.js round-trip would only make them slower and less specific.
 */

const authState: { session: unknown } = { session: null }
vi.mock('@/auth', () => ({ auth: async () => authState.session }))

const anonymous = null
const member = { user: { email: 'Member@BBM.Local', roles: [PLATFORM_USER_ROLE] } }
const admin = { user: { email: 'Admin@BBM.Local', roles: [PLATFORM_ADMIN_ROLE] } }
const legacy = { user: { email: 'old@bbm.local', roles: [], rolesClaimAbsent: true } }

/** The module's own schema — the one thing both ends of EARS-436 share. */
const periodSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  weekdays: z.number().int().min(1).max(7),
})

async function api() {
  return import('@/lib/platform/api')
}

function request(url = 'https://portal.bbm.academy/api/p/hours/admin/periods', init?: RequestInit) {
  return new Request(url, init)
}

beforeEach(() => {
  authState.session = anonymous
  vi.resetModules()
})

describe('EARS-462: a cabinet handler re-checks `platform-admin` before its own code runs', () => {
  async function callAdmin(session: unknown) {
    authState.session = session
    const { adminRoute } = await api()
    const seen: string[] = []
    const GET = adminRoute({
      output: periodSchema,
      handler: async (ctx) => {
        seen.push(ctx.audit.actorEmail ?? '(none)')
        return [{ id: '1', label: 'август 2026', weekdays: 5 }]
      },
    })
    return { res: await GET(request()), seen }
  }

  it('EARS-462: refuses an anonymous caller with a bare 403 and never reaches the handler', async () => {
    const { res, seen } = await callAdmin(anonymous)
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('')
    expect(seen).toEqual([])
  })

  it('EARS-462: refuses a member holding only `platform-user` — the shell is not the gate', async () => {
    const { res, seen } = await callAdmin(member)
    expect(res.status).toBe(403)
    expect(seen).toEqual([])
  })

  it('EARS-462: refuses a session whose token predates the roles claim', async () => {
    const { res } = await callAdmin(legacy)
    expect(res.status).toBe(403)
  })

  it('EARS-462: serves an admin, and hands the handler the signed-in admin as the audit actor', async () => {
    const { res, seen } = await callAdmin(admin)
    expect(res.status).toBe(200)
    // Normalized to the form `core.member.email` is stored in (spec 124
    // EARS-2), so a cabinet write joins to a member by equality.
    expect(seen).toEqual(['admin@bbm.local'])
  })
})

describe('EARS-461: a member-facing handler requires `platform-user` and the entry claim', () => {
  async function callMember(session: unknown, requiredClaim?: string) {
    authState.session = session
    const { memberRoute } = await api()
    const GET = memberRoute({
      requiredClaim,
      output: periodSchema,
      handler: async () => [{ id: '1', label: 'август 2026', weekdays: 5 }],
    })
    return GET(request('https://portal.bbm.academy/api/p/hours/periods'))
  }

  it('EARS-461: refuses an anonymous caller with a bare 403 — a handler never redirects', async () => {
    const res = await callMember(anonymous)
    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull()
  })

  it('EARS-461: serves a plain member — the member half is NOT locked behind the cabinet claim', async () => {
    const res = await callMember(member)
    expect(res.status).toBe(200)
  })

  it('EARS-461: an admin passes the member gate too — `platform-admin` implies `platform-user`', async () => {
    expect((await callMember(admin)).status).toBe(200)
  })

  it('EARS-461: an entry-declared extra claim is enforced fail-closed on top of it', async () => {
    // EARS-466: a claim introduced later is registry data. It costs no frame
    // change — it is passed here and checked here, and nowhere else.
    expect((await callMember(member, 'finance-approve')).status).toBe(403)
    expect(
      (
        await callMember(
          { user: { email: 'f@bbm.local', roles: [PLATFORM_USER_ROLE, 'finance-approve'] } },
          'finance-approve',
        )
      ).status,
    ).toBe(200)
  })
})

describe('EARS-436: one zod schema types the client and validates the handler', () => {
  it('EARS-436: rejects a request body the module schema refuses, naming the field', async () => {
    authState.session = admin
    const { adminRoute } = await api()
    let reached = false
    const POST = adminRoute({
      input: periodSchema.omit({ id: true }),
      output: periodSchema,
      handler: async () => {
        reached = true
        return { id: '1', label: 'x', weekdays: 5 }
      },
    })
    const res = await POST(
      request(undefined, {
        method: 'POST',
        body: JSON.stringify({ label: '', weekdays: 99 }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('bad-request')
    // EARS-472: the failure NAMES the reason. «Что-то пошло не так» is what this
    // assertion exists to keep out.
    expect(body.error.message).toMatch(/label|weekdays/)
    expect(reached).toBe(false)
  })

  it('EARS-436: refuses a handler answer that does not satisfy the module schema', async () => {
    // The half that is easy to skip: validating the INPUT only lets the handler
    // ship a shape the data provider's own parse will reject in the browser.
    authState.session = admin
    const { adminRoute } = await api()
    const GET = adminRoute({
      output: periodSchema,
      // Deliberately the wrong shape. The cast is what a real drift looks like
      // — a handler whose author believed it matched — and the guarantee under
      // test is the RUNTIME one: `tsc` cannot see a handler that changed on the
      // other side of a refactor.
      handler: async () =>
        [{ id: '1', label: 'август' }] as unknown as z.infer<typeof periodSchema>[],
    })
    const res = await GET(request())
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('internal')
  })

  it('EARS-436: a valid single record with `items` and `total` stays a single record', async () => {
    authState.session = admin
    const { adminRoute } = await api()
    const summarySchema = z.object({
      items: z.array(z.string()),
      total: z.number().int().min(0),
    })
    const GET = adminRoute({
      output: summarySchema,
      handler: async () => ({ items: ['active', 'paused'], total: 2 }),
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { items: ['active', 'paused'], total: 2 },
    })
  })

  it('EARS-436: a list answer carries `data` and `total` — the envelope the provider parses', async () => {
    authState.session = admin
    const { adminRoute, listEnvelopeSchema } = await api()
    const GET = adminRoute({
      output: periodSchema,
      handler: async () => [
        { id: '1', label: 'август 2026', weekdays: 5 },
        { id: '2', label: 'сентябрь 2026', weekdays: 5 },
      ],
    })
    const parsed = listEnvelopeSchema(periodSchema).safeParse(await (await GET(request())).json())
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.total).toBe(2)
  })

  it('EARS-436: a paged list preserves the handler total beyond the current page', async () => {
    authState.session = admin
    const { adminRoute, listEnvelopeSchema, moduleListResult } = await api()
    const GET = adminRoute({
      output: periodSchema,
      handler: async () =>
        moduleListResult({
          items: [{ id: '26', label: 'август 2026', weekdays: 5 }],
          total: 57,
        }),
    })

    const response = await GET(request(`${request().url}?page=2&pageSize=1`))
    expect(response.status).toBe(200)

    const parsed = listEnvelopeSchema(periodSchema).safeParse(await response.json())
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).toMatchObject({
      data: [{ id: '26' }],
      total: 57,
    })
  })
})

describe('EARS-473: a refusal the module produces is readable, never a raw error and never a 500', () => {
  it('EARS-473: a ModuleApiError becomes its own status and its own message', async () => {
    authState.session = admin
    const { adminRoute, ModuleApiError } = await api()
    const POST = adminRoute({
      output: periodSchema,
      handler: async () => {
        throw new ModuleApiError(
          'conflict',
          'Алиас mattermost:@anna уже принадлежит участнику a.kovaleva@bbm.academy',
        )
      },
    })
    const res = await POST(request(undefined, { method: 'POST' }))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('conflict')
    expect(body.error.message).toContain('a.kovaleva@bbm.academy')
  })

  it('EARS-473: an UNEXPECTED throw answers 500 with a generic message and leaks no internals', async () => {
    // The other side of the same rule: a raw constraint error is not shown to
    // an admin as prose. It is 500 + a generic line, and the detail stays in
    // the server log — a module that wants a readable refusal raises one.
    authState.session = admin
    const { adminRoute } = await api()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const POST = adminRoute({
      output: periodSchema,
      handler: async () => {
        throw new Error('duplicate key value violates unique constraint "member_alias_uq"')
      },
    })
    const res = await POST(request(undefined, { method: 'POST' }))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('internal')
    expect(body.error.message).not.toContain('member_alias_uq')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('the list query is parsed, not trusted (consolidation §5)', () => {
  it('defaults page/pageSize and clamps a hostile pageSize', async () => {
    const { listQuerySchema } = await api()
    expect(listQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25, order: 'asc' })
    expect(listQuerySchema.safeParse({ pageSize: '100000' }).success).toBe(false)
    expect(listQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({
      page: 3,
      pageSize: 50,
    })
  })
})
