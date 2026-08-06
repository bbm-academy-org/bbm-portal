#!/usr/bin/env node
// spec-deletion — the status model of docs/specs/README.md, mechanised
// (#157, guard tranche 2).
//
// Canon: docs/specs/README.md "Status model" (the five-value ladder, the
// never-delete rule, the `superseded_by:` requirement) and
// docs/ci-guardrails.md §8 (the guard contract). Until this guard both rules
// were prose, and the README said so.
//
// ── Two finding classes, one guard ───────────────────────────────────────────
// 1. DELETION (PR-gated). «A spec is never deleted — it is retired by changing
//    its status.» A `git rm` on a spec or an ADR destroys the decision record:
//    the next session re-derives a settled question from scratch and gets a
//    different answer. Flagged when the PR's diff deletes a `.md` under
//    `docs/specs/`, `docs/superpowers/specs/` or `docs/adr/` — UNLESS one of
//    three sanctioned escapes holds:
//      (a) RENAME/COPY — `git` reports `R`/`C` under `--find-renames`. The
//          README says it in as many words: «A rename is fine — a deletion is
//          not.»
//      (b) MARKER — the PR body carries `spec-deletion: <reason + successor>`,
//          an explicit greppable justification. A bare marker is itself a
//          finding (same rule `spec-link`'s `spec-exempt:` hatch follows).
//      (c) RETIREMENT WAVE — the same PR TRANSITIONS another spec/ADR into
//          `status: Superseded` / `Retired`, so the removals are documented
//          collateral of a recorded retirement. It is a transition, not a
//          status: the base version is read too, so a spec retired months ago
//          that this PR touches for a typo does not arm the escape (review of
//          PR #160; ds has the looser semantics and describes them honestly,
//          this port's header had promised the stricter one).
// 2. STATUS SWEEP (tree, EVERY run — including a non-PR one). «Every spec file
//    carries an explicit `status:`», it is one of the five ladder values, and
//    `Superseded` names an existing successor. This is the repo-wide sweep #157
//    asks for, over `docs/specs/` AND `docs/superpowers/specs/`.
//
// The two classes carry the SAME severity (WARN) and therefore share one exit
// code — canon §2's per-class rule is about a guard reporting classes at
// DIFFERENT severities, which this one deliberately does not do.
//
// ── Why the sweep skips ADRs ─────────────────────────────────────────────────
// ADRs in this repo record status as `**Status:** Accepted` body prose
// (docs/adr/README.md), not the YAML ladder, so sweeping them would report every
// ADR as statusless — a guard finding about a convention that does not apply.
// The DELETION class still covers them: the README's never-delete rule names
// «a spec (or an ADR)» explicitly.
//
// Seams (all inert in production — unset means real behaviour):
//   LINT_FIXTURE_ROOT         scan this tree instead of the repo root
//   LINT_DIFF_NAMESTATUS_FILE serve a canned `git diff --name-status` instead of git
//   LINT_DIFF_BASE            diff base, default `origin/main`
//   LINT_BASE_TREE_DIR        serve the BASE version of a file from a fixture tree
//                             instead of `git show <base>:<path>` (escape c)
//   LINT_GH_FIXTURE_DIR       serve `gh pr view` from canned JSON (lib/gh.mjs)
//   PR_BODY / PR_NUMBER / GITHUB_EVENT_NAME   the usual PR-event wiring
//
// SEVERITY: WARN — docs/ci-guardrails.md §5, job in
// `.github/workflows/pr-body-guards.yml` with `continue-on-error: true`; the
// script exits 1 on a finding (canon §4 clause 1 — a guard that prints and exits
// 0 is a stub and is not promotable). Promotion per §4, earliest 2026-09-02.
//
// Ported from ds-platform `tools/lint/spec-deletion-lint.ts` merged with its
// `spec-status-lint.ts`: one rule about one canon section, so one register row.
//
// Run: `pnpm lint:spec-deletion`. Findings: stderr + exit 1. Clean: stdout + 0.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ghViewJson } from './lib/gh.mjs'
import {
  isEntryPoint,
  isFixturePath,
  isPrEvent,
  reporter,
  repoRoot,
  resolvePrNumber,
  runMain,
  stripNonEvidence,
  toPosix,
  walkFiles,
} from './lib/guard.mjs'

const TAG = 'spec-deletion'

/** A decision record: deleting one of these is what the DELETION class flags. */
export const RETIREABLE_PATH_RE = /^docs\/(?:specs|superpowers\/specs|adr)\/.+\.md$/

