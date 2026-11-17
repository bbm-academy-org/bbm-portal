import { parse as parseYaml } from 'yaml'

import type { Idef0Diagram, Idef0IndexEntry, Idef0Model } from './model'
import { parseKnowledge } from './registry.mjs'

/**
 * Model files → the viewer's model (#553). The bbm-kb viewer did this in its
 * `index.tsx` at build time: the model (index + diagrams) is required — there a
 * broken model failed the build, here it is an `invalid` read (the cache then
 * keeps serving the last good copy, EARS-606) — and the explanations (registry
 * + TO-BE document) are optional, exactly as in bbm-kb: without them the
 * diagrams open with bare IDs (EARS-615).
 */

export interface RawModelFiles {
  /** `model/index.yaml`. */
  index: string
  /** Diagram texts by their `file` in the index (relative to `model/`). */
  diagrams: Record<string, string>
  /** `registry-ru.md`, or `null` when it could not be read. */
  registry: string | null
  /** `process-to-be-ru.md`, or `null` when it could not be read. */
  process: string | null
  /** Why `registry` / `process` is null. */
  registryError?: string
}

export type AssembleResult = { ok: true; model: Idef0Model } | { ok: false; errors: string[] }

const INDEX = 'model/index.yaml'

/** A diagram file name from the index: relative, no `..`, no backslash, no empty segment. */
function safeFile(file: unknown): file is string {
  return (
    typeof file === 'string' &&
    file.length > 0 &&
    !file.includes('\\') &&
    file.split('/').every((part) => part.length > 0 && part !== '..' && part !== '.')
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error)
}

/**
 * The diagram list of an index text — what a source must read next. `errors`
 * is non-empty when the index is not a model index; the source reports that as
 * an invalid model rather than reading nothing.
 */
export function parseIndex(text: string): {
  index: Idef0Model['index'] | null
  errors: string[]
} {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (error) {
    return { index: null, errors: [`${INDEX}: не YAML — ${message(error)}`] }
  }
  const obj = (raw ?? {}) as { root?: unknown; diagrams?: unknown }
  const errors: string[] = []
  if (typeof obj.root !== 'string' || !obj.root) errors.push(`${INDEX}: нет корня модели (root)`)
  if (!Array.isArray(obj.diagrams) || obj.diagrams.length === 0) {
    errors.push(`${INDEX}: нет списка диаграмм (diagrams)`)
    return { index: null, errors }
  }
  const diagrams: Idef0IndexEntry[] = []
  for (const [i, entry] of (obj.diagrams as unknown[]).entries()) {
    const e = (entry ?? {}) as { id?: unknown; file?: unknown; parent?: unknown }
    if (typeof e.id !== 'string' || !safeFile(e.file)) {
      errors.push(`${INDEX}: диаграмма №${i + 1} без id или с недопустимым file`)
      continue
    }
    diagrams.push({
      id: e.id,
      file: e.file,
      parent: typeof e.parent === 'string' ? e.parent : null,
    })
  }
  if (typeof obj.root === 'string' && !diagrams.some((d) => d.id === obj.root)) {
    errors.push(`${INDEX}: корень ${obj.root} не входит в список диаграмм`)
  }
  if (errors.length) return { index: null, errors }
  return { index: { root: obj.root as string, diagrams }, errors }
}

export function assembleModel(files: RawModelFiles): AssembleResult {
  const { index, errors } = parseIndex(files.index)
  if (!index) return { ok: false, errors }

  const diagrams: Idef0Diagram[] = []
  for (const entry of index.diagrams) {
    const text = files.diagrams[entry.file]
    if (typeof text !== 'string') {
      errors.push(`model/${entry.file}: файл диаграммы ${entry.id} не прочитан`)
      continue
    }
    let raw: unknown
    try {
      raw = parseYaml(text)
    } catch (error) {
      errors.push(`model/${entry.file}: не YAML — ${message(error)}`)
      continue
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`model/${entry.file}: не диаграмма`)
      continue
    }
    // As bbm-kb's index.tsx: the index owns id and parent.
    diagrams.push({
      ...(raw as Record<string, unknown>),
      id: entry.id,
      parent: entry.parent ?? null,
    })
  }
  if (errors.length) return { ok: false, errors }

  let knowledge: Idef0Model['knowledge'] = null
  let knowledgeError: string | null = null
  if (files.registry === null || files.process === null) {
    knowledgeError = files.registryError ?? 'реестр или процесс TO-BE не прочитан'
  } else {
    try {
      knowledge = parseKnowledge(files.registry, files.process)
    } catch (error) {
      knowledgeError = message(error)
    }
  }
  return { ok: true, model: { index, diagrams, knowledge, knowledgeError } }
}
