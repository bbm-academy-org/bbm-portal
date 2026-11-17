// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getProcessModel,
  PROCESS_MODEL_CACHE_TTL_MS,
  processBySlug,
  resetProcessModelCache,
} from '@/lib/processes'

/**
 * Where the IDEF0 page gets the model from (#553, spec 553). The real model
 * lives in the PUBLIC repo `bbm-academy-org/bbm-kb` and is read at request time
 * — raw files from `raw.githubusercontent.com`, and, when a token is configured,
 * ONE conditional API request per TTL to learn whether the model changed. Every
 * GitHub response here is a mocked `fetch` — no network. The model text is the
 * INVENTED example committed in `content/processes/example/`.
 */

const repoRoot = join(import.meta.dirname, '..', '..')
const EXAMPLE = join(repoRoot, 'content', 'processes', 'example')
const exampleFile = (file: string) => readFileSync(join(EXAMPLE, file), 'utf8')

const ENTRY = processBySlug('ds-content-production')!
const DIR = 'content/processes/ds-content-production'
const RAW = 'https://raw.githubusercontent.com/bbm-academy-org/bbm-kb'
const TOKEN = 'github_pat_test_SECRET_value_never_logged'
const T0 = new Date('2026-11-17T10:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

type Call = { url: string; init?: RequestInit }

/**
 * A fake GitHub: raw files served from the example (or overridden per path),
 * the commits API answering with `revision` and honouring If-None-Match.
 */
function fakeGithub(
  opts: {
    revision?: string
    raw?: Record<string, string | number | Error>
    api?: number | Error
  } = {},
) {
  const calls: Call[] = []
  const state = { revision: opts.revision ?? 'rev1', raw: opts.raw ?? {}, api: opts.api }
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.startsWith('https://api.github.com/')) {
      if (state.api instanceof Error) throw state.api
      if (typeof state.api === 'number') return new Response('{}', { status: state.api })
      const etag = `"etag-${state.revision}"`
      const sent = new Headers(init?.headers).get('if-none-match')
      if (sent === etag) return new Response(null, { status: 304 })
      return new Response(JSON.stringify([{ sha: state.revision }]), {
        status: 200,
        headers: { etag, 'content-type': 'application/json' },
      })
    }
    const prefix = url.match(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\//)
    if (!prefix) throw new Error(`unexpected url ${url}`)
    const file = url.slice(prefix[0].length + DIR.length + 1)
    const override = state.raw[file]
    if (override instanceof Error) throw override
    if (typeof override === 'number') return new Response('nope', { status: override })
    if (typeof override === 'string') return new Response(override, { status: 200 })
    try {
      return new Response(exampleFile(file), { status: 200 })
    } catch {
      return new Response('404: Not Found', { status: 404 })
    }
  })
  return { fetch, calls, state }
}

const apiCalls = (calls: Call[]) => calls.filter((c) => c.url.startsWith('https://api.github.com'))
const rawCalls = (calls: Call[]) => calls.filter((c) => c.url.startsWith(RAW))

