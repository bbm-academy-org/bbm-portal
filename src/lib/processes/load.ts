import { readModelCached } from './cache'
import type { ProcessCatalogEntry } from './catalog'
import type { Idef0Model } from './model'
import { assembleModel } from './parse'
import {
  describeProcessOrigin,
  failureKind,
  type ProcessEnv,
  type ProcessFailureKind,
  type ProcessOrigin,
  ProcessSourceError,
  processSourceFromEnv,
} from './source'

/**
 * Loading a process model for its page (#553). Never throws: the page always
 * has something to render — the model, the model with a stale notice
 * (EARS-606), or an error naming the source and the reason (EARS-607).
 */

export type ProcessModelLoad =
  | {
      ok: true
      model: Idef0Model
      origin: ProcessOrigin
      /** The commit the model was read at; `null` when read at the branch or from the example. */
      revision: string | null
      /** True when the last refresh failed and the last good copy is shown. */
      stale: boolean
      /** With `stale`: the kind of failure, and its message. */
      staleReason?: ProcessFailureKind
      staleMessage?: string
      /** When the shown model was read (ISO). */
      asOf: string
    }
  | {
      ok: false
      origin: ProcessOrigin
      failure: { reason: ProcessFailureKind; message: string }
      asOf: string
    }

export interface GetProcessModelOptions {
  env?: ProcessEnv
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  /** App root for the example. */
  root?: string
  now?: Date
}

function describeFailure(
  error: unknown,
  where: string,
): { reason: ProcessFailureKind; message: string } {
  if (error instanceof ProcessSourceError)
    return { reason: failureKind(error.reason), message: error.message }
  // Anything else (a bug, an odd throw) reads as transient.
  return { reason: 'network', message: `модель не прочитана: ${where}` }
}

export async function getProcessModel(
  entry: ProcessCatalogEntry,
  options: GetProcessModelOptions = {},
): Promise<ProcessModelLoad> {
  const now = options.now ?? new Date()
  const source = processSourceFromEnv(entry, options.env ?? process.env, {
    fetch: options.fetch,
    root: options.root,
  })
  const where = describeProcessOrigin(source.origin)

  try {
    if (source.kind === 'example') {
      const assembled = assembleModel(await source.read())
      if (!assembled.ok) {
        throw new ProcessSourceError(
          `пример не разобран: ${assembled.errors.join('; ')}`,
          'invalid',
        )
      }
      return {
        ok: true,
        model: assembled.model,
        origin: source.origin,
        revision: null,
        stale: false,
        asOf: now.toISOString(),
      }
    }
    const cached = await readModelCached(source, now)
    const stale = cached.stale ? describeFailure(cached.error, where) : null
    return {
      ok: true,
      model: cached.model,
      origin: source.origin,
      revision: cached.revision,
      stale: cached.stale,
      ...(stale ? { staleReason: stale.reason, staleMessage: stale.message } : {}),
      asOf: cached.asOf,
    }
  } catch (error) {
    console.error(`[processes] cannot read the model from ${where}:`, error)
    return {
      ok: false,
      origin: source.origin,
      failure: describeFailure(error, where),
      asOf: now.toISOString(),
    }
  }
}
