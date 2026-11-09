import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  githubPathMapSource,
  misconfiguredSource,
  PATH_MAPS_DEFAULT_REPO,
  PathMapSourceError,
  repoProblem,
  type GithubPathMapSource,
  type LocalPathMapOrigin,
  type LocalPathMapSource,
  type MisconfiguredPathMapSource,
  type PathMapEnv,
} from '@/lib/path-map/source'

import { CONTRACTOR_PROCESS_EXAMPLE_FILE, CONTRACTOR_PROCESS_REMOTE_FILE } from './paths'

/**
 * Where the process text comes from (#545) — the path map's source (#533),
 * pointed at another file of the same private repo.
 *
 * The GitHub client, its error classification and the repo validator are
 * REUSED from `src/lib/path-map/source.ts`; only the file differs, and it is
 * the constant `processes/contractors.json`, not an env var. The repo, branch
 * and token are the path map's `PATH_MAPS_REPO` / `PATH_MAPS_BRANCH` /
 * `PATH_MAPS_GITHUB_TOKEN`: one private repo holds both. `PATH_MAPS_FILE` names
 * the map and is NOT read here. Without a token the public example committed in
 * `content/finance/` is read instead. Read-only: nothing here writes.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type ContractorProcessSource =
  GithubPathMapSource | LocalPathMapSource | MisconfiguredPathMapSource

/** The public example committed in this repo. */
export function localContractorProcessSource(root: string = process.cwd()): LocalPathMapSource {
  const origin: LocalPathMapOrigin = { kind: 'local', path: CONTRACTOR_PROCESS_EXAMPLE_FILE }
  return {
    kind: 'local',
    origin,
    async read() {
      try {
        const content = readFileSync(join(root, CONTRACTOR_PROCESS_EXAMPLE_FILE), 'utf8')
        return { content, sha: null, origin }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        throw new PathMapSourceError(
          code === 'ENOENT'
            ? `файл процесса не найден: ${CONTRACTOR_PROCESS_EXAMPLE_FILE}`
            : `файл процесса не прочитан: ${CONTRACTOR_PROCESS_EXAMPLE_FILE} (${code ?? 'ошибка чтения'})`,
          'local-read',
          undefined,
          { cause: error },
        )
      }
    },
  }
}

/**
 * Token present → the private repo; absent (or blank) → the local example. A
 * malformed `PATH_MAPS_REPO` is a `misconfigured` source whose read is a config
 * error — never a silent fall back to the example, and never a request that
 * carries the token to whatever the env happened to spell.
 */
export function contractorProcessSourceFromEnv(
  env: PathMapEnv = process.env,
  deps: { fetch?: FetchLike; root?: string } = {},
): ContractorProcessSource {
  const token = env.PATH_MAPS_GITHUB_TOKEN?.trim()
  if (!token) return localContractorProcessSource(deps.root)

  const repo = env.PATH_MAPS_REPO?.trim() || PATH_MAPS_DEFAULT_REPO
  const path = CONTRACTOR_PROCESS_REMOTE_FILE
  const branch = env.PATH_MAPS_BRANCH?.trim() || undefined
  const problem = repoProblem(repo)
  if (problem) {
    return misconfiguredSource(
      { kind: 'misconfigured', repo, path, ...(branch ? { branch } : {}) },
      problem,
    )
  }
  return githubPathMapSource({ token, repo, path, branch }, deps.fetch)
}
