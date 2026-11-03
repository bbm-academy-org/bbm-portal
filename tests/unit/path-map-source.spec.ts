import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getPathMap,
  githubPathMapSource,
  PATH_MAP_CACHE_TTL_MS,
  PATH_MAP_FILE,
  PathMapSourceError,
  resetPathMapCache,
} from '@/lib/path-map'

/**
 * Where `/p/path` gets the map from (#533). The real map lives in the PRIVATE
 * repo `bbm-academy-org/path-maps` and is read through the GitHub contents API
 * when `PATH_MAPS_GITHUB_TOKEN` is set; without it the page falls back to the
 * public design example committed in this repo, so dev, CI and these tests run
 * with no secret. Every GitHub response here is a mocked `fetch` — no network.
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
      // GitHub wraps base64 at 60 columns; the decoder must not care.
      content: Buffer.from(text, 'utf8')
        .toString('base64')
        .replace(/(.{60})/g, '$1\n'),
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

describe('getPathMap — the GitHub source (token present)', () => {
  it('reads maps/doctor-school.yaml from bbm-academy-org/path-maps with the token', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(example, 'sha-1'))
    const loaded = await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://api.github.com/repos/bbm-academy-org/path-maps/contents/maps/doctor-school.yaml',
    )
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('accept')).toBe('application/vnd.github+json')

    expect(loaded.ok ? [] : loaded.errors).toEqual([])
    expect(loaded.origin).toEqual({
      kind: 'github',
      repo: 'bbm-academy-org/path-maps',
      path: 'maps/doctor-school.yaml',
    })
    expect(loaded.sha).toBe('sha-1')
    expect(loaded.stale).toBe(false)
    expect(loaded.file).toContain('bbm-academy-org/path-maps')
    expect(loaded.file).toContain('maps/doctor-school.yaml')
  })

  it('honours PATH_MAPS_REPO / PATH_MAPS_FILE / PATH_MAPS_BRANCH', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(example))
    const loaded = await getPathMap({
      env: {
        ...ENV,
        PATH_MAPS_REPO: 'acme/maps',
        PATH_MAPS_FILE: 'maps/other school.yaml',
        PATH_MAPS_BRANCH: 'draft',
      },
      fetch: fetchMock,
      now: T0,
    })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe(
      'https://api.github.com/repos/acme/maps/contents/maps/other%20school.yaml?ref=draft',
    )
    expect(loaded.origin).toEqual({
      kind: 'github',
      repo: 'acme/maps',
      path: 'maps/other school.yaml',
      branch: 'draft',
    })
  })

  it('renders validation errors of the remote file against the repo/path, not the local file', async () => {
    const fetchMock = vi.fn(async () => contentsResponse('title: [unclosed'))
    const loaded = await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    expect(loaded.ok).toBe(false)
    expect(loaded.file).toContain('bbm-academy-org/path-maps')
    expect(loaded.file).not.toContain(PATH_MAP_FILE)
  })

  it('turns a 404 into a readable Russian error naming the repo and path', async () => {
    const loaded = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(404)),
      now: T0,
    })
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.errors.join('\n')).toMatch(/не найден/)
    expect(loaded.errors.join('\n')).toContain('bbm-academy-org/path-maps')
    expect(loaded.errors.join('\n')).toContain('maps/doctor-school.yaml')
    expect(loaded.stale).toBe(false)
  })

  it('turns a 401 into a readable Russian error about the access token', async () => {
    const loaded = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(401)),
      now: T0,
    })
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.errors.join('\n')).toMatch(/токен/)
    expect(loaded.errors.join('\n')).not.toContain(TOKEN)
  })

  it('recognises the GitHub rate limit (403 + x-ratelimit-remaining: 0, and 429)', async () => {
    const limited = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () =>
        errorResponse(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1762165200' }),
      ),
      now: T0,
    })
    expect(limited.ok).toBe(false)
    if (!limited.ok) expect(limited.errors.join('\n')).toMatch(/лимит/)

    resetPathMapCache()
    const tooMany = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(429, { 'retry-after': '60' })),
      now: T0,
    })
    if (!tooMany.ok) expect(tooMany.errors.join('\n')).toMatch(/лимит/)
    else throw new Error('a 429 must not render a map')
  })

  it('a plain 403 is a permissions error, not a rate limit', async () => {
    const loaded = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => errorResponse(403, { 'x-ratelimit-remaining': '4999' })),
      now: T0,
    })
    if (loaded.ok) throw new Error('a 403 must not render a map')
    expect(loaded.errors.join('\n')).toMatch(/прав/)
    expect(loaded.errors.join('\n')).not.toMatch(/лимит/)
  })

  it('serves the cached copy inside the TTL and refetches after it', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(example))
    await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })
    const second = await getPathMap({
      env: ENV,
      fetch: fetchMock,
      now: at(PATH_MAP_CACHE_TTL_MS - 1),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.stale).toBe(false)

    await getPathMap({ env: ENV, fetch: fetchMock, now: at(PATH_MAP_CACHE_TTL_MS + 1) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('collapses parallel requests into one GitHub fetch', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(example))
    await Promise.all([
      getPathMap({ env: ENV, fetch: fetchMock, now: T0 }),
      getPathMap({ env: ENV, fetch: fetchMock, now: T0 }),
      getPathMap({ env: ENV, fetch: fetchMock, now: T0 }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the last good copy, flagged stale, when GitHub fails after the TTL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(contentsResponse(example, 'sha-good'))
      .mockResolvedValue(errorResponse(502))
    await getPathMap({ env: ENV, fetch: fetchMock, now: T0 })

    const stale = await getPathMap({
      env: ENV,
      fetch: fetchMock,
      now: at(PATH_MAP_CACHE_TTL_MS + 1),
    })
    expect(stale.ok).toBe(true)
    expect(stale.stale).toBe(true)
    expect(stale.sha).toBe('sha-good')
    expect(stale.asOf).toBe(T0.toISOString())

    // During the outage retries are rate-limited to one per TTL.
    await getPathMap({ env: ENV, fetch: fetchMock, now: at(PATH_MAP_CACHE_TTL_MS + 2) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a network failure with no cached copy is a readable error, the cause kept for the logs', async () => {
    const loaded = await getPathMap({
      env: ENV,
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
      now: T0,
    })
    if (loaded.ok) throw new Error('a network failure must not render a map')
    expect(loaded.errors.join('\n')).toMatch(/GitHub/)
  })
})

describe('getPathMap — the local fallback (no token)', () => {
  it('reads the public example from the repo and never calls GitHub', async () => {
    const fetchMock = vi.fn()
    const loaded = await getPathMap({ env: {}, fetch: fetchMock, now: T0, root: repoRoot })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loaded.origin).toEqual({ kind: 'local', path: PATH_MAP_FILE })
    expect(loaded.file).toBe(PATH_MAP_FILE)
    expect(loaded.ok ? [] : loaded.errors).toEqual([])
    expect(loaded.stale).toBe(false)
    expect(loaded.sha).toBeNull()
  })

  it('an empty token counts as absent', async () => {
    const fetchMock = vi.fn()
    const loaded = await getPathMap({
      env: { PATH_MAPS_GITHUB_TOKEN: '  ' },
      fetch: fetchMock,
      now: T0,
      root: repoRoot,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loaded.origin.kind).toBe('local')
  })

  it('a missing local file is an error, not a throw', async () => {
    const loaded = await getPathMap({ env: {}, now: T0, root: join(repoRoot, 'does-not-exist') })
    expect(loaded.ok).toBe(false)
  })
})

describe('githubPathMapSource — the read client task D reuses', () => {
  it('returns the decoded content and the blob sha', async () => {
    const source = githubPathMapSource(
      { token: TOKEN, repo: 'bbm-academy-org/path-maps', path: 'maps/doctor-school.yaml' },
      vi.fn(async () => contentsResponse('title: Пример\n', 'blob-sha')),
    )
    await expect(source.read()).resolves.toMatchObject({
      content: 'title: Пример\n',
      sha: 'blob-sha',
      origin: { kind: 'github', repo: 'bbm-academy-org/path-maps' },
    })
  })

  it('throws a PathMapSourceError carrying the HTTP status', async () => {
    const source = githubPathMapSource(
      { token: TOKEN, repo: 'bbm-academy-org/path-maps', path: 'maps/doctor-school.yaml' },
      vi.fn(async () => errorResponse(404)),
    )
    const error = await source.read().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PathMapSourceError)
    expect((error as PathMapSourceError).status).toBe(404)
    expect((error as PathMapSourceError).reason).toBe('not-found')
  })
})
