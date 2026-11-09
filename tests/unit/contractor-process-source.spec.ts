// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONTRACTOR_PROCESS_CACHE_TTL_MS,
  CONTRACTOR_PROCESS_EXAMPLE_FILE,
  CONTRACTOR_PROCESS_REMOTE_FILE,
  getContractorProcess,
  resetContractorProcessCache,
} from '@/lib/contractor-process'
import { getPathMap, resetPathMapCache } from '@/lib/path-map'

/**
 * Where «Как работаем с исполнителями» (#545) gets its data. The real process
 * lives in the PRIVATE repo `bbm-academy-org/path-maps` at
 * `processes/contractors.json`, read through the path map's GitHub source with
 * the same `PATH_MAPS_*` env; without a token the page shows the public example
 * committed here. Every GitHub response is a mocked `fetch` — no network — and
 * time is an explicit `now`, never a fake timer.
 */

const repoRoot = join(import.meta.dirname, '..', '..')
const processJson = readFileSync(
  join(repoRoot, 'tests/fixtures/contractor-process/full-shape.json'),
  'utf8',
)
const pathMapYaml = readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8')

const TOKEN = 'github_pat_test_SECRET_value_never_logged'
const ENV = { PATH_MAPS_GITHUB_TOKEN: TOKEN }
const T0 = new Date('2026-11-09T10:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const PROCESS_URL =
  'https://api.github.com/repos/bbm-academy-org/path-maps/contents/processes/contractors.json'

function contentsResponse(text: string, sha = 'abc123') {
  return new Response(
    JSON.stringify({
      type: 'file',
      encoding: 'base64',
      // GitHub wraps base64 at 60 columns; the decoder must not care.
      content: Buffer.from(text, 'utf8')
        .toString('base64')
        .replace(/(.{60})/g, '$1\n'),
      sha,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/**
 * The two 200 answers of the contents API that are NOT a readable file: a
 * directory (an array of entries) and a file over 1 MB (`encoding: "none"`,
 * empty `content`). Both are `not-a-file` in the shared client.
 */
function notAFileResponse(kind: 'directory' | 'too-large') {
  const body =
    kind === 'directory'
      ? [{ type: 'file', name: 'contractors.json', path: 'processes/contractors.json' }]
      : { type: 'file', encoding: 'none', content: '', sha: 'big', size: 2_000_000 }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ message: 'nope' }), { status, headers })
}

const logSpies: ReturnType<typeof vi.spyOn>[] = []

beforeEach(() => {
  resetContractorProcessCache()
  resetPathMapCache()
  logSpies.push(
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'info').mockImplementation(() => {}),
    vi.spyOn(console, 'log').mockImplementation(() => {}),
  )
})

afterEach(() => {
  // The token must never reach a log line, whatever the scenario.
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

describe('getContractorProcess — the GitHub source (token present)', () => {
  it('reads processes/contractors.json from bbm-academy-org/path-maps with the token', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(processJson, 'sha-1'))
    const loaded = await getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(PROCESS_URL)
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('accept')).toBe('application/vnd.github+json')

    expect(loaded.ok ? [] : loaded.errors).toEqual([])
    if (!loaded.ok) return
    expect(loaded.process.lanes).toHaveLength(5)
    expect(loaded.failure).toBeUndefined()
    expect(loaded.origin).toEqual({
      kind: 'github',
      repo: 'bbm-academy-org/path-maps',
      path: CONTRACTOR_PROCESS_REMOTE_FILE,
    })
    expect(loaded.stale).toBe(false)
    expect(loaded.staleReason).toBeUndefined()
    expect(loaded.asOf).toBe(T0.toISOString())
    expect(loaded.file).toContain('bbm-academy-org/path-maps')
    expect(loaded.file).toContain(CONTRACTOR_PROCESS_REMOTE_FILE)
  })

  it('honours PATH_MAPS_REPO and PATH_MAPS_BRANCH; the file path is fixed, PATH_MAPS_FILE is ignored', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(processJson))
    const loaded = await getContractorProcess({
      env: {
        ...ENV,
        PATH_MAPS_REPO: 'acme/maps',
        PATH_MAPS_BRANCH: 'draft',
        PATH_MAPS_FILE: 'maps/other.yaml',
      },
      fetch: fetchMock,
      now: T0,
    })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe(
      'https://api.github.com/repos/acme/maps/contents/processes/contractors.json?ref=draft',
    )
    expect(loaded.origin).toEqual({
      kind: 'github',
      repo: 'acme/maps',
      path: CONTRACTOR_PROCESS_REMOTE_FILE,
      branch: 'draft',
    })
  })

  it('a malformed PATH_MAPS_REPO is a config error and sends the token nowhere', async () => {
    const fetchMock = vi.fn()
    const loaded = await getContractorProcess({
      env: { ...ENV, PATH_MAPS_REPO: 'https://evil.example/x' },
      fetch: fetchMock,
      now: T0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    if (loaded.ok) throw new Error('a misconfigured source must not render')
    expect(loaded.failure).toMatchObject({ kind: 'read', reason: 'config' })
    expect(loaded.origin.kind).toBe('misconfigured')
    expect(loaded.errors.join('\n')).toMatch(/PATH_MAPS_REPO/)
  })

  it('invalid remote data is a parse failure with the field path, named against the repo', async () => {
    const broken = JSON.parse(processJson) as { steps: { lane: string }[] }
    broken.steps[0].lane = 'nowhere'
    const loaded = await getContractorProcess({
      env: ENV,
      fetch: vi.fn(async () => contentsResponse(JSON.stringify(broken))),
      now: T0,
    })
    if (loaded.ok) throw new Error('invalid data must not render')
    expect(loaded.failure).toEqual({ kind: 'parse' })
    expect(loaded.errors).toEqual(['steps[0].lane: дорожки «nowhere» нет в lanes'])
    expect(loaded.file).toContain('bbm-academy-org/path-maps')
  })

  it('turns a 404 into a readable Russian error naming the repo and path', async () => {
    const loaded = await getContractorProcess({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(404)),
      now: T0,
    })
    if (loaded.ok) throw new Error('a 404 must not render')
    expect(loaded.failure).toMatchObject({ kind: 'read', reason: 'not-found' })
    const text = loaded.errors.join('\n')
    expect(text).toMatch(/не найден/)
    expect(text).toContain('bbm-academy-org/path-maps')
    expect(text).toContain(CONTRACTOR_PROCESS_REMOTE_FILE)
    expect(loaded.stale).toBe(false)
  })

  it('a 401 is an access-token error, and the token itself is not in it', async () => {
    const loaded = await getContractorProcess({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(401)),
      now: T0,
    })
    if (loaded.ok) throw new Error('a 401 must not render')
    expect(loaded.failure).toMatchObject({ kind: 'read', reason: 'auth' })
    expect(loaded.errors.join('\n')).toMatch(/токен/)
    expect(loaded.errors.join('\n')).not.toContain(TOKEN)
  })

  it('a plain 403 is a permissions error, not a rate limit', async () => {
    const loaded = await getContractorProcess({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(403, { 'x-ratelimit-remaining': '4999' })),
      now: T0,
    })
    if (loaded.ok) throw new Error('a 403 must not render')
    expect(loaded.failure).toMatchObject({ kind: 'read', reason: 'auth' })
    expect(loaded.errors.join('\n')).toMatch(/прав/)
    expect(loaded.errors.join('\n')).not.toMatch(/лимит/)
  })

  it('recognises the GitHub rate limit (403 + x-ratelimit-remaining: 0, and 429)', async () => {
    const limited = await getContractorProcess({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(403, { 'x-ratelimit-remaining': '0' })),
      now: T0,
    })
    if (limited.ok) throw new Error('a rate limit must not render')
    expect(limited.failure).toMatchObject({ kind: 'read', reason: 'rate-limit' })
    expect(limited.errors.join('\n')).toMatch(/лимит/)

    resetContractorProcessCache()
    const tooMany = await getContractorProcess({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(429, { 'retry-after': '60' })),
      now: T0,
    })
    if (tooMany.ok) throw new Error('a 429 must not render')
    expect(tooMany.failure).toMatchObject({ kind: 'read', reason: 'rate-limit' })
  })
})