/** The files the STATUS SWEEP covers — the two spec trees, never a README. */
export const SPEC_STATUS_PATH_RE = /^docs\/(?:specs|superpowers\/specs)\/(?!README\.md$)[^/]+\.md$/

/** The status ladder, in the order docs/specs/README.md lists it. */
export const VALID_STATUSES = ['Draft', 'In dev', 'Shipped', 'Superseded', 'Retired']

/**
 * The explicit body justification. Three deliberate constraints, each one a
 * failure this guard is supposed to catch rather than commit:
 *
 * - **A reason is mandatory** (`\S` after the colon) — a bare marker justifies
 *   nothing, the same rule `spec-link`'s `spec-exempt:` hatch follows.
 * - **No list/quote decoration, and no code indentation.** The anchor is
 *   `^ {0,3}` — up to three spaces is ordinary leading whitespace, four or more
 *   (or a tab) is a markdown INDENTED CODE BLOCK, which quotes the marker
 *   exactly as a fence does. Two rounds of PR #160 review got here: the first
 *   form allowed `[-*>\s]*`, so a BLOCKQUOTED marker — the shape a pasted review
 *   comment takes — armed the hatch (blocker); the ds `^\s*` that replaced it
 *   still admitted the indented form (round-2 nit). `stripNonEvidence`
 *   deliberately leaves indentation to each marker's own anchor, so this is
 *   where it belongs. `stage-b` accepts decoration because its PR-template
 *   section renders as a bold list item; this marker has no template line and no
 *   such need.
 * - **The body is run through `stripNonEvidence` FIRST**, so a fenced example or
 *   the template's HTML comment is not a justification. A PR that deletes a spec
 *   is precisely the PR whose body is likely to quote this guard's own failure
 *   text; without the strip, the hatch fired with nobody deciding anything.
 *
 * The optional backtick is kept: `` `spec-deletion: <reason>` `` on a line of its
 * own is a genuine record, exactly as `spec-link` accepts its backticked hatch.
 */
