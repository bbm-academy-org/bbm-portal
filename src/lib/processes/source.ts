import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ProcessCatalogEntry } from './catalog'
import { parseIndex, type RawModelFiles } from './parse'

/**
 * Where a process model comes from (#553, spec 553 EARS-603/605/608).
 *
 * The DS model is mastered in the PUBLIC repo `bbm-academy-org/bbm-kb`. The
 * files are read from GitHub's raw host, which needs no token and costs no
 * GitHub API quota. The pattern is the path map's (#533) — server-side TTL
 * cache, stale copy on failure, honest error — but not its transport: the
 * path map reads ONE file of a PRIVATE repo through the contents API with a
 * token; a model is ~30 files of a public repo, and 30 API calls per refresh
 * would spend the unauthenticated quota (60/h per IP) in two refreshes.
 *
 * With a token (`PROCESS_MODELS_GITHUB_TOKEN`, else the path map's
 * `PATH_MAPS_GITHUB_TOKEN` — no new secret is required) ONE conditional API
 * request per TTL asks for the newest commit touching the model folder; an
 * unchanged model answers 304, which does not count against an authenticated
 * quota, and nothing else is fetched. A new revision is read from the raw host
 * PINNED to that commit, so the branch's CDN cache (up to 5 min on raw) never
 * serves a mix of old and new files. Without a token the files are read at the
 * branch every TTL, and a merged change may take the raw CDN's few minutes on
 * top of the TTL to show.
 *
 * `PROCESS_MODELS_SOURCE=example` reads the INVENTED example committed in
 * `content/processes/example/` instead — tests and an offline stand.
 */

export const EXAMPLE_DIR = 'content/processes/example'

const GITHUB_API = 'https://api.github.com'
const GITHUB_RAW = 'https://raw.githubusercontent.com'

export interface GithubProcessOrigin {
  kind: 'github'
  repo: string
  ref: string
  dir: string
}
export interface ExampleProcessOrigin {
  kind: 'example'
  dir: string
}
export type ProcessOrigin = GithubProcessOrigin | ExampleProcessOrigin

export type ProcessSourceFailure =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limit'
  | 'network'
  | 'bad-response'
  | 'invalid'
  | 'local-read'

/** The grouping the page words a failure by. */
export type ProcessFailureKind =
  'auth' | 'not-found' | 'rate-limit' | 'network' | 'invalid' | 'local'

export function failureKind(reason: ProcessSourceFailure): ProcessFailureKind {
  switch (reason) {
    case 'unauthorized':
    case 'forbidden':
      return 'auth'
    case 'not-found':
      return 'not-found'
    case 'rate-limit':
      return 'rate-limit'
    case 'network':
    case 'bad-response':
      return 'network'
    case 'invalid':
      return 'invalid'
    case 'local-read':
      return 'local'
  }
}

/** A failed read. `message` is Russian and member-readable; it never carries the token. */
export class ProcessSourceError extends Error {
  constructor(
    message: string,
    readonly reason: ProcessSourceFailure,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ProcessSourceError'
  }
}

