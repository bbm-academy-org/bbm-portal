import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parsePathMap, type ParseResult } from './parse'

/**
 * Where the map lives (#530): a plain file in the repo, relative to the app
 * root. Editing the map = editing this file and redeploying; there is no
 * database and no edit UI in v1. The production image is a Next standalone
 * build, so `next.config.ts` traces this directory into it
 * (`outputFileTracingIncludes`) — a path here that the config does not name
 * would read fine in dev and 404 in the container.
 */
export const PATH_MAP_FILE = 'content/path-map/doctor-school.yaml'

export type LoadResult = ParseResult & { file: string }

/** Read and validate the map. Never throws: a missing file is an error the page shows. */
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
