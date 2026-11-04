import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getPathMap,
  PATH_MAP_CACHE_TTL_MS,
  pathMapSourceFromEnv,
  primePathMapCache,
  resetPathMapCache,
} from '@/lib/path-map'

/**
 * Review findings on #534 (#533): a failed READ of the private map repo is not
 * a broken FILE — the load result says which one it is, and by what kind
 * (auth / not-found / rate-limit / network / config), so the page can point the
 * member at the right fix. A stale copy says why it is stale; a failure with no
 * copy still waits one TTL before the next GitHub call; a malformed
 * `PATH_MAPS_REPO`/`PATH_MAPS_FILE` is a config error that never reaches
 * GitHub; and task D can prime the cache with what it just wrote.
 * Every GitHub response here is a mocked `fetch` — no network.
 */

const repoRoot = join(import.meta.dirname, '..', '..')
const example = readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8')

const TOKEN = 'github_pat_test_SECRET_value_never_logged'
const ENV = { PATH_MAPS_GITHUB_TOKEN: TOKEN }
const T0 = new Date('2026-11-03T10:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

function contentsResponse(text: string, sha = 'abc123') {
  return new Response(
    JSON.stringify({
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(text, 'utf8').toString('base64'),
      sha,
      path: 'maps/doctor-school.yaml',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function errorResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ message: 'nope' }), { status, headers })
}

const logSpies: ReturnType<typeof vi.spyOn>[] = []

beforeEach(() => {
  resetPathMapCache()
  logSpies.push(
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  )
})

afterEach(() => {
  for (const spy of logSpies) {
    for (const call of spy.mock.calls) {
      const text = call.map((arg: unknown) =>
        arg instanceof Error ? `${arg.message} ${String(arg.cause)}` : String(arg),
      )
      expect(text.join(' ')).not.toContain(TOKEN)
    }
    spy.mockRestore()
  }
  logSpies.length = 0
})

describe('getPathMap — a read failure is not a file error', () => {
  it('marks a 401 as a read failure of kind auth, not a parse failure', async () => {
    const loaded = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(401)),
      now: T0,
    })
    expect(loaded.ok).toBe(false)
    expect(loaded.failure).toMatchObject({ kind: 'read', reason: 'auth' })
  })

  it.each([
    [403, {}, 'auth'],
    [404, {}, 'not-found'],
    [429, { 'retry-after': '60' }, 'rate-limit'],
    [403, { 'x-ratelimit-remaining': '0' }, 'rate-limit'],
    [502, {}, 'network'],
  ] as const)('maps HTTP %i %o to read failure %s', async (status, headers, reason) => {
    const loaded = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(status, headers)),
      now: T0,
    })
    expect(loaded.failure).toMatchObject({ kind: 'read', reason })
  })

  it('a thrown fetch is a network read failure', async () => {
    const loaded = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
      now: T0,
    })
    expect(loaded.failure).toMatchObject({ kind: 'read', reason: 'network' })
  })

  it('an invalid remote file is a parse failure', async () => {
    const loaded = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => contentsResponse('title: [unclosed')),
      now: T0,
    })
    expect(loaded.failure).toEqual({ kind: 'parse' })
  })

  it('a valid map carries no failure', async () => {
    const loaded = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => contentsResponse(example)),
      now: T0,
    })
    expect(loaded.failure).toBeUndefined()
  })
})

describe('getPathMap — the stale copy names why it is stale', () => {
  async function staleAfter(response: () => Response) {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(contentsResponse(example, 'sha-good'))
      .mockImplementation(async () => response())
    await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    return getPathMap({ env: ENV, fetch: fetchMock, now: at(PATH_MAP_CACHE_TTL_MS + 1) })
  }

  it.each([
    ['502', () => errorResponse(502), 'network'],
    ['429', () => errorResponse(429, { 'retry-after': '60' }), 'rate-limit'],
    ['401', () => errorResponse(401), 'auth'],
    ['403', () => errorResponse(403), 'auth'],
    ['404', () => errorResponse(404), 'not-found'],
  ] as const)('%s: serves the last good copy with staleReason %s', async (_, response, reason) => {
    const loaded = await staleAfter(response)
    expect(loaded.ok).toBe(true)
    expect(loaded.stale).toBe(true)
    expect(loaded.staleReason).toBe(reason)
    expect(loaded.sha).toBe('sha-good')
  })

  it('a fresh map has no staleReason', async () => {
    const loaded = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => contentsResponse(example)),
      now: T0,
    })
    expect(loaded.staleReason).toBeUndefined()
  })

  it('inside the TTL the stale copy keeps its reason without refetching', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(contentsResponse(example))
      .mockResolvedValue(errorResponse(401))
    await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    await getPathMap({ env: ENV, fetch: fetchMock, now: at(PATH_MAP_CACHE_TTL_MS + 1) })
    const again = await getPathMap({
      env: ENV,
      fetch: fetchMock,
      now: at(PATH_MAP_CACHE_TTL_MS + 2),
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(again.staleReason).toBe('auth')
  })
})

