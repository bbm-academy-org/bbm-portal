#!/usr/bin/env node
// product-note — a user-visible change ships the note the owner will read.
//
// Canon: docs/ci-guardrails.md §5. Severity: WARN since 2026-08-05, and its
// promotion is NOT on the clock: it is blocked on task 7.6 (#137, release-note
// delivery). Blocking a merge over a note that nothing yet delivers would buy
// friction and no delivery — promote it together with the pipeline that reads
// it, per the §5 row.
//
// Why it exists: task-cycle stage 6 already demands a report in product language
// ("what changed, for the user"), and the owner reads it in chat, where it is
// lost. The single source of truth is meant to be a `## Product note (RU)`
// section in the PR body, which 7.6 will render to the team channel. This guard
// makes that section non-optional for the PRs that actually change what a user
// sees, so the note is authored at the decision point.
//
// The rule (exact):
//   * a PR is USER-VISIBLE when its diff touches the render surface
//     (`src/**/*.tsx`, `src/**/*.css`). File-based on purpose: PR labels are not
//     applied consistently in this repo, so a label-based rule would be vacuous.
//   * user-visible + a real note                       -> PASS
//   * user-visible + absent / `none` / a placeholder   -> FAIL
//   * anything else (tooling, docs, backend, config)   -> PASS, `none` is the
//     sanctioned value there
//
// A "real note" is ≥40 characters of prose left after HTML comments (the
// template's authoring hints) are stripped — enough to be a sentence a reader
// notices, cheap enough not to become a word-count game.
//
// Run: `pnpm lint:product-note`. Findings: stderr + exit 1. Clean/skip: exit 0.

import { ghPrFiles, ghViewJson } from './lib/gh.mjs'
import {
  isEntryPoint,
  isPrEvent,
  reporter,
  repoRoot,
  resolvePrNumber,
  runMain,
  toPosix,
} from './lib/guard.mjs'

const TAG = 'product-note'

const RENDER_SURFACE_RE = /^src\/.*\.(tsx|css)$/
const TEST_RE = /(\.spec\.|\.test\.|^tests\/)/
const HEADING_RE = /^[ \t]*#{1,6}[ \t]*product[ \t]+note\b[^\n]*$/im
const NEXT_HEADING_RE = /\n[ \t]*#{1,6}[ \t]/
const MARKER_RE = /^[ \t>*-]*product[- ]note[ \t]*:[ \t]*(.*)$/im
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g
const NONE_RE = /^none[.!]?$/i
const PLACEHOLDER_RE = /^(n\/?a|tbd|todo|xxx|\.\.\.|<.*>|_+|-+)$/i
const MIN_NOTE_CHARS = 40

/** Pure decision seam: does this changed-file set touch what a user sees? */
export function isUserVisible(files) {
  return (files ?? []).map(toPosix).some((p) => RENDER_SURFACE_RE.test(p) && !TEST_RE.test(p))
}

/** Pure decision seam: PR body in, the note's text out (or null when absent). */
export function extractNote(body) {
  const text = String(body ?? '').replace(HTML_COMMENT_RE, '')
  const heading = HEADING_RE.exec(text)
  if (heading) {
    const after = text.slice(heading.index + heading[0].length)
    const end = NEXT_HEADING_RE.exec(after)
    const section = (end ? after.slice(0, end.index) : after).trim()
    if (section) return section
  }
  const marker = MARKER_RE.exec(text)
  if (marker) return marker[1].trim()
  return null
}

/** Pure decision seam: the whole verdict, so the CLI only formats it. */
export function verdict({ files, body }) {
  if (!isUserVisible(files)) {
    return { applies: false, ok: true, reason: 'no render-surface file in the diff' }
  }
  const note = extractNote(body)
  if (note === null)
    return { applies: true, ok: false, reason: 'no `## Product note (RU)` section' }
  if (NONE_RE.test(note)) return { applies: true, ok: false, reason: 'the note says `none`' }
  if (PLACEHOLDER_RE.test(note))
    return { applies: true, ok: false, reason: 'the note is a placeholder' }
  if (note.length < MIN_NOTE_CHARS) {
    return {
      applies: true,
      ok: false,
      reason: `the note is ${note.length} characters — too short to read as one`,
    }
  }
  return { applies: true, ok: true, reason: `${note.length} characters` }
}

async function main() {
  const out = reporter(TAG)
  if (!isPrEvent()) {
    out.ok(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? 'unset'}), nothing to check`,
    )
  }
  const prNumber = resolvePrNumber()
  if (!prNumber) out.ok('cannot resolve a PR number from the environment, nothing to check')

  const root = repoRoot()
  const res = ghViewJson('pr', prNumber, 'number,body', root)
  if (!res.ok) out.fail(`could not fetch PR #${prNumber} metadata: ${res.error}`)

  // Paged, not the 100-entry view array (canon §8) — this guard is WARN today,
  // but the array's silent truncation is a defect at either severity.
  const filesRes = ghPrFiles(prNumber, root)
  if (!filesRes.ok) out.fail(`could not fetch PR #${prNumber} files: ${filesRes.error}`)
  const files = filesRes.data.map((f) => f.path)
  const v = verdict({ files, body: res.data.body })
  if (!v.applies)
    out.ok(`PR #${prNumber} changes nothing a user sees (${v.reason}), rule does not apply`)
  if (v.ok) out.ok(`PR #${prNumber} carries a product note (${v.reason}).`)

  out.fail(
    `PR #${prNumber} changes the render surface but ${v.reason}. Add a \`## Product note (RU)\` ` +
      'section to the PR body: two sentences in product language about what the reader will now ' +
      'see. `none` is the sanctioned value only for a PR nobody sees. Canon: docs/ci-guardrails.md §5.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
