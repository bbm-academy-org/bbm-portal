import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the map text comes from (#533).
 *
 * The real map lives in the PRIVATE repo `bbm-academy-org/path-maps` (owner
 * decision 2026-11-03: strategy is not kept in this public repo) and is read
 * through the GitHub REST contents API. Without a token the portal reads the
 * public design example committed here (`content/path-map/doctor-school.yaml`),
 * so dev, CI and the tests run with no secret.
 *
 * `GithubPathMapSource` is the seam task D (editing) extends: `read()` already
 * returns the blob `sha` that the contents API's PUT needs for optimistic
 * concurrency. D adds to THAT interface only (not to the `AnyPathMapSource`
 * union — the local example and a misconfigured source are never written):
 *
 *   write(content: string, sha: string, message: string): Promise<{ sha: string }>
 *
 * (PUT /repos/{repo}/contents/{path} with base64 `content`, `sha`, `message`,
 * optional `branch`; a 409/422 means the sha is stale → reload, never force),
 * then calls `primePathMapCache(source.origin, { content, sha })` with the
 * response's new blob sha, so the next read sees its own write without a GET.
 * Narrow by `source.kind === 'github'`: a malformed config is its own
 * `kind: 'misconfigured'` source and never looks like GitHub.
 */

/** The local public example, relative to the app root. Traced into the image by `next.config.ts`. */
export const PATH_MAP_FILE = 'content/path-map/doctor-school.yaml'
export const PATH_MAPS_DEFAULT_REPO = 'bbm-academy-org/path-maps'
export const PATH_MAPS_DEFAULT_FILE = 'maps/doctor-school.yaml'

const GITHUB_API = 'https://api.github.com'

export interface GithubPathMapOrigin {
  kind: 'github'
  repo: string
  path: string
  branch?: string
}
export interface LocalPathMapOrigin {
  kind: 'local'
  path: string
}
/** `PATH_MAPS_*` env that does not form a valid repo/path — the raw values, for the error state. */
export interface MisconfiguredPathMapOrigin {
  kind: 'misconfigured'
  repo: string
  path: string
  branch?: string
}

export type PathMapOrigin = GithubPathMapOrigin | LocalPathMapOrigin | MisconfiguredPathMapOrigin

export interface PathMapDocument {
  /** The YAML text, decoded. */
  content: string
  /** The git blob sha of that text (GitHub only) — the concurrency token for a later write. */
  sha: string | null
  origin: PathMapOrigin
}

export interface PathMapSource {
  readonly kind: PathMapOrigin['kind']
  readonly origin: PathMapOrigin
  /** Throws `PathMapSourceError`; its `message` is shown to the member, the `cause` goes to the logs. */
  read(): Promise<PathMapDocument>
}

/** The private repo. Task D adds `write()` here. */
export interface GithubPathMapSource extends PathMapSource {
  readonly kind: 'github'
  readonly origin: GithubPathMapOrigin
  read(): Promise<PathMapDocument & { sha: string; origin: GithubPathMapOrigin }>
}

/** The public example committed in this repo. Read-only. */
export interface LocalPathMapSource extends PathMapSource {
  readonly kind: 'local'
  readonly origin: LocalPathMapOrigin
}

/** Malformed `PATH_MAPS_*` env: `read()` always rejects with a `config` error; nothing is fetched. */
export interface MisconfiguredPathMapSource extends PathMapSource {
  readonly kind: 'misconfigured'
  readonly origin: MisconfiguredPathMapOrigin
}

export type AnyPathMapSource = GithubPathMapSource | LocalPathMapSource | MisconfiguredPathMapSource

export type PathMapSourceFailure =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limit'
  | 'network'
  | 'bad-response'
  | 'not-a-file'
  | 'config'
  | 'local-read'

/**
 * What the member is told to do about a failed read — the grouping the page
 * and the stale notice are worded by. `network` covers transport errors, 5xx
 * and an unreadable body (transient); `auth` covers 401 and a plain 403.
 */
export type PathMapReadFailureKind =
  'auth' | 'not-found' | 'rate-limit' | 'network' | 'config' | 'local'

export function readFailureKind(reason: PathMapSourceFailure): PathMapReadFailureKind {
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
    case 'not-a-file':
    case 'config':
      return 'config'
    case 'local-read':
      return 'local'
  }
}

