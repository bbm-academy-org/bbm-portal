import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createCabinetDataProvider } from '@/lib/platform/cabinet'

/**
 * The cabinet's HAND-WRITTEN data provider (spec 311 EARS-431, EARS-436,
 * EARS-472, EARS-473; consolidation §6).
 *
 * Refine's own data packages are deliberately not installed: the cabinet talks
 * to `/api/p/<slug>/admin/*`, whose envelope and error taxonomy are this repo's
 * (`src/lib/platform/api/contract.ts`), and a generic REST provider would have
 * to be bent into that shape anyway while hiding where the bend is.
 *
 * `fetch` is injected rather than mocked globally, so every assertion here is
 * about the provider and none is about the environment.
 */

const periodSchema = z.object({ id: z.string(), label: z.string(), weekdays: z.number() })
const schemas = { 'hours.periods': periodSchema }

function provider(reply: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return reply(url, init)
  }) as unknown as typeof fetch
  return { dp: createCabinetDataProvider({ schemas, fetchImpl }), calls }
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('EARS-431: the provider maps Refine’s calls onto /api/p/<slug>/admin/*', () => {
  it('EARS-431: a resource name `<slug>.<resource>` becomes the cabinet URL of D-12', async () => {
    const { dp, calls } = provider(() => ok({ data: [], total: 0 }))
    await dp.getList({ resource: 'hours.periods' })
    expect(calls[0].url).toContain('/api/p/hours/admin/periods')
  })

  it('EARS-431: list query params are the ones the handler parses — page, pageSize, sort, order', async () => {
    const { dp, calls } = provider(() => ok({ data: [], total: 0 }))
    await dp.getList({
      resource: 'hours.periods',
      pagination: { currentPage: 2, pageSize: 50, mode: 'server' },
      sorters: [{ field: 'label', order: 'desc' }],
    })
    const url = new URL(calls[0].url, 'https://portal.bbm.academy')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('pageSize')).toBe('50')
    expect(url.searchParams.get('sort')).toBe('label')
    expect(url.searchParams.get('order')).toBe('desc')
  })

  it('EARS-431: getOne/create/update/deleteOne use the record URL and the right method', async () => {
    const record = { id: '7', label: 'август 2026', weekdays: 5 }
    const { dp, calls } = provider(() => ok({ data: record }))

    await dp.getOne({ resource: 'hours.periods', id: '7' })
    expect(calls[0].url).toContain('/api/p/hours/admin/periods/7')
    expect(calls[0].init?.method ?? 'GET').toBe('GET')

    await dp.create({ resource: 'hours.periods', variables: record })
    expect(calls[1].init?.method).toBe('POST')
    expect(calls[1].url).toMatch(/\/api\/p\/hours\/admin\/periods$/)

    await dp.update({ resource: 'hours.periods', id: '7', variables: record })
    expect(calls[2].init?.method).toBe('PATCH')
    expect(calls[2].url).toContain('/periods/7')

    await dp.deleteOne({ resource: 'hours.periods', id: '7' })
    expect(calls[3].init?.method).toBe('DELETE')
  })
})

describe('EARS-436: the provider parses every answer with the module’s own schema', () => {
  it('EARS-436: a well-formed list comes back typed', async () => {
    const { dp } = provider(() =>
      ok({ data: [{ id: '1', label: 'август 2026', weekdays: 5 }], total: 1 }),
    )
    const res = await dp.getList({ resource: 'hours.periods' })
    expect(res.total).toBe(1)
    expect(res.data[0]).toMatchObject({ label: 'август 2026' })
  })

  it('EARS-436: an answer that drifts from the schema is refused, naming the resource', async () => {
    // The failure this catches is a handler and a client that agree on a URL
    // and disagree on a shape — which without a shared schema is discovered by
    // a blank table, not by an error.
    const { dp } = provider(() => ok({ data: [{ id: '1', label: 'август 2026' }], total: 1 }))
    await expect(dp.getList({ resource: 'hours.periods' })).rejects.toThrow(/hours\.periods/)
  })

  it('EARS-436: a resource with no registered schema is a programming error, not a silent pass', async () => {
    const { dp } = provider(() => ok({ data: [], total: 0 }))
    await expect(dp.getList({ resource: 'members.aliases' })).rejects.toThrow(/members\.aliases/)
  })
})

describe('EARS-472/EARS-473: a refusal reaches the screen as its own reason', () => {
  it('EARS-472: the error envelope’s message becomes the thrown error’s message', async () => {
    const { dp } = provider(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'conflict',
              message: 'Алиас mattermost:@anna уже принадлежит участнику a.kovaleva@bbm.academy',
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
    )
    await expect(dp.create({ resource: 'hours.periods', variables: {} })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('a.kovaleva@bbm.academy'),
    })
  })

  it('EARS-473: a refusal is never rendered as a raw status line with no reason', async () => {
    // A bare 500 page or an empty message is the «что-то пошло не так» the
    // clause forbids: even when the body is unreadable the provider produces a
    // sentence naming the status and the resource.
    const { dp } = provider(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    await expect(dp.getList({ resource: 'hours.periods' })).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringMatching(/502/),
    })
  })

  it('EARS-473: a 403 from the handler surfaces as a refusal, not as an empty list', async () => {
    // The handler re-checks the claim (EARS-462). If the provider swallowed the
    // 403 into `{data: []}` the cabinet would show an empty table and the admin
    // would believe there is nothing there.
    const { dp } = provider(() => new Response(null, { status: 403 }))
    await expect(dp.getList({ resource: 'hours.periods' })).rejects.toMatchObject({
      statusCode: 403,
    })
  })
})

describe('the provider knows where the module surface lives', () => {
  it('getApiUrl is the module API root, not the cabinet route', async () => {
    const { dp } = provider(() => ok({ data: [], total: 0 }))
    expect(dp.getApiUrl()).toBe('/api/p')
  })
})
