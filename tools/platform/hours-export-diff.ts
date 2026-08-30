/**
 * The semantic diff behind the cutover verdict (spec 124 EARS-27).
 *
 *   pre-import export  →  import  →  post-import export  →  THIS  →  one verdict line
 *
 * Why a diff at all, when both sides are serialized the same way: EARS-27 says the
 * owner reads a verdict instead of eyeballing two JSON files, and a bare
 * "the files differ" is not a verdict — the operator inside a maintenance window
 * needs the PATH. `assessments[7].accrual` is a rounding bug to investigate;
 * `participants[3].role` is the hand-prepared seed disagreeing with the document
 * (EARS-14), which the rehearsal of EARS-26 is supposed to surface. Same red
 * light, two entirely different next actions.
 *
 * Pure and dependency-free on purpose — no `node:` imports, no database, no
 * `@/lib` — so it is unit-testable (`tests/unit/hours-export-diff.spec.ts`) and
 * cannot acquire an opinion about where the documents came from.
 *
 * Two comparisons, deliberately, because the export is a BYTE contract (EARS-11:
 * `JSON.stringify(doc, null, 2)`, top-level keys in a fixed order):
 *
 *  - the SEMANTIC one produces the paths;
 *  - the BYTE one catches what a semantic diff cannot see — a key-order or
 *    formatting difference. That is not cosmetics here: the legacy participant
 *    field order is part of the archived legacy document, and
 *    `jsonb` does not preserve key order (hence the hand-rebuilt message objects
 *    in `src/lib/hours/core/load.ts`). A key-order-only difference is reported as
 *    the single path `<serialization>` rather than silently blessed as identical.
 *
 * Comparison runs on `JSON.parse(JSON.stringify(x))` of each side, so an
 * `undefined`-valued key is absent on both sides exactly as it is in the export,
 * and a `null` snapshot is never confused with a missing one.
 */

/** One differing JSON path, with both sides rendered for the log. */
export type ExportDiffEntry = {
  /** `assessments[0].accrual`, `<root>`, or `<serialization>`. */
  path: string
  /** The value on the pre-import (source document) side. */
  source: string
  /** The value on the post-import (`core`) side. */
  core: string
}

export type ExportComparison = {
  /** Nothing differs — neither structure nor bytes. The verdict line's «identical». */
  identical: boolean
  /** The two serializations are byte-for-byte equal (EARS-11). */
  byteIdentical: boolean
  paths: ExportDiffEntry[]
}

/** How long a rendered value may get in the log before it is elided. */
const MAX_VALUE_CHARS = 120

/** The exact internal legacy-document serialization used by EARS-11 verification. */
export function serializeExport(doc: unknown): string {
  return JSON.stringify(doc, null, 2)
}

function render(value: unknown): string {
  if (value === MISSING) return '<missing>'
  const text = JSON.stringify(value) ?? String(value)
  return text.length <= MAX_VALUE_CHARS ? text : `${text.slice(0, MAX_VALUE_CHARS)}…`
}

/** Sentinel for "this side has no such key/index at all". */
const MISSING = Symbol('missing')

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function childPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`
  return path === '' ? key : `${path}.${key}`
}

/**
 * Every path at which the two values differ, depth-first, in document order.
 *
 * Arrays are compared ELEMENT-WISE rather than as wholes: order is a correctness
 * property in this document (EARS-21 — publication delivery addresses messages by
 * index), so «the array differs» would throw away the one detail worth having. A
 * length difference shows up as the extra index, with `<missing>` on the short
 * side.
 */
export function diffJson(source: unknown, core: unknown): ExportDiffEntry[] {
  const entries: ExportDiffEntry[] = []
  walk(source, core, '', entries)
  return entries
}

function walk(source: unknown, core: unknown, path: string, out: ExportDiffEntry[]): void {
  const label = path === '' ? '<root>' : path

  if (Array.isArray(source) && Array.isArray(core)) {
    for (let index = 0; index < Math.max(source.length, core.length); index += 1) {
      walk(
        index < source.length ? source[index] : MISSING,
        index < core.length ? core[index] : MISSING,
        childPath(path, index),
        out,
      )
    }
    return
  }

  if (isPlainObject(source) && isPlainObject(core)) {
    // Union of keys, source order first: a key present on one side only is a
    // finding, and reporting it in the order the source document reads keeps the
    // log next to the file the operator has open.
    const keys = [...Object.keys(source), ...Object.keys(core).filter((k) => !(k in source))]
    for (const key of keys) {
      walk(
        key in source ? source[key] : MISSING,
        key in core ? core[key] : MISSING,
        childPath(path, key),
        out,
      )
    }
    return
  }

  // Different kinds of value, or two primitives. `Object.is` rather than `===` so
  // NaN never equals itself silently and -0 is distinguished from 0.
  if (!Object.is(source, core)) {
    out.push({ path: label, source: render(source), core: render(core) })
  }
}

/**
 * Compare the pre-import export with the post-import one (EARS-27).
 *
 * Both sides are normalized through the serialization the export uses, so this
 * answers the question the clause asks — «is the reconstructed legacy document
 * the same as before the cutover?» — rather than a question about in-memory
 * objects.
 */
export function compareExports(source: unknown, core: unknown): ExportComparison {
  const sourceText = serializeExport(source)
  const coreText = serializeExport(core)
  const byteIdentical = sourceText === coreText

  const paths = byteIdentical
    ? []
    : diffJson(JSON.parse(sourceText) as unknown, JSON.parse(coreText) as unknown)

  if (!byteIdentical && paths.length === 0) {
    // Semantically equal, textually not: key order or formatting. Named, never
    // rounded down to «identical» — the export is a byte contract (EARS-11).
    paths.push({
      path: '<serialization>',
      source: `${sourceText.length} chars`,
      core: `${coreText.length} chars`,
    })
  }

  return { identical: byteIdentical, byteIdentical, paths }
}

/**
 * The verdict, as it goes into the deploy log (EARS-27).
 *
 * First line is the verdict itself and nothing else, so it can be grepped out of
 * a deploy log; the differing paths follow, one per line.
 */
export function verdictLines(comparison: ExportComparison): string[] {
  if (comparison.identical) return ['VERDICT: identical']
  return [
    `VERDICT: differs — ${comparison.paths.length} path(s)`,
    ...comparison.paths.map((entry) => `  ${entry.path}: ${entry.source} -> ${entry.core}`),
  ]
}
