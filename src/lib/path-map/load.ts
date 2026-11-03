import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readCached } from './cache'
import { parsePathMap, type ParseResult } from './parse'
import {
  describeOrigin,
  PATH_MAP_FILE,
  PathMapSourceError,
  pathMapSourceFromEnv,
  type PathMapEnv,
  type PathMapOrigin,
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

export type PathMapLoad = LoadResult & {
  origin: PathMapOrigin
  /** Blob sha of the text that was parsed (GitHub only) — what an edit must send back. */
  sha: string | null
  /** True when GitHub failed and the last good copy is shown. */
  stale: boolean
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
 * becomes the same error state as an invalid file, naming the repo/path. The
 * local example is read per request (as in v1) — only the remote one is cached.
 */
export async function getPathMap(options: GetPathMapOptions = {}): Promise<PathMapLoad> {
  const now = options.now ?? new Date()
  const source = pathMapSourceFromEnv(options.env ?? process.env, {
    fetch: options.fetch,
    root: options.root,
  })
  const file = describeOrigin(source.origin)

  try {
    const { doc, asOf, stale } =
      source.origin.kind === 'local'
        ? { doc: await source.read(), asOf: now.toISOString(), stale: false }
        : await readCached(source, now)
    return { ...parsePathMap(doc.content), file, origin: source.origin, sha: doc.sha, stale, asOf }
  } catch (error) {
    const message =
      error instanceof PathMapSourceError ? error.message : `карта не прочитана: ${file}`
    console.error(`[path-map] cannot read the map from ${file}:`, error)
    return {
      ok: false,
      errors: [message],
      file,
      origin: source.origin,
      sha: null,
      stale: false,
      asOf: now.toISOString(),
    }
  }
}