describe('getContractorProcess — a path that is not a readable file', () => {
  it.each(['directory', 'too-large'] as const)(
    'a %s is its own `not-a-file` failure, not a config error',
    async (kind) => {
      const loaded = await getContractorProcess({
        env: ENV,
        fetch: vi.fn(async () => notAFileResponse(kind)),
        now: T0,
      })
      if (loaded.ok) throw new Error('a non-file must not render')
      expect(loaded.failure).toMatchObject({ kind: 'read', reason: 'not-a-file' })
      expect(loaded.stale).toBe(false)
    },
  )

  it('a stale copy after a `not-a-file` read keeps that reason', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(contentsResponse(processJson))
      .mockResolvedValueOnce(notAFileResponse('too-large'))
    await getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 })
    const stale = await getContractorProcess({
      env: ENV,
      fetch: fetchMock,
      now: at(CONTRACTOR_PROCESS_CACHE_TTL_MS + 1),
    })
    expect(stale.ok).toBe(true)
    expect(stale.stale).toBe(true)
    expect(stale.staleReason).toBe('not-a-file')
  })
})

describe('getContractorProcess — its own cache', () => {
  it('serves the cached copy inside the TTL and refetches after it', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(processJson))
    await getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 })
    const second = await getContractorProcess({
      env: ENV,
      fetch: fetchMock,
      now: at(CONTRACTOR_PROCESS_CACHE_TTL_MS - 1),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.ok).toBe(true)
    expect(second.stale).toBe(false)
    expect(second.asOf).toBe(T0.toISOString())

    await getContractorProcess({
      env: ENV,
      fetch: fetchMock,
      now: at(CONTRACTOR_PROCESS_CACHE_TTL_MS + 1),
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('collapses parallel requests into one GitHub fetch', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(processJson))
    await Promise.all([
      getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 }),
      getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 }),
      getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the last good copy, flagged stale with the reason, when GitHub fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(contentsResponse(processJson))
      .mockResolvedValue(errorResponse(502))
    await getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 })

    const stale = await getContractorProcess({
      env: ENV,
      fetch: fetchMock,
      now: at(CONTRACTOR_PROCESS_CACHE_TTL_MS + 1),
    })
    expect(stale.ok).toBe(true)
    expect(stale.failure).toBeUndefined()
    expect(stale.stale).toBe(true)
    expect(stale.staleReason).toBe('network')
    expect(stale.asOf).toBe(T0.toISOString())

    // During the outage retries are limited to one per TTL.
    await getContractorProcess({
      env: ENV,
      fetch: fetchMock,
      now: at(CONTRACTOR_PROCESS_CACHE_TTL_MS + 2),
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('the stale reason follows the failure: a revoked token reads as auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(contentsResponse(processJson))
      .mockResolvedValue(errorResponse(401))
    await getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 })
    const stale = await getContractorProcess({
      env: ENV,
      fetch: fetchMock,
      now: at(CONTRACTOR_PROCESS_CACHE_TTL_MS + 1),
    })
    expect(stale.stale).toBe(true)
    expect(stale.staleReason).toBe('auth')
  })

  it('a network failure with no cached copy is a read error, remembered until the TTL runs out', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const loaded = await getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 })
    if (loaded.ok) throw new Error('a network failure must not render')
    expect(loaded.failure).toMatchObject({ kind: 'read', reason: 'network' })
    expect(loaded.errors.join('\n')).toMatch(/GitHub/)
    expect(loaded.stale).toBe(false)

    await getContractorProcess({ env: ENV, fetch: fetchMock, now: at(1_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a changed repo/branch is another file: the old copy is not served for it', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(processJson))
    await getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 })
    await getContractorProcess({
      env: { ...ENV, PATH_MAPS_BRANCH: 'draft' },
      fetch: fetchMock,
      now: at(1_000),
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('getContractorProcess — the local fallback (no token)', () => {
  it('reads the public example from the repo and never calls GitHub', async () => {
    const fetchMock = vi.fn()
    const loaded = await getContractorProcess({
      env: {},
      fetch: fetchMock,
      now: T0,
      root: repoRoot,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loaded.origin).toEqual({ kind: 'local', path: CONTRACTOR_PROCESS_EXAMPLE_FILE })
    expect(loaded.file).toBe(CONTRACTOR_PROCESS_EXAMPLE_FILE)
    expect(loaded.ok ? [] : loaded.errors).toEqual([])
    expect(loaded.stale).toBe(false)
    expect(loaded.asOf).toBe(T0.toISOString())
  })

  it('a blank token counts as absent', async () => {
    const fetchMock = vi.fn()
    const loaded = await getContractorProcess({
      env: { PATH_MAPS_GITHUB_TOKEN: '  ' },
      fetch: fetchMock,
      now: T0,
      root: repoRoot,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loaded.origin.kind).toBe('local')
  })

  it('a missing local file is a read error naming the file, not a throw', async () => {
    const loaded = await getContractorProcess({
      env: {},
      now: T0,
      root: join(repoRoot, 'does-not-exist'),
    })
    if (loaded.ok) throw new Error('a missing file must not render')
    expect(loaded.failure).toMatchObject({ kind: 'read', reason: 'local' })
    expect(loaded.errors.join('\n')).toContain(CONTRACTOR_PROCESS_EXAMPLE_FILE)
  })
})

describe('the two caches live side by side', () => {
  /** One fetch serving both files, the way one GitHub token reads one repo. */
  function routedFetch() {
    return vi.fn(async (url: string) =>
      url.includes('/contents/processes/contractors.json')
        ? contentsResponse(processJson, 'sha-process')
        : contentsResponse(pathMapYaml, 'sha-map'),
    )
  }
  const calls = (mock: ReturnType<typeof routedFetch>, needle: string) =>
    mock.mock.calls.filter(([url]) => url.includes(needle)).length

  it('reading the path map and the process in turn evicts neither copy', async () => {
    const fetchMock = routedFetch()

    const map1 = await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    const process1 = await getContractorProcess({ env: ENV, fetch: fetchMock, now: at(1_000) })
    const map2 = await getPathMap({ env: ENV, fetch: fetchMock, now: at(2_000) })
    const process2 = await getContractorProcess({ env: ENV, fetch: fetchMock, now: at(3_000) })

    expect(map1.ok && map2.ok).toBe(true)
    expect(process1.ok && process2.ok).toBe(true)
    expect(map2.sha).toBe('sha-map')
    expect(calls(fetchMock, '/contents/maps/doctor-school.yaml')).toBe(1)
    expect(calls(fetchMock, '/contents/processes/contractors.json')).toBe(1)
  })

  it("resetting the process cache leaves the path map's copy in place", async () => {
    const fetchMock = routedFetch()
    await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    await getContractorProcess({ env: ENV, fetch: fetchMock, now: T0 })

    resetContractorProcessCache()
    await getPathMap({ env: ENV, fetch: fetchMock, now: at(1_000) })
    await getContractorProcess({ env: ENV, fetch: fetchMock, now: at(1_000) })

    expect(calls(fetchMock, '/contents/maps/doctor-school.yaml')).toBe(1)
    expect(calls(fetchMock, '/contents/processes/contractors.json')).toBe(2)
  })
})
