#!/usr/bin/env node
// Shared plumbing for the CI guard family (`tools/lint/*-lint.mjs`).
//
// Canon: docs/ci-guardrails.md — severity, promotion, and §8 the guard contract
// every guard here is written against. This module implements the parts of that
// contract a guard must not re-invent: the repo-root/fixture seam, the tagged
// reporter with the exit-code convention (0 = clean or nothing to check, 1 =
// findings), the tree walk, and PR-event gating.
//
// Engineering contract (mirrors tools/hooks/shared.mjs, with one inversion):
//   * FAIL-CLOSED. A CI guard that crashed cleared nothing, so an unexpected
//     exception exits 1. Session hooks are the opposite (fail-open) because they
//     sit inside the agent's own control flow — see canon §2.2.
//   * Pure decision seams are exported separately from main(); main() runs only
//     on direct invocation (entry-point guard), so importing a guard in its spec
//     is side-effect free.
//   * Every seam is inert in production: unset env var == real behaviour.

import { readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Directories never worth walking, whatever the guard is looking for. */
export const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '.claude/worktrees',
]

/**
 * Guard-test fixtures — fake repo trees that are INPUT under test, never repo
 * content. Every consumer must exclude them: a fixture holds a banned stub
 * marker, a broken workflow or a spec-shaped file on purpose, and reading one as
 * real content turns the guard's own test data into evidence about the repo
 * (review of PR #154, blocker 2 — fixtures were counted as live test coverage).
 * Prettier, ESLint, tsc and vitest exclude this same path.
 */
export const FIXTURES_PREFIX = 'tools/lint/guard-tests/fixtures/'

/** True when a repo-relative path is guard-test fixture data, not repo content. */
export function isFixturePath(rel) {
  return toPosix(rel).startsWith(FIXTURES_PREFIX)
}

/** Windows-safe path comparison: forward slashes, no trailing slash. */
export function toPosix(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '')
}

/** An HTML comment — the PR template's own instructions live in one. */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g
/** A fenced block, backtick or tilde, with up to three leading spaces. */
const FENCED_BLOCK_RE = /^ {0,3}(?:```|~~~)[\s\S]*?^ {0,3}(?:```|~~~)[^\n]*$/gm

/**
 * Drop the regions of a PR body / issue comment that TALK ABOUT a marker
 * without recording one: HTML comments and fenced code blocks. Every guard in
 * this family that reads a marker out of human text runs its body through this
 * FIRST — `stage-b` (the `Stage-B:` verdict), `spec-link` (the `spec-exempt:`
 * hatch) and `spec-deletion` (the `spec-deletion:` justification).
 *
 * This lives here rather than in each guard because the rule is one rule, and
 * three copies drift: it was fixed in `stage-b` (review of PR #151, blocker 1),
 * fixed in `spec-link`, and then shipped MISSING in `spec-deletion` (review of
 * PR #160, blocker) — an escape hatch armed by a fenced example of itself,
 * which silently disabled the guard's whole deletion class. The canon states
 * the rule for the reader: `.claude/rules/design-process.md` — «a quoted
 * example in a fenced code block — is never evidence; the check strips it».
 *
 * Not stripped here, and not by accident: a blockquote, a list item and an
 * INDENTED code block. Those are handled by each marker's OWN anchor, because
 * the guards disagree about them on purpose — `stage-b` accepts a bold list-item
 * marker (`- **Stage-B:** GO …`, the shape its PR-template section renders),
 * while `spec-deletion` and `spec-link` reject every decorated form. If you add
 * a marker guard, that anchor is yours to write: `spec-deletion` uses
 * `^ {0,3}` so four spaces or a tab (a markdown indented code block) quotes
 * rather than declares.
 */
export function stripNonEvidence(text) {
  return String(text ?? '')
    .replace(HTML_COMMENT_RE, '')
    .replace(FENCED_BLOCK_RE, '')
}

/**
 * The PARTIAL linkage of a PR body — `Part of #<parent>` (#299). Anchored to a
 * real line start (a list bullet and bold emphasis are the decorations the PR
 * template and a checklist actually produce), so mid-sentence prose — «this is
 * not part of #5» — never arms a linkage. Same-repo `#N` form only.
 */
