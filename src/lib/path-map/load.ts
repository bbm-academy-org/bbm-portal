import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readCached } from './cache'
import { parsePathMap, type ParseResult } from './parse'
import {
  describeOrigin,
  PATH_MAP_FILE,
  PathMapSourceError,
  pathMapSourceFromEnv,
  readFailureKind,
  type PathMapEnv,
  type PathMapOrigin,
  type PathMapReadFailureKind,
} from './source'

/**
 * Loading the map for `/p/path`.
 *
 * Since #533 the map is read from the private repo `bbm-academy-org/path-maps`
 * through `source.ts` (token present) or, without a token, from the public
 * example `content/path-map/doctor-school.yaml`. The production image is a
 * Next standalone build, so `next.config.ts` still traces that directory into
 * it (`outputFileTracingIncludes`) — the local fallback needs it.
 */
export { PATH_MAP_FILE }

export type LoadResult = ParseResult & { file: string }

/** Read and validate the LOCAL example synchronously. Never throws. */
export function loadPathMap(root: string = process.cwd()): LoadResult {
  let source: string
  try {
    source = readFileSync(join(root, PATH_MAP_FILE), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return {
      ok: false,
      file: PATH_MAP_FILE,
      errors: [
        code === 'ENOENT'
          ? `файл карты не найден: ${PATH_MAP_FILE}`
          : `файл карты не прочитан: ${PATH_MAP_FILE} (${code ?? 'ошибка чтения'})`,
      ],
    }
  }
  return { ...parsePathMap(source), file: PATH_MAP_FILE }
}

/**
 * Why the map is not drawn (#534 review): the file was read but is invalid
 * (`parse` — fix the YAML), or it could not be read at all (`read` — the fix is
 * on the server or GitHub's side; the file may be fine). The page words the
 * two differently and must never send a member to edit a file it never saw.
 */
export type PathMapLoadFailure =
  { kind: 'parse' } | { kind: 'read'; reason: PathMapReadFailureKind; message: string }

export type PathMapLoad = LoadResult & {
  /** Absent when the map parsed. */
  failure?: PathMapLoadFailure
  origin: PathMapOrigin
  /** Blob sha of the text that was parsed (GitHub only) — what an edit must send back. */
  sha: string | null
  /** True when GitHub failed and the last good copy is shown. */
  stale: boolean
  /** With `stale`: what kind of failure made it stale — the notice is worded by it. */
  staleReason?: PathMapReadFailureKind
  /** When the shown text was read (ISO). */
  asOf: string
}

export interface GetPathMapOptions {
  env?: PathMapEnv
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  /** App root for the local example. */
  root?: string
  now?: Date
}

/**
 * The map the page draws. Never throws: a source failure with no cached copy
 * becomes `failure: { kind: 'read', reason }` (its message names the repo/path),
 * an invalid file `failure: { kind: 'parse' }`. The local example and a
 * misconfigured source are read per request — only the GitHub one is cached.
 */
export async function getPathMap(options: GetPathMapOptions = {}): Promise<PathMapLoad> {
  const now = options.now ?? new Date()
  const source = pathMapSourceFromEnv(options.env ?? process.env, {
    fetch: options.fetch,
    root: options.root,
  })
  const file = describeOrigin(source.origin)

  try {
    const cached =
      source.kind === 'github'
        ? await readCached(source, now)
        : { doc: await source.read(), asOf: now.toISOString(), stale: false, error: undefined }
    const parsed = parsePathMap(cached.doc.content)
    const staleReason = cached.stale ? failureKindOf(cached.error) : undefined
    return {
      ...parsed,
      ...(parsed.ok ? {} : { failure: { kind: 'parse' as const } }),
      file,
      origin: source.origin,
      sha: cached.doc.sha,
      stale: cached.stale,
      ...(staleReason ? { staleReason } : {}),
      asOf: cached.asOf,
    }
  } catch (error) {
    const message =
      error instanceof PathMapSourceError ? error.message : `карта не прочитана: ${file}`
    console.error(`[path-map] cannot read the map from ${file}:`, error)
    return {
      ok: false,
      errors: [message],
      failure: { kind: 'read', reason: failureKindOf(error), message },
      file,
      origin: source.origin,
      sha: null,
      stale: false,
      asOf: now.toISOString(),
    }
  }
}

/** Anything that is not a `PathMapSourceError` (a bug, an odd throw) reads as transient. */
function failureKindOf(error: unknown): PathMapReadFailureKind {
  return error instanceof PathMapSourceError ? readFailureKind(error.reason) : 'network'
}