beforeEach(() => {
  resetProcessModelCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('the source of the DS model (spec 553 EARS-603)', () => {
  it('EARS-603: the catalog entry points at bbm-kb main, content/processes/ds-content-production', () => {
    expect(ENTRY.source).toEqual({ repo: 'bbm-academy-org/bbm-kb', ref: 'main', dir: DIR })
  })

  it('EARS-603: reads index.yaml, every diagram it lists, the registry and the TO-BE document', async () => {
    const gh = fakeGithub()
    const loaded = await getProcessModel(ENTRY, { env: {}, fetch: gh.fetch, now: T0 })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.origin).toMatchObject({ kind: 'github', repo: 'bbm-academy-org/bbm-kb' })
    expect(loaded.model.index.root).toBe('A-0')
    expect(loaded.model.diagrams.map((d) => d.id)).toEqual(['A-0', 'A0', 'A2'])
    expect(loaded.model.diagrams[1]).toMatchObject({ id: 'A0', parent: 'A-0' })
    expect(loaded.model.knowledge?.objects.get('O-001')?.name).toBe('Мука и вода')
    const files = rawCalls(gh.calls).map((c) => c.url.slice(`${RAW}/main/${DIR}/`.length))
    expect(files.sort()).toEqual(
      [
        'model/index.yaml',
        'model/A-0.yaml',
        'model/A0.yaml',
        'model/A2.yaml',
        'registry-ru.md',
        'process-to-be-ru.md',
      ].sort(),
    )
  })
})

describe('freshness: the TTL cache (spec 553 EARS-604, EARS-605)', () => {
  it('EARS-604: within the TTL a second view asks GitHub nothing; after it, the model is re-read', async () => {
    const gh = fakeGithub()
    await getProcessModel(ENTRY, { env: {}, fetch: gh.fetch, now: T0 })
    const first = gh.calls.length
    await getProcessModel(ENTRY, {
      env: {},
      fetch: gh.fetch,
      now: at(PROCESS_MODEL_CACHE_TTL_MS - 1),
    })
    expect(gh.calls.length).toBe(first)

    // A change merged to bbm-kb shows up once the TTL has run out.
    gh.state.raw['model/A-0.yaml'] = exampleFile('model/A-0.yaml').replace(
      'title: Испечь и продать хлеб',
      'title: Испечь, продать и доставить хлеб',
    )
    const later = await getProcessModel(ENTRY, {
      env: {},
      fetch: gh.fetch,
      now: at(PROCESS_MODEL_CACHE_TTL_MS + 1),
    })
    expect(gh.calls.length).toBeGreaterThan(first)
    expect(later.ok && later.model.diagrams[0].title).toBe('Испечь, продать и доставить хлеб')
  })

  it('EARS-605: with no token, no GitHub API request is made — raw files only, at the branch', async () => {
    const gh = fakeGithub()
    const loaded = await getProcessModel(ENTRY, { env: {}, fetch: gh.fetch, now: T0 })
    expect(apiCalls(gh.calls)).toHaveLength(0)
    expect(rawCalls(gh.calls).every((c) => c.url.startsWith(`${RAW}/main/`))).toBe(true)
    expect(loaded.ok && loaded.revision).toBe(null)
  })

  it('EARS-605: with a token, one conditional API request per TTL; files re-read only on a new revision', async () => {
    const gh = fakeGithub({ revision: 'rev1' })
    const env = { PROCESS_MODELS_GITHUB_TOKEN: TOKEN }

    const first = await getProcessModel(ENTRY, { env, fetch: gh.fetch, now: T0 })
    expect(first.ok && first.revision).toBe('rev1')
    expect(apiCalls(gh.calls)).toHaveLength(1)
    const probe = apiCalls(gh.calls)[0]
    expect(probe.url).toContain('/repos/bbm-academy-org/bbm-kb/commits?')
    expect(probe.url).toContain(`path=${encodeURIComponent(DIR)}`)
    expect(probe.url).toContain('sha=main')
    expect(new Headers(probe.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    // Files are pinned to the revision: no CDN lag on the branch name.
    expect(rawCalls(gh.calls).every((c) => c.url.startsWith(`${RAW}/rev1/`))).toBe(true)
    const rawAfterFirst = rawCalls(gh.calls).length

    // Same revision → 304 → nothing else is fetched.
    await getProcessModel(ENTRY, { env, fetch: gh.fetch, now: at(PROCESS_MODEL_CACHE_TTL_MS + 1) })
    expect(apiCalls(gh.calls)).toHaveLength(2)
    expect(new Headers(apiCalls(gh.calls)[1].init?.headers).get('if-none-match')).toBe(
      '"etag-rev1"',
    )
    expect(rawCalls(gh.calls)).toHaveLength(rawAfterFirst)

    // A new revision → the files are read again, at that revision.
    gh.state.revision = 'rev2'
    const third = await getProcessModel(ENTRY, {
      env,
      fetch: gh.fetch,
      now: at(2 * PROCESS_MODEL_CACHE_TTL_MS + 2),
    })
    expect(third.ok && third.revision).toBe('rev2')
    expect(rawCalls(gh.calls).length).toBe(2 * rawAfterFirst)
    expect(rawCalls(gh.calls).at(-1)?.url).toContain(`${RAW}/rev2/`)
  })

  it('EARS-605: the path-map token is reused when no processes token is set', async () => {
    const gh = fakeGithub()
    await getProcessModel(ENTRY, {
      env: { PATH_MAPS_GITHUB_TOKEN: TOKEN },
      fetch: gh.fetch,
      now: T0,
    })
    expect(apiCalls(gh.calls)).toHaveLength(1)
  })

  it('EARS-605: a failed revision check falls back to the raw files at the branch', async () => {
    const gh = fakeGithub({ api: 401 })
    const loaded = await getProcessModel(ENTRY, {
      env: { PROCESS_MODELS_GITHUB_TOKEN: TOKEN },
      fetch: gh.fetch,
      now: T0,
    })
    expect(loaded.ok).toBe(true)
    expect(rawCalls(gh.calls).every((c) => c.url.startsWith(`${RAW}/main/`))).toBe(true)
  })
})

describe('a failing source (spec 553 EARS-606, EARS-607)', () => {
  it('EARS-606: after a good read, a failed refresh serves the copy with the time and the reason', async () => {
    const gh = fakeGithub()
    await getProcessModel(ENTRY, { env: {}, fetch: gh.fetch, now: T0 })
    gh.state.raw['model/index.yaml'] = new TypeError('fetch failed')
    const stale = await getProcessModel(ENTRY, {
      env: {},
      fetch: gh.fetch,
      now: at(PROCESS_MODEL_CACHE_TTL_MS + 1),
    })
    expect(stale.ok).toBe(true)
    if (!stale.ok) return
    expect(stale.stale).toBe(true)
    expect(stale.staleReason).toBe('network')
    expect(stale.asOf).toBe(T0.toISOString())
    expect(stale.model.diagrams.map((d) => d.id)).toEqual(['A-0', 'A0', 'A2'])
  })

  it('EARS-606: a new revision that does not parse keeps the last good model, marked stale as invalid', async () => {
    const gh = fakeGithub()
    await getProcessModel(ENTRY, { env: {}, fetch: gh.fetch, now: T0 })
    gh.state.raw['model/A0.yaml'] = 'boxes: [unclosed'
    const stale = await getProcessModel(ENTRY, {
      env: {},
      fetch: gh.fetch,
      now: at(PROCESS_MODEL_CACHE_TTL_MS + 1),
    })
    expect(stale.ok && stale.stale).toBe(true)
    expect(stale.ok && stale.staleReason).toBe('invalid')
    expect(stale.ok && stale.staleMessage).toContain('A0.yaml')
  })

  it('EARS-607: with no copy, the error names the source and the reason; GitHub is not asked again within the TTL', async () => {
    const gh = fakeGithub({ raw: { 'model/index.yaml': 404 } })
    const failed = await getProcessModel(ENTRY, { env: {}, fetch: gh.fetch, now: T0 })
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.failure.reason).toBe('not-found')
    expect(failed.failure.message).toContain('bbm-academy-org/bbm-kb')
    expect(failed.failure.message).toContain('model/index.yaml')

    const n = gh.calls.length
    const again = await getProcessModel(ENTRY, { env: {}, fetch: gh.fetch, now: at(1000) })
    expect(again.ok).toBe(false)
    expect(gh.calls.length).toBe(n)

    delete gh.state.raw['model/index.yaml']
    const recovered = await getProcessModel(ENTRY, {
      env: {},
      fetch: gh.fetch,
      now: at(PROCESS_MODEL_CACHE_TTL_MS + 1),
    })
    expect(recovered.ok).toBe(true)
  })

  it('EARS-607: a rate limit and a server error read as their own reasons; the token is never in a message', async () => {
    const limited = fakeGithub({ raw: { 'model/index.yaml': 429 } })
    const a = await getProcessModel(ENTRY, {
      env: { PROCESS_MODELS_GITHUB_TOKEN: TOKEN },
      fetch: limited.fetch,
      now: T0,
    })
    expect(!a.ok && a.failure.reason).toBe('rate-limit')
    expect(JSON.stringify(a)).not.toContain(TOKEN)

    resetProcessModelCache()
    const down = fakeGithub({ raw: { 'model/index.yaml': 502 } })
    const b = await getProcessModel(ENTRY, { env: {}, fetch: down.fetch, now: T0 })
    expect(!b.ok && b.failure.reason).toBe('network')
  })

  it('EARS-607: an index that is not a model is an invalid-model error, not a blank page', async () => {
    const gh = fakeGithub({ raw: { 'model/index.yaml': 'just: text' } })
    const failed = await getProcessModel(ENTRY, { env: {}, fetch: gh.fetch, now: T0 })
    expect(!failed.ok && failed.failure.reason).toBe('invalid')
    expect(!failed.ok && failed.failure.message).toContain('index.yaml')
  })
})

describe('the invented example (spec 553 EARS-608)', () => {
  it('EARS-608: PROCESS_MODELS_SOURCE=example reads the committed example and never GitHub', async () => {
    const fetch = vi.fn()
    const loaded = await getProcessModel(ENTRY, {
      env: { PROCESS_MODELS_SOURCE: 'example', PROCESS_MODELS_GITHUB_TOKEN: TOKEN },
      fetch,
      root: repoRoot,
      now: T0,
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(loaded.ok).toBe(true)
    expect(loaded.origin.kind).toBe('example')
    expect(loaded.ok && loaded.model.diagrams.map((d) => d.id)).toEqual(['A-0', 'A0', 'A2'])
  })
})