describe('getPathMap — a failure with no copy still waits one TTL', () => {
  it('does not refetch on every view while GitHub keeps failing', async () => {
    const fetchMock = vi.fn(async () => errorResponse(401))
    await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    const again = await getPathMap({ env: ENV, fetch: fetchMock, now: at(1_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The remembered failure is still reported as what it was.
    expect(again.failure).toMatchObject({ kind: 'read', reason: 'auth' })

    await getPathMap({ env: ENV, fetch: fetchMock, now: at(PATH_MAP_CACHE_TTL_MS + 1) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('recovers on the first retry after the TTL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(502))
      .mockResolvedValue(contentsResponse(example, 'sha-back'))
    await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    const back = await getPathMap({
      env: ENV,
      fetch: fetchMock,
      now: at(PATH_MAP_CACHE_TTL_MS + 1),
    })
    expect(back.ok).toBe(true)
    expect(back.sha).toBe('sha-back')
    expect(back.failure).toBeUndefined()
  })
})

describe('pathMapSourceFromEnv — malformed config', () => {
  it.each([
    [{ PATH_MAPS_REPO: '../..' }],
    [{ PATH_MAPS_REPO: 'acme/..' }],
    [{ PATH_MAPS_REPO: './maps' }],
    [{ PATH_MAPS_REPO: 'acme' }],
    [{ PATH_MAPS_REPO: 'acme/maps/extra' }],
    [{ PATH_MAPS_FILE: '../../../user' }],
    [{ PATH_MAPS_FILE: 'maps/../secrets.yaml' }],
    [{ PATH_MAPS_FILE: 'maps/./doctor-school.yaml' }],
    [{ PATH_MAPS_FILE: 'maps//doctor-school.yaml' }],
    [{ PATH_MAPS_FILE: 'maps\\doctor-school.yaml' }],
  ])('%o is a config error, never a GitHub source', (extra) => {
    const source = pathMapSourceFromEnv({ ...ENV, ...extra }, { fetch: vi.fn() })
    expect(source.kind).toBe('misconfigured')
    expect(source.origin.kind).not.toBe('github')
  })

  it('the page shows a config read failure and calls nobody', async () => {
    const fetchMock = vi.fn()
    const loaded = await getPathMap({
      env: { ...ENV, PATH_MAPS_FILE: 'maps/../x.yaml' },
      fetch: fetchMock,
      now: T0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loaded.ok).toBe(false)
    expect(loaded.failure).toMatchObject({ kind: 'read', reason: 'config' })
    expect(loaded.origin.kind).toBe('misconfigured')
    if (!loaded.ok) expect(loaded.errors.join('\n')).toMatch(/PATH_MAPS_FILE/)
  })

  it('a well-formed config is a GitHub source; no token is a local one', () => {
    expect(pathMapSourceFromEnv(ENV).kind).toBe('github')
    expect(pathMapSourceFromEnv({}).kind).toBe('local')
  })
})

describe('primePathMapCache — task D primes the cache after its own write', () => {
  const ORIGIN = {
    kind: 'github',
    repo: 'bbm-academy-org/path-maps',
    path: 'maps/doctor-school.yaml',
  } as const

  it('the next read inside the TTL serves the primed text and sha without a fetch', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(example, 'sha-old'))
    await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })

    primePathMapCache(ORIGIN, { content: example, sha: 'sha-written' }, at(5_000))
    const loaded = await getPathMap({ env: ENV, fetch: fetchMock, now: at(6_000) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(loaded.sha).toBe('sha-written')
    expect(loaded.stale).toBe(false)
    expect(loaded.asOf).toBe(at(5_000).toISOString())
  })

  it('a failing read after the write falls back to the written copy, not the pre-write one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(contentsResponse(example, 'sha-old'))
      .mockResolvedValue(errorResponse(502))
    await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    primePathMapCache(ORIGIN, { content: example, sha: 'sha-written' }, at(5_000))

    const loaded = await getPathMap({
      env: ENV,
      fetch: fetchMock,
      now: at(5_000 + PATH_MAP_CACHE_TTL_MS + 1),
    })
    expect(loaded.stale).toBe(true)
    expect(loaded.sha).toBe('sha-written')
  })

  it('clears a remembered failure', async () => {
    const fetchMock = vi.fn(async () => errorResponse(502))
    await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    primePathMapCache(ORIGIN, { content: example, sha: 'sha-written' }, at(1_000))
    const loaded = await getPathMap({ env: ENV, fetch: fetchMock, now: at(2_000) })
    expect(loaded.ok).toBe(true)
    expect(loaded.failure).toBeUndefined()
    expect(loaded.sha).toBe('sha-written')
  })

  it('a read that was in flight before the write does not overwrite the primed copy', async () => {
    let release: (r: Response) => void = () => {}
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )
    const pending = getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    primePathMapCache(ORIGIN, { content: example, sha: 'sha-written' }, at(1))
    release(contentsResponse(example, 'sha-before-write'))
    await pending

    const loaded = await getPathMap({ env: ENV, fetch: fetchMock, now: at(2) })
    expect(loaded.sha).toBe('sha-written')
  })
})
