#!/usr/bin/env node
// Shared plumbing for the two DIFF-SCOPED UI guards of #435 —
// `primitives-first-lint.mjs` and `interaction-states-lint.mjs`.
//
// WHY A DIFF AND NOT A TREE. The ds-platform originals these two are ported from
// (`tools/lint/primitives-first-lint.ts`, `interaction-states-lint.ts`) sweep the
// whole repo with `fast-glob`. That is right there and wrong here: today's
// bbm-portal corpus under `src/app/(platform)` is full of the exact violations
// these guards describe (#435's own measurements: `onClick` 27 times against 6
// `hover:`), and a tree sweep would report a BACKLOG nobody filed instead of a
// REGRESSION someone just wrote. #435 «Out of scope» settles it: the lint runs on
// the diff; the existing violations are worked off by the per-screen migration
// tasks. So the unit of judgement is one PR's ADDED lines.
//
// The honest limit of that choice, named rather than discovered: an opening tag
// whose first line is CONTEXT and whose attributes are added lines is not seen as
// a tag at all, because only added lines are joined. That is the conservative
// direction — the guard can miss a violation, it cannot invent one — and it is
// the same direction every guard in this family is written in (canon
// docs/ci-guardrails.md §8).
//
// Nothing here imports `lib/guard.mjs`: this module is plumbing, not a guard, and
// `guard-test-coverage` keys "is a guard" off that import (§8 layout rule).

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The surface both guards judge: the platform app's view layer. */
export const PLATFORM_TSX_RE = /^src\/app\/\(platform\)\/.*\.tsx$/

/**
 * Files inside the scope that carry no rendered surface of their own: tests, and
 * the kit itself (`src/ui/**` IS the primitive layer — it is where a raw
 * `<button>` is supposed to live). The kit exclusion is defensive rather than
 * load-bearing, since `src/ui` is outside `PLATFORM_TSX_RE` anyway.
 */
export const EXEMPT_RE = /(\.spec\.tsx?$|\.test\.tsx?$|^src\/ui\/)/

/** Is this repo-relative path a platform view file this family judges? */
export function isPlatformUiFile(path) {
  const p = String(path ?? '').replace(/\\/g, '/')
  return PLATFORM_TSX_RE.test(p) && !EXEMPT_RE.test(p)
}

/**
 * The ADDED lines of a unified diff hunk set, each with its line number in the
 * NEW file. A `@@` header resets the counter; context lines advance it; removed
 * lines and the `\ No newline` marker do not.
 *
 * @param {string|null|undefined} patch
 * @returns {{line: number, text: string}[]}
 */
export function addedLines(patch) {
  const out = []
  let newLine = 0
  for (const raw of String(patch ?? '').split('\n')) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (header) {
      newLine = Number(header[1])
      continue
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue
    if (raw.startsWith('\\')) continue
    if (raw.startsWith('+')) {
      out.push({ line: newLine, text: raw.slice(1) })
      newLine++
      continue
    }
    if (raw.startsWith('-')) continue
    newLine++
  }
  return out
}

/**
 * The added lines as ONE scannable blob plus the offset -> new-file-line map, so
 * a multi-line JSX opening tag (the shape PR #430's `NativeSelect` is written in:
 * `<select` on its own line, attributes below) is matched as one tag and still
 * reported at the line it opens on.
 *
 * @param {{line: number, text: string}[]} lines
 * @returns {{text: string, raw: string, lineAt: (offset: number) => number,
 *            markers: (re: RegExp) => Set<number>}}
 */
export function addedSource(lines) {
  const raw = lines.map((l) => l.text).join('\n')
  const text = blankJsComments(raw)
  // Offset of the first character of each joined line.
  const starts = []
  let at = 0
  for (const l of lines) {
    starts.push(at)
    at += l.text.length + 1
  }
  return {
    text,
    raw,
    lineAt(offset) {
      let lo = 0
      let hi = starts.length - 1
      let found = 0
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (starts[mid] <= offset) {
          found = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      return lines[found]?.line ?? 0
    },
    /** New-file line numbers whose RAW text carries an allow-list marker. */
    markers(re) {
      const out = new Set()
      for (const l of lines) if (re.test(l.text)) out.add(l.line)
      return out
    },
  }
}

/**
 * Blank comments while PRESERVING length and line structure, so offsets computed
 * on the blanked text still map to real lines. Line comments are blanked only
 * when `//` follows start-of-line or whitespace, so a `://` inside a URL string
 * survives. (Same technique as the ds-platform original.)
 */
export function blankJsComments(src) {
  return String(src ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}

/**
 * The end (index of `>`) of the JSX opening tag starting at `start` (the `<`).
 * A naive `[^>]*` truncates at the `>` of an arrow function inside an attribute
 * expression (`onChange={(e) => …}`) — the exact shape PR #430's raw `<select>`
 * is written in — so this walks forward tracking `{}` depth and skipping string
 * and template literals. Returns -1 when no terminator is found.
 */
export function findTagEnd(src, start) {
  let depth = 0
  let quote = null
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i]
    if (quote !== null) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth <= 0) return i
  }
  return -1
}

/** How far below an allow-list marker a suppression reaches. */
export const MARKER_WINDOW = 5

/** Is `line` covered by a marker on it or within `MARKER_WINDOW` lines above? */
export function isSuppressed(markerLines, line) {
  for (let l = line - MARKER_WINDOW; l <= line; l++) if (markerLines.has(l)) return true
  return false
}

/**
 * The repo root, or the fixture tree under `LINT_FIXTURE_ROOT`. Deliberately a
 * copy of `lib/guard.mjs`'s seam rather than an import of it — see the header:
 * importing that module is what marks a file as a guard.
 */
export function repoRootForUiDiff() {
  return process.env.LINT_FIXTURE_ROOT
    ? resolve(process.env.LINT_FIXTURE_ROOT)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

/** Which of `paths` actually exist in the checked-out tree. */
export function existingPaths(paths, root = repoRootForUiDiff()) {
  return paths.filter((p) => existsSync(resolve(root, p)))
}

/**
 * One page of `gh api repos/<repo>/pulls/<n>/files`, keeping the `patch` that
 * `lib/gh.mjs`'s `normalizeFilesPage` drops. These guards need the diff CONTENT,
 * not just the changed-path list.
 */
export function normalizePatchPage(data) {
  return (Array.isArray(data) ? data : [])
    .map((f) => ({
      filename: f?.filename ?? f?.path,
      status: f?.status,
      patch: f?.patch ?? '',
    }))
    .filter((f) => f.filename)
}
