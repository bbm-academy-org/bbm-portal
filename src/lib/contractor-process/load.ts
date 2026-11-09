import {
  describeOrigin,
  PathMapSourceError,
  readFailureKind,
  type PathMapEnv,
  type PathMapOrigin,
  type PathMapReadFailureKind,
} from '@/lib/path-map/source'

import { readCachedProcess } from './cache'
import { parseContractorProcess, type ContractorProcessParseResult } from './parse'
import { contractorProcessSourceFromEnv } from './source'

/**
 * Loading the process for `/p/finance/contractor-process` (#545), mirroring
 * `getPathMap` (`src/lib/path-map/load.ts`): source → (GitHub? own cache :
 * read) → parse. The production image is a Next standalone build, so
 * `next.config.ts` traces the local example into it
 * (`outputFileTracingIncludes`) — the no-token fallback needs it.
 */

/** Where the data came from: the private repo, the local example, or a malformed env. */
export type ContractorProcessOrigin = PathMapOrigin
/** What the member is told to do about a failed read: `auth | not-found | rate-limit | network | config | local`. */
export type ContractorProcessReadFailureKind = PathMapReadFailureKind

/**
 * Why the process is not drawn: the file was read but is invalid (`parse` —
 * the errors name the field), or it could not be read at all (`read` — the
 * fix is on the server or GitHub's side; the file may be fine).
 */
export type ContractorProcessLoadFailure =
  { kind: 'parse' } | { kind: 'read'; reason: ContractorProcessReadFailureKind; message: string }

export type ContractorProcessLoad = ContractorProcessParseResult & {
  /** Absent when the process parsed. */
  failure?: ContractorProcessLoadFailure
  /** Human label of the source: `repo[@branch] · path`, or the local example's path. */
  file: string
  origin: ContractorProcessOrigin
  /** True when GitHub failed and the last good copy is shown. */
  stale: boolean
  /** With `stale`: what kind of failure made it stale — the notice is worded by it. */
  staleReason?: ContractorProcessReadFailureKind
  /** When the shown text was read (ISO). */
  asOf: string
}

export interface GetContractorProcessOptions {
  env?: PathMapEnv
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  /** App root for the local example. */
  root?: string
  now?: Date
}

/**
 * The process the page draws. Never throws: a source failure with no cached
 * copy becomes `failure: { kind: 'read', reason, message }` (the message names
 * the repo and path), invalid data `failure: { kind: 'parse' }` with `errors`.
 * The local example and a misconfigured source are read per request — only the
 * GitHub one is cached.
 */
export async function getContractorProcess(
  options: GetContractorProcessOptions = {},
): Promise<ContractorProcessLoad> {
  const now = options.now ?? new Date()
  const source = contractorProcessSourceFromEnv(options.env ?? process.env, {
    fetch: options.fetch,
    root: options.root,
  })
  const file = describeOrigin(source.origin)

  try {
    const cached =
      source.kind === 'github'
        ? await readCachedProcess(source, now)
        : { doc: await source.read(), asOf: now.toISOString(), stale: false, error: undefined }
    const parsed = parseContractorProcess(cached.doc.content)
    const staleReason = cached.stale ? failureKindOf(cached.error) : undefined
    return {
      ...parsed,
      ...(parsed.ok ? {} : { failure: { kind: 'parse' as const } }),
      file,
      origin: source.origin,
      stale: cached.stale,
      ...(staleReason ? { staleReason } : {}),
      asOf: cached.asOf,
    }
  } catch (error) {
    const message =
      error instanceof PathMapSourceError ? error.message : `процесс не прочитан: ${file}`
    console.error(`[contractor-process] cannot read the process from ${file}:`, error)
    return {
      ok: false,
      errors: [message],
      failure: { kind: 'read', reason: failureKindOf(error), message },
      file,
      origin: source.origin,
      stale: false,
      asOf: now.toISOString(),
    }
  }
}

/** Anything that is not a `PathMapSourceError` (a bug, an odd throw) reads as transient. */
function failureKindOf(error: unknown): ContractorProcessReadFailureKind {
  return error instanceof PathMapSourceError ? readFailureKind(error.reason) : 'network'
}
