import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

const routeState = vi.hoisted(() => ({
  session: null as unknown,
  audit: null as unknown,
  members: [] as Array<Record<string, unknown>>,
  aliases: [] as Array<Record<string, unknown>>,
  conflict: null as Error | null,
  resolvedAliasConflict: null as Error | null,
}))

vi.mock('@/auth', () => ({ auth: async () => routeState.session }))

vi.mock('@/lib/platform/db/transaction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform/db/transaction')>()
  return {
    ...actual,
    platformTransaction: async (
      audit: unknown,
      write: (tx: Record<string, never>) => Promise<unknown>,
    ) => {
      routeState.audit = audit
      return write({})
    },
  }
})

vi.mock('@/lib/member', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/member')>()
  return {
    ...actual,
    listMembers: vi.fn(async () => routeState.members),
    getMemberById: vi.fn(async (id: number) =>
      routeState.members.find((member) => member.id === id),
    ),
    createMember: vi.fn(async (_input: unknown, options: unknown) => {
      if (routeState.conflict) throw routeState.conflict
      expect(options).toEqual({ db: {} })
      return routeState.members[0]
    }),
    updateMemberProfile: vi.fn(async (id: number, input: unknown, options: unknown) => {
      expect(options).toEqual({ db: {} })
      const found = routeState.members.find((member) => member.id === id)
      return found ? { ...found, ...(input as object) } : null
    }),
    listAliases: vi.fn(async (memberId: number) =>
      routeState.aliases.filter((alias) => alias.memberId === memberId),
    ),
    createMemberAlias: vi.fn(async (_memberId: number, _input: unknown, options: unknown) => {
      if (routeState.conflict) throw routeState.conflict
      expect(options).toEqual({ db: {} })
      return routeState.aliases[0]
    }),
    updateMemberAlias: vi.fn(
      async (_memberId: number, aliasId: number, input: unknown, options: unknown) => {
        expect(options).toEqual({ db: {} })
        const found = routeState.aliases.find((alias) => alias.id === aliasId)
        return found ? { ...found, ...(input as object) } : null
      },
    ),
    deleteMemberAlias: vi.fn(async (_memberId: number, aliasId: number, options: unknown) => {
      expect(options).toEqual({ db: {} })
      return routeState.aliases.find((alias) => alias.id === aliasId) ?? null
    }),
    resolveMemberAliasUniqueConflict: vi.fn(async () => {
      if (!routeState.resolvedAliasConflict) throw new Error('missing resolved alias conflict')
      return routeState.resolvedAliasConflict
    }),
  }
})

const admin = { user: { email: ' ADMIN@bbm.local ', roles: [PLATFORM_ADMIN_ROLE] } }
const memberOnly = { user: { email: 'member@bbm.local', roles: [PLATFORM_USER_ROLE] } }
const now = new Date('2026-08-29T06:00:00.000Z')