export const SPEC_DELETION_MARKER_RE = /^ {0,3}`?spec-deletion:[ \t]*\S.*$/im

/** A status that sanctions accompanying deletions (escape c). */
const RETIRE_STATUS_RE = /^(?:Superseded|Retired)$/

/**
 * Read one field out of the leading `---` frontmatter block. Body text is never
 * consulted: a `status:` line in prose describes something, it does not declare
 * the spec's own status.
 *
 * @param {string} text
 * @param {string} field
 * @returns {string|null}
 */
export function frontmatterField(text, field) {
  const m = String(text ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const line = m[1]
    .split(/\r?\n/)
    .find((l) => new RegExp(`^${field}\\s*:`).test(l))
  if (!line) return null
  return line
    .slice(line.indexOf(':') + 1)
    .trim()
    .replace(/^["']|["']$/g, '')
}

/**
 * The STATUS SWEEP seam. `files` is `[{ path, text }]` for the whole spec
 * corpus; the successor check resolves against that same corpus, so it is a pure
 * function of its input.
 *
 * @param {{path: string, text: string}[]} files
 * @returns {{path: string, reason: string, detail: string}[]}
 */
export function sweepSpecStatus(files) {
  const known = new Set(files.map((f) => toPosix(f.path)))
  const findings = []
  for (const { path, text } of files) {
    const status = frontmatterField(text, 'status')
    if (!status) {
      findings.push({
        path,
        reason: 'statusless',
        detail: 'no `status:` in the frontmatter — a reader cannot tell a proposal from truth',
      })
      continue
    }
    if (!VALID_STATUSES.includes(status)) {
      findings.push({
        path,
        reason: 'unknown-status',
        detail: `status "${status}" is not on the ladder (${VALID_STATUSES.join(' | ')})`,
      })
      continue
    }
    if (status !== 'Superseded') continue
    const successor = frontmatterField(text, 'superseded_by')
    if (!successor) {
      findings.push({
        path,
        reason: 'superseded-without-successor',
        detail: '`Superseded` requires `superseded_by: <NNN-slug.md>` naming the replacement',
      })
      continue
    }
    const dir = toPosix(path).replace(/\/[^/]+$/, '')
    const target = successor.includes('/') ? toPosix(successor) : `${dir}/${successor}`
    if (!known.has(target)) {
      findings.push({
        path,
        reason: 'dangling-successor',
        detail: `superseded_by: ${successor} — no such spec in the corpus`,
      })
    }
  }
  return findings
}

/**
 * A TRANSITION into a retired status, not merely "carries one". `baseText` is
 * the file as of the diff base (`null` when it could not be read).
 *
 * Escape (c) exists for a documented retirement WAVE, so it must be armed by the
 * act of retiring something in this PR — not by a spec retired months ago that
 * this PR happens to touch for a typo. The first cut read the working tree only
 * and therefore accepted the latter, while the header promised the former
 * (review of PR #160, MAJOR: a port-header overclaim inherited from ds).
 *
 * Fail-closed on an unreadable base: an escape that cannot be confirmed is not
 * granted.
 *
 * @param {string|null} baseText
 * @param {string} headText
 * @returns {boolean}
 */
export function isRetirementTransition(baseText, headText) {
  const head = frontmatterField(headText, 'status')
  if (!head || !RETIRE_STATUS_RE.test(head)) return false
  if (baseText === null || baseText === undefined) return false
  const base = frontmatterField(baseText, 'status')
  return !(base && RETIRE_STATUS_RE.test(base))
}

export function isDeletion(status) {
  return String(status).charAt(0) === 'D'
}

export function isRenameOrCopy(status) {
  const c = String(status).charAt(0)
  return c === 'R' || c === 'C'
}

/**
 * Parse `git diff --name-status --find-renames`. Rename/copy lines carry two
 * paths (`R100\told\tnew`); every other status carries one.
 *
 * @param {string} text
 * @returns {{status: string, path: string, oldPath?: string}[]}
 */
export function parseNameStatus(text) {
  const out = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line) continue
    const parts = line.split('\t')
    const status = parts[0].trim()
    if (!status) continue
    if (isRenameOrCopy(status)) {
      if (parts.length >= 3) out.push({ status, oldPath: parts[1], path: parts[2] })
    } else if (parts.length >= 2) {
      out.push({ status, path: parts[1] })
    }
  }
  return out
}

/**
 * The DELETION seam. Pure: parsed diff entries + the spec/ADR files this PR
 * moved to a retired status + the PR body, in; a verdict out.
 *
 * @param {{status: string, path: string, oldPath?: string}[]} entries
 * @param {string[]} retiredInThisPr
 * @param {string} prBody
 * @returns {{ok: boolean, offenders: string[], escape: 'marker'|'superseded-transition'|null}}
 */
export function evaluateSpecDeletion(entries, retiredInThisPr, prBody) {
  const offenders = (entries ?? [])
    .filter((e) => isDeletion(e.status) && RETIREABLE_PATH_RE.test(toPosix(e.path)))
    .map((e) => toPosix(e.path))

  if (offenders.length === 0) return { ok: true, offenders: [], escape: null }
  if (SPEC_DELETION_MARKER_RE.test(stripNonEvidence(prBody))) {
    return { ok: true, offenders, escape: 'marker' }
  }
  if ((retiredInThisPr ?? []).length > 0) {
    return { ok: true, offenders, escape: 'superseded-transition' }
  }
  return { ok: false, offenders, escape: null }
}

// ── IO ───────────────────────────────────────────────────────────────────────

/** The spec corpus of `root`, as `[{ path, text }]`. */
function readSpecCorpus(root) {
  const files = walkFiles(root, {
    include: (rel) => SPEC_STATUS_PATH_RE.test(rel) && !isFixturePath(rel),
  })
  const out = []
  for (const rel of files) {
    try {
      out.push({ path: rel, text: readFileSync(resolve(root, rel), 'utf8') })
    } catch {
      // Unreadable here means the sweep cannot judge this file. It is reported
      // as a finding rather than skipped: a spec nobody can read has the same
      // effect on the next session as a spec with no status.
      out.push({ path: rel, text: '' })
    }
  }
  return out
}

function readNameStatus(root) {
  const seam = process.env.LINT_DIFF_NAMESTATUS_FILE
  if (seam) return readFileSync(resolve(seam), 'utf8')
  const base = process.env.LINT_DIFF_BASE ?? 'origin/main'
  return execFileSync('git', ['diff', '--name-status', '--find-renames', `${base}...HEAD`], {
    cwd: root,
    encoding: 'utf8',
  })
}

/**
 * The file as of the diff base. Seam `LINT_BASE_TREE_DIR` serves it from a
 * fixture dir (a second fake tree holding the "before" versions); unset, it is
 * `git show <base>:<path>`. `null` when it cannot be read — the file did not
 * exist in the base, or git is unavailable.
 */
function baseFileText(root, rel) {
  const seam = process.env.LINT_BASE_TREE_DIR
  try {
    if (seam) return readFileSync(resolve(seam, rel), 'utf8')
    const base = process.env.LINT_DIFF_BASE ?? 'origin/main'
    return execFileSync('git', ['show', `${base}:${rel}`], { cwd: root, encoding: 'utf8' })
  } catch {
    return null
  }
}

/** Spec/ADR files this PR TRANSITIONED into a retired status (escape c). */
function retiredInThisPr(root, entries) {
  const out = []
  for (const e of entries) {
    if (isDeletion(e.status) || String(e.status).charAt(0) === 'A') continue
    const rel = toPosix(e.path)
    if (!RETIREABLE_PATH_RE.test(rel)) continue
    let headText
    try {
      headText = readFileSync(resolve(root, rel), 'utf8')
    } catch {
      continue // absent from the tree — no transition can be confirmed
    }
    if (isRetirementTransition(baseFileText(root, rel), headText)) out.push(rel)
  }
  return out
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()
  const findings = []

  // ── class 2: the status sweep, on every run ────────────────────────────────
  const corpus = readSpecCorpus(root)
  // Zero spec files is not a clean sweep — it is the wrong tree. `docs/specs/`
  // is a committed directory of this repo, so measuring nothing means the guard
  // cleared nothing, and a check that never ran must not look clean. Canon §8
  // gives a CI guard only exit 0 and exit 1, so fail-closed here is exit 1 with
  // a message that is not a finding about any spec (review of PR #160, MINOR —
  // the same argument as instruction-budget's empty-corpus decision).
  if (corpus.length === 0) {
    out.fail(
      'no spec files found under docs/specs or docs/superpowers/specs. This run cleared ' +
        'nothing — it is an input problem (wrong tree), not a clean corpus. Not a finding ' +
        'about any spec: fix the invocation and re-run.',
    )
    return
  }
  for (const f of sweepSpecStatus(corpus)) {
    findings.push(`${f.reason.padEnd(28)} ${f.path}  ->  ${f.detail}`)
  }
  out.info(`status sweep: ${corpus.length} spec file(s) in docs/specs + docs/superpowers/specs`)

  // ── class 1: the deletion check, on a PR event only ────────────────────────
  const prNumber = resolvePrNumber()
  let deletionChecked = false
  if (!isPrEvent() || !prNumber) {
    out.info(
      `not a pull_request event with a resolvable PR (event=${process.env.GITHUB_EVENT_NAME ?? 'unset'}, ` +
        `pr=${prNumber || 'unset'}) — the deletion class needs a diff, skipping it`,
    )
  } else {
    deletionChecked = true
    let entries
    try {
      entries = parseNameStatus(readNameStatus(root))
    } catch (e) {
      // Fail-closed (canon §8): a diff we could not compute cleared nothing.
      out.fail(`could not compute the PR diff: ${String(e?.message ?? e).split('\n')[0]}`)
      return
    }
    const body = (() => {
      const res = ghViewJson('pr', prNumber, 'body', root)
      if (!res.ok) {
        out.info(`could not read PR #${prNumber} body (${res.error}) — treating as no marker`)
        return ''
      }
      return res.data?.body ?? ''
    })()
    const verdict = evaluateSpecDeletion(entries, retiredInThisPr(root, entries), body)
    if (verdict.offenders.length === 0) {
      out.info(`PR #${prNumber} deletes no spec/ADR file`)
    } else if (verdict.ok) {
      out.info(
        `PR #${prNumber} deletes ${verdict.offenders.length} decision record(s) with a sanctioned ` +
          `escape (${verdict.escape})`,
      )
    } else {
      for (const o of verdict.offenders) {
        findings.push(`deleted decision record    ${o}  ->  retire it by status, do not remove it`)
      }
    }
  }

  if (findings.length === 0) {
    // The success line names only what was actually checked: on a non-PR run the
    // deletion class did not execute, and asserting it clean would be a claim
    // about a check that never ran (review of PR #160, nit).
    out.ok(
      deletionChecked
        ? 'every spec carries a ladder status, and no decision record is deleted.'
        : 'every spec carries a ladder status (deletion class not run — see above).',
    )
  }
  for (const f of findings) out.finding(f)
  out.fail(
    `${findings.length} finding(s) against docs/specs/README.md "Status model". A spec is retired ` +
      'by moving its `status:` to `Superseded` (naming `superseded_by:`) or `Retired`, never by ' +
      '`git rm`; a rename is fine. If a removal really is intended, put ' +
      '`spec-deletion: <reason + successor>` on its own line in the PR body.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