export function describeProcessOrigin(origin: ProcessOrigin): string {
  if (origin.kind === 'example') return origin.dir
  return `${origin.repo}@${origin.ref} · ${origin.dir}`
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Reads one file of the package (path relative to the package folder). */
type ReadFile = (file: string) => Promise<string>

/**
 * Every file of a model package: the index first (it lists the diagrams), then
 * the diagrams and the two explanation documents in parallel. A missing
 * explanation document is not fatal (EARS-615); any other failure is.
 */
async function readModelFiles(get: ReadFile): Promise<RawModelFiles> {
  const index = await get('model/index.yaml')
  const parsed = parseIndex(index)
  if (!parsed.index) {
    throw new ProcessSourceError(`модель не разобрана: ${parsed.errors.join('; ')}`, 'invalid')
  }
  const optional = (file: string) =>
    get(file).then(
      (text) => ({ text, error: null as string | null }),
      (error: unknown) => {
        if (error instanceof ProcessSourceError && error.reason === 'not-found') {
          return { text: null, error: error.message }
        }
        throw error
      },
    )
  const [texts, registry, process] = await Promise.all([
    Promise.all(parsed.index.diagrams.map((d) => get(`model/${d.file}`))),
    optional('registry-ru.md'),
    optional('process-to-be-ru.md'),
  ])
  const diagrams: Record<string, string> = {}
  parsed.index.diagrams.forEach((d, i) => (diagrams[d.file] = texts[i]))
  const registryError = registry.error ?? process.error ?? undefined
  return {
    index,
    diagrams,
    registry: registry.text,
    process: process.text,
    ...(registryError ? { registryError } : {}),
  }
}

function rateLimited(res: Response): boolean {
  return (
    res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
  )
}

function httpError(res: Response, what: string): ProcessSourceError {
  const status = res.status
  const cause = new Error(`GitHub ${status} on ${what}`)
  if (rateLimited(res)) {
    return new ProcessSourceError(
      `Превышен лимит запросов к GitHub — модель сейчас не прочитать, повторите позже (${status})`,
      'rate-limit',
      status,
      { cause },
    )
  }
  if (status === 401) {
    return new ProcessSourceError(
      `GitHub отклонил токен доступа (401): ${what}`,
      'unauthorized',
      status,
      { cause },
    )
  }
  if (status === 403) {
    return new ProcessSourceError(`GitHub отказал в доступе (403): ${what}`, 'forbidden', status, {
      cause,
    })
  }
  if (status === 404) {
    return new ProcessSourceError(`файл модели не найден: ${what} (404)`, 'not-found', status, {
      cause,
    })
  }
  return new ProcessSourceError(`GitHub ответил ${status}: ${what}`, 'bad-response', status, {
    cause,
  })
}

export interface GithubProcessSource {
  readonly kind: 'github'
  readonly origin: GithubProcessOrigin
  /** A token is configured: the revision check is available. */
  readonly authenticated: boolean
  /**
   * The newest commit touching the model folder (authenticated only). `null`
   * when GitHub answers 304 to `etag` — the model has not changed.
   */
  revision(etag: string | null): Promise<{ sha: string; etag: string | null } | null>
  /** Every file of the package at `ref` — a commit sha, or the branch. */
  read(ref: string): Promise<RawModelFiles>
}

export interface ExampleProcessSource {
  readonly kind: 'example'
  readonly origin: ExampleProcessOrigin
  read(): Promise<RawModelFiles>
}

export type AnyProcessSource = GithubProcessSource | ExampleProcessSource

export function githubProcessSource(
  config: { repo: string; ref: string; dir: string; token?: string },
  fetchImpl: FetchLike = fetch,
): GithubProcessSource {
  const origin: GithubProcessOrigin = {
    kind: 'github',
    repo: config.repo,
    ref: config.ref,
    dir: config.dir,
  }
  const where = `${config.repo}@${config.ref}`
  const encode = (path: string) => path.split('/').map(encodeURIComponent).join('/')

  return {
    kind: 'github',
    origin,
    authenticated: Boolean(config.token),

    async revision(etag) {
      const url =
        `${GITHUB_API}/repos/${config.repo}/commits?sha=${encodeURIComponent(config.ref)}` +
        `&path=${encodeURIComponent(config.dir)}&per_page=1`
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }
      if (config.token) headers.Authorization = `Bearer ${config.token}`
      if (etag) headers['If-None-Match'] = etag
      let res: Response
      try {
        // The module keeps its own TTL cache (./cache.ts); Next must not add a second layer.
        res = await fetchImpl(url, { headers, cache: 'no-store' })
      } catch (error) {
        throw new ProcessSourceError(
          `GitHub недоступен — ревизия модели ${where} не узнана`,
          'network',
          undefined,
          {
            cause: error,
          },
        )
      }
      if (res.status === 304) return null
      if (!res.ok) throw httpError(res, `ревизия ${where} · ${config.dir}`)
      let body: unknown
      try {
        body = await res.json()
      } catch (error) {
        throw new ProcessSourceError(
          `GitHub вернул нечитаемый ответ о ревизии ${where}`,
          'bad-response',
          res.status,
          {
            cause: error,
          },
        )
      }
      const sha = Array.isArray(body) ? (body[0] as { sha?: unknown } | undefined)?.sha : undefined
      if (typeof sha !== 'string' || !sha) {
        throw new ProcessSourceError(
          `в ${where} нет коммитов в папке ${config.dir}`,
          'not-found',
          res.status,
        )
      }
      return { sha, etag: res.headers.get('etag') }
    },

    read(ref) {
      return readModelFiles(async (file) => {
        const path = `${config.dir}/${file}`
        const url = `${GITHUB_RAW}/${config.repo}/${encodeURIComponent(ref)}/${encode(path)}`
        let res: Response
        try {
          res = await fetchImpl(url, { cache: 'no-store' })
        } catch (error) {
          throw new ProcessSourceError(
            `GitHub недоступен — не удалось прочитать ${where} · ${file}`,
            'network',
            undefined,
            { cause: error },
          )
        }
        if (!res.ok) throw httpError(res, `${where} · ${file}`)
        try {
          return await res.text()
        } catch (error) {
          throw new ProcessSourceError(
            `GitHub оборвал ответ: ${where} · ${file}`,
            'network',
            res.status,
            {
              cause: error,
            },
          )
        }
      })
    },
  }
}

/** The invented example committed in this repo. */
export function exampleProcessSource(root: string = process.cwd()): ExampleProcessSource {
  const origin: ExampleProcessOrigin = { kind: 'example', dir: EXAMPLE_DIR }
  return {
    kind: 'example',
    origin,
    read() {
      return readModelFiles(async (file) => {
        try {
          return await readFile(join(root, EXAMPLE_DIR, file), 'utf8')
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          throw new ProcessSourceError(
            `файл примера не прочитан: ${EXAMPLE_DIR}/${file} (${code ?? 'ошибка чтения'})`,
            code === 'ENOENT' ? 'not-found' : 'local-read',
            undefined,
            { cause: error },
          )
        }
      })
    },
  }
}

/** `process.env`-shaped; keys read: `PROCESS_MODELS_SOURCE`, `PROCESS_MODELS_GITHUB_TOKEN`, `PATH_MAPS_GITHUB_TOKEN`. */
export type ProcessEnv = Readonly<Record<string, string | undefined>>

export function processSourceFromEnv(
  entry: ProcessCatalogEntry,
  env: ProcessEnv = process.env,
  deps: { fetch?: FetchLike; root?: string } = {},
): AnyProcessSource {
  if (env.PROCESS_MODELS_SOURCE?.trim() === 'example') return exampleProcessSource(deps.root)
  const token =
    env.PROCESS_MODELS_GITHUB_TOKEN?.trim() || env.PATH_MAPS_GITHUB_TOKEN?.trim() || undefined
  return githubProcessSource({ ...entry.source, token }, deps.fetch)
}