/**
 * A failed read. `message` is Russian and member-readable; it never carries the
 * token (no request headers are ever put into the message or the cause).
 */
export class PathMapSourceError extends Error {
  constructor(
    message: string,
    readonly reason: PathMapSourceFailure,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'PathMapSourceError'
  }
}

/** Human label of where the map came from — what the error and empty states name. */
export function describeOrigin(origin: PathMapOrigin): string {
  if (origin.kind === 'local') return origin.path
  if (origin.kind === 'misconfigured') return `${origin.repo} · ${origin.path} (настройки сервера)`
  return `${origin.repo}${origin.branch ? `@${origin.branch}` : ''} · ${origin.path}`
}

export interface GithubSourceConfig {
  token: string
  repo: string
  path: string
  branch?: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function rateLimitWait(res: Response): string {
  const retryAfter = Number(res.headers.get('retry-after'))
  const reset = Number(res.headers.get('x-ratelimit-reset'))
  const seconds =
    Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter
      : Number.isFinite(reset) && reset > 0
        ? reset - Date.now() / 1000
        : NaN
  if (!Number.isFinite(seconds) || seconds <= 0) return 'повторите позже'
  return `повторите через ${Math.max(1, Math.ceil(seconds / 60))} мин`
}

function httpError(res: Response, origin: GithubPathMapOrigin): PathMapSourceError {
  const where = describeOrigin(origin)
  const status = res.status
  const cause = new Error(`GitHub contents API ${status} on ${origin.repo}/${origin.path}`)
  const limited =
    status === 429 || (status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
  if (limited) {
    return new PathMapSourceError(
      `Превышен лимит запросов к GitHub — карту сейчас не прочитать, ${rateLimitWait(res)} (${status})`,
      'rate-limit',
      status,
      { cause },
    )
  }
  if (status === 401) {
    return new PathMapSourceError(
      `GitHub отклонил токен доступа к репозиторию карт ${origin.repo} (401): токен недействителен, истёк или отозван`,
      'unauthorized',
      status,
      { cause },
    )
  }
  if (status === 403) {
    return new PathMapSourceError(
      `У токена нет прав на чтение репозитория карт ${origin.repo} (403)`,
      'forbidden',
      status,
      { cause },
    )
  }
  if (status === 404) {
    return new PathMapSourceError(
      `Файл карты не найден в GitHub: ${where} (404) — файла нет по этому пути или у токена нет доступа к репозиторию`,
      'not-found',
      status,
      { cause },
    )
  }
  return new PathMapSourceError(
    `GitHub ответил ${status} на запрос карты ${where}`,
    'bad-response',
    status,
    {
      cause,
    },
  )
}

/** GitHub contents-API source: GET /repos/{repo}/contents/{path}[?ref=branch]. */
export function githubPathMapSource(
  config: GithubSourceConfig,
  fetchImpl: FetchLike = fetch,
): GithubPathMapSource {
  const origin: GithubPathMapOrigin = {
    kind: 'github',
    repo: config.repo,
    path: config.path,
    ...(config.branch ? { branch: config.branch } : {}),
  }
  const encodedPath = config.path.split('/').map(encodeURIComponent).join('/')
  const url =
    `${GITHUB_API}/repos/${config.repo}/contents/${encodedPath}` +
    (config.branch ? `?ref=${encodeURIComponent(config.branch)}` : '')

  return {
    kind: 'github',
    origin,
    async read() {
      let res: Response
      try {
        res = await fetchImpl(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${config.token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          // The module keeps its own TTL cache (cache.ts); Next must not add a second layer.
          cache: 'no-store',
        })
      } catch (error) {
        throw new PathMapSourceError(
          `GitHub недоступен — не удалось прочитать карту ${describeOrigin(origin)}`,
          'network',
          undefined,
          { cause: error },
        )
      }
      if (!res.ok) throw httpError(res, origin)

      let body: { type?: string; encoding?: string; content?: string; sha?: string }
      try {
        body = (await res.json()) as typeof body
      } catch (error) {
        throw new PathMapSourceError(
          `GitHub вернул нечитаемый ответ на запрос карты ${describeOrigin(origin)}`,
          'bad-response',
          res.status,
          { cause: error },
        )
      }
      // A directory listing is an array; a file over 1 MB comes back with encoding "none".
      if (
        body.type !== 'file' ||
        body.encoding !== 'base64' ||
        typeof body.content !== 'string' ||
        !body.sha
      ) {
        throw new PathMapSourceError(
          `По пути ${describeOrigin(origin)} в GitHub не файл карты (или файл больше 1 МБ)`,
          'not-a-file',
          res.status,
          {
            cause: new Error(
              `unexpected contents payload: type=${body.type} encoding=${body.encoding}`,
            ),
          },
        )
      }
      const sha: string = body.sha
      return {
        content: Buffer.from(body.content, 'base64').toString('utf8'),
        sha,
        origin,
      }
    },
  }
}

/** The public example committed in this repo. */
export function localPathMapSource(root: string = process.cwd()): LocalPathMapSource {
  const origin: LocalPathMapOrigin = { kind: 'local', path: PATH_MAP_FILE }
  return {
    kind: 'local',
    origin,
    async read() {
      try {
        return { content: readFileSync(join(root, PATH_MAP_FILE), 'utf8'), sha: null, origin }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        throw new PathMapSourceError(
          code === 'ENOENT'
            ? `файл карты не найден: ${PATH_MAP_FILE}`
            : `файл карты не прочитан: ${PATH_MAP_FILE} (${code ?? 'ошибка чтения'})`,
          'local-read',
          undefined,
          { cause: error },
        )
      }
    },
  }
}

/** `process.env`-shaped; the keys read are `PATH_MAPS_GITHUB_TOKEN|REPO|FILE|BRANCH`. */
export type PathMapEnv = Readonly<Record<string, string | undefined>>

/** A GitHub owner/repo/path segment: non-empty, not `.`/`..`, no backslash. */
function validSegment(segment: string): boolean {
  return segment.length > 0 && !/^\.+$/.test(segment) && !segment.includes('\\')
}

/** `owner/name`, each `[A-Za-z0-9_.-]`, neither all dots. */
function repoProblem(repo: string): string | null {
  const parts = repo.split('/')
  if (parts.length !== 2 || !parts.every((p) => /^[\w.-]+$/.test(p) && validSegment(p))) {
    return `PATH_MAPS_REPO задан неверно: «${repo}» — ожидается вид владелец/репозиторий`
  }
  return null
}

/** A relative path inside the repo: segments joined by `/`, none empty, `.` or `..`. */
function fileProblem(path: string): string | null {
  if (!path.split('/').every(validSegment)) {
    return `PATH_MAPS_FILE задан неверно: «${path}» — ожидается путь внутри репозитория без «.», «..», «//» и «\\»`
  }
  return null
}

function misconfiguredSource(
  origin: MisconfiguredPathMapOrigin,
  message: string,
): MisconfiguredPathMapSource {
  return {
    kind: 'misconfigured',
    origin,
    read: () => Promise.reject(new PathMapSourceError(message, 'config')),
  }
}

/**
 * Token present → the private repo; absent (or blank) → the local example.
 * A malformed `PATH_MAPS_REPO` / `PATH_MAPS_FILE` is a `misconfigured` source
 * whose read is a config error the page shows — never a silent fall back to
 * the example (that would pass the example off as live), and never a request
 * carrying the token to whatever URL the env happened to spell.
 */
export function pathMapSourceFromEnv(
  env: PathMapEnv = process.env,
  deps: { fetch?: FetchLike; root?: string } = {},
): AnyPathMapSource {
  const token = env.PATH_MAPS_GITHUB_TOKEN?.trim()
  if (!token) return localPathMapSource(deps.root)

  const repo = env.PATH_MAPS_REPO?.trim() || PATH_MAPS_DEFAULT_REPO
  const path = (env.PATH_MAPS_FILE?.trim() || PATH_MAPS_DEFAULT_FILE).replace(/^\/+/, '')
  const branch = env.PATH_MAPS_BRANCH?.trim() || undefined
  const problem = repoProblem(repo) ?? fileProblem(path)
  if (problem) {
    return misconfiguredSource(
      { kind: 'misconfigured', repo, path, ...(branch ? { branch } : {}) },
      problem,
    )
  }
  return githubPathMapSource({ token, repo, path, branch }, deps.fetch)
}