const PART_OF_RE = /^ {0,3}(?:[-*+]\s+)?\*{0,2}part\s+of\*{0,2}\s*:?\s*#(\d+)\b/gim

/**
 * Issue numbers a body names as `Part of #N`, deduped in first-seen order.
 *
 * Lives here, next to `stripNonEvidence`, because it needs it and because THREE
 * readers of this linkage now exist — `pr-land` (the merge gate), `spec-link`
 * and `stage-b` (which resolve "the linked issue" from it). One rule, one copy:
 * the same lesson the stripper itself learned across PR #151/#160.
 *
 * @param {string|null|undefined} body
 * @returns {number[]}
 */
export function extractPartOfIssues(body) {
  const out = []
  for (const m of stripNonEvidence(body).matchAll(PART_OF_RE)) {
    const n = Number(m[1])
    if (!out.includes(n)) out.push(n)
  }
  return out
}

/**
 * The tree the guard scans. TEST SEAM `LINT_FIXTURE_ROOT` points it at a fixture
 * repo; unset, it resolves to this repo's root (tools/lint/lib -> three up).
 */
export function repoRoot() {
  return process.env.LINT_FIXTURE_ROOT
    ? resolve(process.env.LINT_FIXTURE_ROOT)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

/**
 * Tagged output with the canon's exit-code convention (§8):
 *   info    — stdout, no verdict         finding — stderr, one line per finding
 *   ok(msg) — stdout + exit 0            fail(msg) — stderr + exit 1
 * A guard that exits 0 always says why on stdout: a silent exit 0 cannot be told
 * apart from a stub, and a stub is not promotable.
 */
export function reporter(tag) {
  const write = (stream, msg) => stream.write(`[${tag}] ${msg}\n`)
  return {
    info: (msg) => write(process.stdout, msg),
    finding: (msg) => write(process.stderr, msg),
    ok(msg) {
      write(process.stdout, msg)
      process.exit(0)
    },
    fail(msg) {
      write(process.stderr, msg)
      process.exit(1)
    },
  }
}

/**
 * Every file under `root`, as repo-relative POSIX paths. `include` is an optional
 * predicate over the relative path. Written by hand rather than pulled from a
 * glob dependency: the guard family must add no runtime dependency to a repo
 * whose CI installs the whole workspace to run it.
 */
export function walkFiles(root, { include, ignore = DEFAULT_IGNORE } = {}) {
  const out = []
  const ignored = ignore.map(toPosix)
  const walk = (absDir, relDir) => {
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return // unreadable dir is not a finding
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (ignored.some((i) => rel === i || rel.endsWith(`/${i}`))) continue
      const abs = resolve(absDir, entry.name)
      let isDir = entry.isDirectory()
      if (entry.isSymbolicLink()) {
        try {
          isDir = statSync(abs).isDirectory()
        } catch {
          continue
        }
      }
      if (isDir) walk(abs, rel)
      else if (!include || include(rel)) out.push(rel)
    }
  }
  walk(resolve(root), '')
  return out.sort()
}

/** A PR-gated guard only has something to check on a `pull_request` event. */
export function isPrEvent(env = process.env) {
  return env.GITHUB_EVENT_NAME === 'pull_request'
}

/** The PR under test: explicit env first, then the Actions ref. '' if unknown. */
export function resolvePrNumber(env = process.env) {
  const explicit = env.PR_NUMBER || env.GITHUB_PR_NUMBER || ''
  if (explicit) return String(explicit)
  const m = String(env.GITHUB_REF || '').match(/refs\/pull\/(\d+)\//)
  return m ? m[1] : ''
}

/** True when `url` is the file node was actually asked to run. */
export function isEntryPoint(url) {
  const invoked = process.argv[1]
  return Boolean(invoked) && url === pathToFileURL(resolve(invoked)).href
}

/**
 * Wrap a guard's async main so an unexpected throw exits 1 with the stack —
 * fail-closed per the contract, never a silent pass.
 */
export function runMain(tag, main) {
  main().catch((e) => {
    process.stderr.write(`[${tag}] unexpected error: ${e?.stack ?? String(e)}\n`)
    process.exit(1)
  })
}
