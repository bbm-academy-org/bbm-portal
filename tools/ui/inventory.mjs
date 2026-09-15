#!/usr/bin/env node
// bbm-portal — `pnpm ui:inventory` (#494): every export of the `src/ui` kit, as
// one table.
//
// Why it exists. A gap claim — «the kit has no X» — was shaping plans without a
// source. On 2026-09-15 the lead grepped ONE derived artifact, the Refine
// `data-table` block, and concluded that «neither shadcn nor Refine gives a
// totals row»; `TableFooter` had been vendored in `src/ui/table.tsx` all along,
// and the owner refuted the claim with the ui.shadcn.com Table page. Same class
// as 2026-07-27's «a build taken for the original»: a derived artifact was read
// and a conclusion drawn about the source.
//
// So this command is the FIRST of the two source lines a gap claim needs; the
// second is the URL of the component page on ui.shadcn.com / ui.refine.dev. The
// rule that demands both lives in
// `.claude/skills/build-ui-from-design-system/SKILL.md` (the ladder, rung 2) —
// this file does not restate it.
//
// Deliberately dumb: no args, no network, no git, no PR metadata. It reads the
// working tree and prints. Exit 0 whenever it could read the kit.
//
// Usage:
//   pnpm ui:inventory           # the table
//   pnpm ui:inventory --json    # the same rows as JSON, for tooling
//
// The parser is a regex scan over comment-stripped source, not a TS parse: the
// kit is vendored shadcn/Refine source written in a handful of export forms, and
// a dependency-free script that runs in every worktree is worth more here than
// full syntactic fidelity. The forms it knows are exactly the ones
// tests/unit/ui-inventory.spec.ts pins.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The kit's root, relative to the repo root. The command has no other subject. */
export const KIT_DIR = 'src/ui'

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

/** One comparator for names and for files, so two runs print the same bytes. */
const byName = (a, b) => a.name.localeCompare(b.name)

/**
 * Strip line and block comments, so a commented-out export is not counted. It is
 * the one lexical subtlety the scan needs: the vendored files carry upstream's
 * own commentary, including sample code.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * The exports of ONE source file, as `{ name, kind }`, sorted by name.
 *
 * Forms understood:
 *   export function f / export async function f / export class C / export enum E
 *   export const c / export let l / export var v
 *   export type T / export interface I
 *   export { A, B as C } [from '…']  and  export type { A, B } [from '…']
 *   export default …                 → the name it is imported by: `default`
 */
export function parseExports(source) {
  const src = stripComments(source)
  const found = new Map()
  const add = (name, kind) => {
    if (name && !found.has(name)) found.set(name, { name, kind })
  }

  // `export { … }` / `export type { … }` — the form `TableFooter` is written in.
  const braceRe = /\bexport\s+(type\s+)?\{([^}]*)\}/g
  for (const [, typeOnly, body] of src.matchAll(braceRe)) {
    for (const entry of body.split(',')) {
      const parts = entry.trim().split(/\s+as\s+/)
      const exported = (parts.at(-1) ?? '').trim()
      if (!/^[A-Za-z_$][\w$]*$/.test(exported)) continue
      const inlineType = /^\s*type\s+/.test(entry)
      add(exported, typeOnly || inlineType ? 'type' : 'named')
    }
  }

  // `export default …` — one per module, and its exported name IS `default`.
  if (/\bexport\s+default\b/.test(src)) add('default', 'default')

  // Declaration exports.
  const declRe =
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g
  for (const [, keyword, name] of src.matchAll(declRe)) {
    add(name, keyword)
  }

  return [...found.values()].sort(byName)
}

/**
 * Every `src/ui/**` source file, repo-relative with POSIX separators, sorted.
 * `.css` and anything outside the kit are not the kit's API and are skipped.
 */
export function collectKitFiles(repoRoot) {
  const kitRoot = resolve(repoRoot, KIT_DIR)
  const files = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // no kit in this tree — reported by the caller, not thrown here
    }
    for (const entry of entries) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) files.push(full)
    }
  }
  if (safeIsDirectory(kitRoot)) walk(kitRoot)
  return files.map((f) => relative(repoRoot, f).split('\\').join('/')).sort()
}

function safeIsDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** One row per exported name, ordered by file and then by name. */
export function inventory(repoRoot) {
  const rows = []
  for (const file of collectKitFiles(repoRoot)) {
    const source = readFileSync(resolve(repoRoot, file), 'utf8')
    for (const { name, kind } of parseExports(source)) rows.push({ file, name, kind })
  }
  return rows
}

/** The printed table: aligned columns, a header, and the count as the last line. */
export function formatTable(rows) {
  if (rows.length === 0) {
    return [`ui:inventory — ${KIT_DIR} has no exports (is the kit present in this worktree?)`]
  }
  const header = { file: 'FILE', name: 'EXPORT', kind: 'KIND' }
  const width = (key) =>
    Math.max(header[key].length, ...rows.map((r) => String(r[key] ?? '').length))
  const fileW = width('file')
  const nameW = width('name')
  const line = (r) =>
    `${String(r.file).padEnd(fileW)}  ${String(r.name).padEnd(nameW)}  ${r.kind ?? ''}`.trimEnd()

  const files = new Set(rows.map((r) => r.file)).size
  return [
    line(header),
    ...rows.map(line),
    '',
    `${rows.length} exports across ${files} files in ${KIT_DIR}/`,
  ]
}

// ── impure CLI (skipped on import) ───────────────────────────────────────────

function main() {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..')
  const rows = inventory(repoRoot)
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2))
  else for (const printed of formatTable(rows)) console.log(printed)
}

const INVOKED = process.argv[1] ? resolve(process.argv[1]) : ''
const SELF = resolve(fileURLToPath(import.meta.url))
if (INVOKED === SELF) {
  main()
}