function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`https://portal.bbm.academy${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const segment = (params: Record<string, string>) => ({ params: Promise.resolve(params) })

beforeEach(async () => {
  routeState.session = admin
  routeState.audit = null
  routeState.conflict = null
  routeState.resolvedAliasConflict = null
  routeState.members = [
    {
      id: 7,
      slug: 'anna',
      email: 'anna@bbm.local',
      name: 'Анна',
      role: 'Куратор',
      status: 'active',
      timezone: 'Europe/Moscow',
      createdAt: now,
      updatedAt: now,
    },
  ]
  routeState.aliases = [{ id: 11, memberId: 7, kind: 'mattermost', value: 'anna', note: null }]
  vi.resetModules()
})

describe('member cabinet HTTP surface (spec 311 EARS-441..445)', () => {
  it('EARS-462: every members handler re-checks platform-admin', async () => {
    const { GET } = await import('@/app/(platform)/api/p/member/admin/members/route')
    routeState.session = null
    expect((await GET(request('/api/p/member/admin/members'))).status).toBe(403)
    routeState.session = memberOnly
    expect((await GET(request('/api/p/member/admin/members'))).status).toBe(403)
  })

  it('EARS-441: list searches, sorts, paginates and serializes dates', async () => {
    routeState.members.unshift({
      ...routeState.members[0],
      id: 8,
      slug: 'boris',
      email: 'boris@bbm.local',
      name: 'Борис',
    })
    const { GET } = await import('@/app/(platform)/api/p/member/admin/members/route')
    const response = await GET(
      request('/api/p/member/admin/members?q=anna&sort=name&order=desc&page=1&pageSize=1'),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      total: 1,
      data: [{ id: 7, createdAt: now.toISOString(), updatedAt: now.toISOString() }],
    })
  })

  it('sorts numeric member ids numerically by default', async () => {
    routeState.members = [10, 2, 1].map((id) => ({
      ...routeState.members[0],
      id,
      slug: `member-${id}`,
      email: `member-${id}@bbm.local`,
    }))
    const { GET } = await import('@/app/(platform)/api/p/member/admin/members/route')

    const response = await GET(request('/api/p/member/admin/members?pageSize=50'))
    const body = (await response.json()) as { data: Array<{ id: number }> }

    expect(body.data.map(({ id }) => id)).toEqual([1, 2, 10])
  })

  it('EARS-441/439: create validates input and attributes its transaction', async () => {
    const { POST } = await import('@/app/(platform)/api/p/member/admin/members/route')
    const invalid = await POST(request('/api/p/member/admin/members', 'POST', { name: '' }))
    expect(invalid.status).toBe(400)

    const response = await POST(
      request('/api/p/member/admin/members', 'POST', {
        name: 'Анна',
        email: 'anna@bbm.local',
      }),
    )
    expect(response.status).toBe(200)
    expect(routeState.audit).toEqual({ actorEmail: 'admin@bbm.local', source: 'portal' })
  })

  it('EARS-443: record update rejects email and member DELETE does not exist', async () => {
    const route = await import('@/app/(platform)/api/p/member/admin/members/[id]/route')
    expect((route as Record<string, unknown>).DELETE).toBeUndefined()
    const response = await route.PATCH(
      request('/api/p/member/admin/members/7', 'PATCH', { email: 'other@bbm.local' }),
      segment({ id: '7' }),
    )
    expect(response.status).toBe(400)
  })

  it('EARS-441: a missing or malformed member id is an actionable 404/400', async () => {
    const { GET } = await import('@/app/(platform)/api/p/member/admin/members/[id]/route')
    expect(
      (await GET(request('/api/p/member/admin/members/nope'), segment({ id: 'nope' }))).status,
    ).toBe(400)
    expect(
      (await GET(request('/api/p/member/admin/members/99'), segment({ id: '99' }))).status,
    ).toBe(404)
  })

  it('EARS-444: aliases support nested list/create/update/delete', async () => {
    const collection =
      await import('@/app/(platform)/api/p/member/admin/members/[id]/aliases/route')
    const item =
      await import('@/app/(platform)/api/p/member/admin/members/[id]/aliases/[aliasId]/route')
    expect(
      (await collection.GET(request('/api/p/member/admin/members/7/aliases'), segment({ id: '7' })))
        .status,
    ).toBe(200)
    expect(
      (
        await collection.POST(
          request('/api/p/member/admin/members/7/aliases', 'POST', {
            kind: 'mattermost',
            value: 'anna',
          }),
          segment({ id: '7' }),
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await item.PATCH(
          request('/api/p/member/admin/members/7/aliases/11', 'PATCH', {
            kind: 'telegram',
            value: 'anna_bbm',
          }),
          segment({ id: '7', aliasId: '11' }),
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await item.DELETE(
          request('/api/p/member/admin/members/7/aliases/11', 'DELETE'),
          segment({ id: '7', aliasId: '11' }),
        )
      ).status,
    ).toBe(200)
  })

  it('EARS-444: a normalized alias collision is returned as 409 with the owner named', async () => {
    const { MemberConflictError } = await import('@/lib/member')
    routeState.conflict = new MemberConflictError(
      'Алиас (mattermost) «anna» уже принадлежит участнику «Анна».',
    )
    const { POST } = await import('@/app/(platform)/api/p/member/admin/members/[id]/aliases/route')
    const response = await POST(
      request('/api/p/member/admin/members/7/aliases', 'POST', {
        kind: 'mattermost',
        value: 'ANNA',
      }),
      segment({ id: '7' }),
    )
    expect(response.status).toBe(409)
    expect(JSON.stringify(await response.json())).toContain('Анна')
  })

  it('EARS-444: an alias index race is explained only after its transaction rejects', async () => {
    const { MemberAliasUniqueConflictError, MemberConflictError } = await import('@/lib/member')
    routeState.conflict = new MemberAliasUniqueConflictError('mattermost', 'anna')
    routeState.resolvedAliasConflict = new MemberConflictError(
      'Алиас (mattermost) «anna» уже принадлежит участнику «Анна».',
      { member: routeState.members[0] as unknown as import('@/lib/member').Member },
    )
    const { POST } = await import('@/app/(platform)/api/p/member/admin/members/[id]/aliases/route')
    const response = await POST(
      request('/api/p/member/admin/members/7/aliases', 'POST', {
        kind: 'mattermost',
        value: 'anna',
      }),
      segment({ id: '7' }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining('Анна'),
        details: { memberId: 7, memberName: 'Анна' },
      }),
    })
  })
})
