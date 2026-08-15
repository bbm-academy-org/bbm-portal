#!/usr/bin/env node
// bbm-portal — `pnpm handoff:verify`: deterministic handoff-premise gate (#134).
//
// Why: a handoff is a HYPOTHESIS, not a fact — `.claude/skills/task-cycle/SKILL.md`
// stage 1 says so in prose, and `.claude/skills/wrap/SKILL.md` Phase 5 asks the
// emitting session to gate its own handoff text. Prose does not hold: the next
// session inherits «PR смержен, issue закрыт» and builds on top of a premise
// that stopped being true hours earlier. This script makes the check
// deterministic — for every ref a handoff NAMES it fetches the ACTUAL state
// from `gh` / git ancestry and compares it against the handoff's own claim on
// the same line.
//
// Ported from ds-platform `tools/gh/handoff-verify.mjs` (#134 / epic #117).
//
// Usage:
//   pnpm handoff:verify <handoff-file>
//   <emit handoff> | pnpm handoff:verify          # stdin
//
// What counts as an extractable ref (NL prose understanding is OUT of scope):
//   • Issue/PR numbers: `#N`, `PR #N`, `PR N`, `issue N`, `owner/repo#N` →
//     `gh issue view` / `gh pr view --json state` (open/closed/merged). Qualified
//     refs resolve in the named repository; unqualified refs resolve here. Every
//     call carries an explicit `--repo`, like `backlog:triage`.
//   • Commit SHAs: 7–40 hex chars carrying at least one digit AND one a-f
//     letter (heuristic vs plain numbers/words) → `git merge-base --is-ancestor
//     <sha> origin/main` (merged/unmerged).
//   • Branch names: `<feat|fix|chore|docs|refactor>/<...>` (the prefix set of
//     the task canon, `TYPE_TO_BRANCH`) → resolve `origin/<branch>` (or local),
//     then the same ancestry check.
//
// Claim heuristic: status keywords — open/closed/merged/unmerged/done (EN) and
// открыт/закрыт/влит/смержен/не влит (RU; handoffs in this repo are written in
// Russian). Keyword present and mismatching actual → STALE; matching → PASS; no
// keyword → INFO (the actual state is printed for the reader).
//
// Claim ATTRIBUTION is per SEGMENT, not per line (review PR #150, blocker 1):
// the line is split on `,` `;` `—` `–` `·` `|` `(` `)` and sentence ends, and a
// claim reaches only the refs inside its own segment. Per-line attribution made
// the most natural handoff sentence — `PR #148 смержен, issue #134 ещё открыт` —
// report `STALE #134 claimed=merged`, i.e. the tool INVENTED a stale premise on
// an honest handoff and exited 1, inverting the whole point of the gate. Two
// companion rules (see `claimForRef`): a segment naming ≥2 refs pins its claim on
// none of them and they degrade to INFO (a false PASS is cheaper than a false
// STALE in a gate that exits 1); a claim-less segment falls back to the line's
// claim only when the line names exactly ONE ref, so «#92 — не влит» keeps
// working. Residual ambiguity — one segment naming two refs AND two claims — is
// deliberately NOT resolved: it degrades to INFO. Return condition (DEBT.md):
// revisit if real handoff runs produce INFO rows that should have been caught as
// STALE, i.e. the ≥2-refs-per-segment rule starts hiding genuine drift.
//
// Approval-provenance domain: a line pairing an issue-ref with an
// owner-approval claim («owner-approved», an owner token + согласован/одобр/…)
// is verified against the issue's ACTUAL provenance (`gh issue view --json
// body,comments`): a quotable owner turn (a `Stage-N: GO` marker of the
// task-cycle go-gate, or an owner token with a quoted span «…»/"…") → PASS;
// discovery-only provenance with no quotable owner turn → STALE. This is the
// mechanised form of the canon line «handoff ≠ go» (task-cycle stage 2): the
// claim launders an agent idea as an owner decision.
//
// Qualitative-text domains (non-blocking WARN, pure text scans — no gh/git):
//   (A) COMPLETENESS CLAIMS — a phrase asserting a set is complete/empty/drained
//       («backlog empty», «всё закрыто», …) is not ref-checkable, so each
//       distinct phrase yields a WARN row + a stderr hint to re-derive the set
//       (`pnpm backlog:triage`) before acting on it.
//   (B) UNQUOTED OWNER-DIRECTIVE FRAMING — free text claiming owner direction
//       («Owner-directed», «владелец дал го», …) while the handoff carries NO
//       verbatim owner quote (heuristic: a «…» span anywhere, or an attribution
//       line — `Owner quote` / `цитата` — carrying a quoted "…" span) yields a
//       WARN row naming the unquoted claim. Issue-ref-tied approval claims
//       belong to the provenance domain above and are skipped here (no
//       double-fire).
// Neither WARN detector ever bumps `stale`, so a WARN-only run still exits 0.
// SEVERITY — this is a CLI guard (docs/ci-guardrails.md §2.3, §6.1), not a hook,
// and it carries a severity PER FINDING CLASS, discriminated by the exit code:
//   * STALE row            -> exit 1  = BLOCK. Acting on a contradicted premise
//                                       is the failure this tool exists to stop.
//                                       Demotion per canon §4 on one confirmed
//                                       false STALE.
//   * qualitative WARN rows -> exit 0 = WARN. Heuristics over free text with no
//                                       checkable referent; never bump `stale`.
//   * unreadable input      -> exit 2 = NOT a verdict (canon §2.3). Neither
//                                       clean nor a finding — re-run correctly.
// The exit codes are pinned by tests/unit/handoff-verify.spec.ts: for a CLI
// guard the exit code IS the severity, so it is asserted, never asserted in
// prose. (The first version of the canon recorded this file as a flat "WARN"
// hook, contradicting the exit 1 below — corrected in review of PR #154.)
//
// Deliberately OUT of scope (differences from the ds-platform original):
//   • the task-kind-vs-surface / PRD check — it asserts ds-platform's
//     `specs/features/<NNN-slug>/NNN-product.md` layout and ADR-0014; this repo
//     keeps flat `docs/specs/NNN-*.md` with no PRD tier, so the check would be
//     dead code asserting a convention we do not have;
//   • Project 2 («BBM Platform») board status — the issue/PR state is the
//     source of truth for premise staleness, and board drift is already
//     reported by `pnpm backlog:triage`;
//   • Plane `BBMP-*` identifiers — verifying them needs the Plane REST path,
//     not `gh`.
//
// Output: one machine-parseable row per (ref, claim):
//   PASS|STALE|INFO|WARN <ref> claimed=<claim|-> actual=<state>
// then a summary line. An unknown/deleted ref (gh 404, unresolvable sha/branch)
// → STALE: a premise about a ref that no longer resolves is stale by definition
// (branches here are deleted on squash-merge by `pnpm pr:land`).
//
// Exit codes: 0 = no STALE; 1 = ≥1 STALE row; 2 = usage / input error.
//
// Pure node, no bash-isms — runs on Windows/PowerShell and POSIX alike. The
// extraction/claim/verdict logic is exported for unit tests
// (tests/unit/handoff-verify.spec.ts); all `gh`/`git` calls go through an
// injectable runner so tests never shell out.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { REPO, TYPE_TO_BRANCH, ghResult } from './lib/gh.mjs'

const TAG = '[handoff:verify]'

const GIT_MAX_BUFFER = 16 * 1024 * 1024

/**
 * One output row. The same shape for every domain (state, provenance, WARN
 * detectors) — that is what makes the output machine-parseable and lets the
 * spec assert rows without narrowing per domain.
 * @typedef {{verdict: string, ref: string, claim: string|null, actual: string}} HandoffRow
 */

/** The injectable gh/git seam: argv array in, `{status, stdout, stderr}` out.
 * @typedef {{status: number, stdout: string, stderr: string}} RunResult
 * @typedef {{gh: (args: string[]) => RunResult, git: (args: string[]) => RunResult}} Runner
 */

/**
 * Branch prefixes of the task canon (`TYPE_TO_BRANCH`) plus the two manual
 * prefixes the canon allows outside the Type→branch map (`docs/`, `refactor/`).
 */
export const BRANCH_PREFIXES = [...new Set([...Object.values(TYPE_TO_BRANCH), 'docs', 'refactor'])]

// Issue/PR-number pattern, shared by ref extraction and approval-claim
// extraction (fresh instance per use — /g regexes are stateful). A directly
// qualified `owner/repo#N` keeps that repository identity through every gh
// resolver; an unqualified ref belongs to this repository.
const numRe = () =>
  /(?:(?<repo>[a-z0-9_.-]+\/[a-z0-9_.-]+))?(?:\b(?<hint>PRs?|pull requests?|issues?)\s*[#№]?\s*|[#№])(?<number>\d{1,6})\b/gi

// An extension-bearing token is a file reference before shape-only GitHub,
// branch and SHA heuristics run. Its range includes any suffix and stops at
// claim-segment punctuation so an adjacent ref remains independent.
const fileTokenRe = () => /(?=[^\s,;—–·|()]*\.[a-z0-9]+\b)[^\s,;—–·|()]+/gi

function fileTokenRanges(line) {
  return [...String(line).matchAll(fileTokenRe())].map((m) => [m.index, m.index + m[0].length])
}

function overlapsAnyRange(start, end, ranges) {
  return ranges.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart)
}

function maskRanges(line, ranges) {
  return ranges.reduce(
    (masked, [start, end]) =>
      `${masked.slice(0, start)}${' '.repeat(end - start)}${masked.slice(end)}`,
    String(line),
  )
}

function numberMatches(line, fileRanges = fileTokenRanges(line)) {
  return [...String(line).matchAll(numRe())].filter(
    (m) => !overlapsAnyRange(m.index, m.index + m[0].length, fileRanges),
  )
}

function numberRefLabel(repo, n) {
  return repo === REPO ? `#${n}` : `${repo}#${n}`
}

/** Owner token on a line (EN/RU), ignoring the CODEOWNERS false positive. */
function hasOwnerToken(line) {
  return /владел|owner/i.test(String(line).replace(/CODEOWNERS/gi, ''))
}

/**
 * TIGHT approval-claim predicate shared by the issue-ref-tied provenance domain
 * and the free-text owner-directive domain: `owner-approved`/`owner approved`,
 * or an owner token (владел/owner, not CODEOWNERS) plus an approval stem on the
 * same line. Deliberately does NOT fire on a bare `APPROVE` / `approved` line
 * without an owner token — a `VERDICT: APPROVE` from the review subagent
 * (`pr:land` review gate) is not an owner decision.
 */
function isApprovalClaimLine(line) {
  return (
    /owner[-\s]approved/i.test(line) ||
    // NB: Cyrillic stems are matched BARE — JS \b/\w are ASCII-only, so a stem
    // with a suffix («согласовал» vs «согласован») must not be anchored.
    (hasOwnerToken(line) && /согласова|одобр|утвержд|подтвердил|выбрал|дал\s+го|approved?/i.test(line))
  )
}

/**
 * Separators that end a claim's reach inside a line: list punctuation, dashes,
 * parenthetical asides and sentence ends (a `.`/`!`/`?` followed by whitespace
 * — so `v1.2` and `1.5×` stay intact).
 */
const SEGMENT_SPLIT_RE = /[,;—–·|()]|[.!?](?=\s|$)/g

/**
 * Split a line into claim segments, keeping each segment's offsets so a ref can
 * be mapped to the segment it actually sits in (review PR #150, blocker 1).
 * @param {string} line
 * @returns {{text: string, start: number, end: number}[]}
 */
export function splitSegments(line) {
  const s = String(line)
  const segments = []
  let start = 0
  for (const m of s.matchAll(SEGMENT_SPLIT_RE)) {
    segments.push({ text: s.slice(start, m.index), start, end: m.index })
    start = m.index + m[0].length
  }
  segments.push({ text: s.slice(start), start, end: s.length })
  return segments
}

/** Index of the segment covering `at`; the last segment catches the tail. */
function segmentIndexAt(segments, at) {
  const i = segments.findIndex((seg) => at >= seg.start && at < seg.end)
  return i === -1 ? segments.length - 1 : i
}

/**
 * Extract every verifiable ref from the handoff text, each carrying the SEGMENT
 * it sits in plus the two attribution flags dedupeRefs needs (`ambiguous`,
 * `soleOnLine`).
 * @param {string} text
 * @returns {{kind: "issue"|"pr"|"number"|"sha"|"branch", value: string|number, repo?: string, line: string, lineNo: number, segment: string, claimLine: string, claimSegment: string, ambiguous: boolean, soleOnLine: boolean}[]}
 */
export function extractRefs(text) {
  const refs = []
  const lines = String(text).split(/\r?\n/)
  lines.forEach((line, i) => {
    const lineNo = i + 1
    const segments = splitSegments(line)
    const found = []
    const qualifiedNumberRanges = []
    const fileRanges = fileTokenRanges(line)

    // Issue/PR numbers: a `#`/`№`-prefixed number anywhere, or a bare number
    // directly after a "PR" / "pull request" / "issue" word. A bare number with
    // neither is NOT a ref (too many false positives — ports, dates, counts).
    for (const m of numberMatches(line, fileRanges)) {
      const hint = (m.groups?.hint ?? '').toLowerCase()
      const repo = m.groups?.repo
      if (repo) qualifiedNumberRanges.push([m.index, m.index + m[0].length])
      const kind =
        hint.startsWith('pr') || hint.startsWith('pull')
          ? 'pr'
          : hint.startsWith('issue')
            ? 'issue'
            : 'number'
      found.push({
        kind,
        value: Number(m.groups?.number),
        repo: repo ?? REPO,
        line,
        lineNo,
        at: m.index,
        end: m.index + m[0].length,
      })
    }

    // Branch names: <prefix>/<N>-<slug> (canon §2 / `pnpm task:worktree`).
    const branchRe = new RegExp(`\\b(?:${BRANCH_PREFIXES.join('|')})/[a-z0-9][a-z0-9._-]*`, 'g')
    const branchRanges = []
    for (const m of line.matchAll(branchRe)) {
      const end = m.index + m[0].length
      branchRanges.push([m.index, end])
      const insideQualifiedNumber = qualifiedNumberRanges.some(
        ([start, rangeEnd]) => m.index >= start && end <= rangeEnd,
      )
      const insideFileToken = overlapsAnyRange(m.index, end, fileRanges)
      // Otherwise a nested path such as `docs/adr/...` becomes the shorter,
      // unrelated branch `docs/adr`; qualified issue refs own their whole token.
      if (line[end] === '/' || insideQualifiedNumber || insideFileToken) continue
      found.push({ kind: 'branch', value: m[0], line, lineNo, at: m.index, end })
    }

    // Commit SHAs: 7–40 hex, must carry a digit AND an a-f letter (heuristic —
    // rejects plain numbers like 1234567 and words like "decade"), and must not
    // sit inside an already-captured branch token.
    const shaRe = /\b[0-9a-f]{7,40}\b/g
    for (const m of line.matchAll(shaRe)) {
      const tok = m[0]
      if (!/[a-f]/.test(tok) || !/\d/.test(tok)) continue
      const inBranch = branchRanges.some(([s, e]) => m.index >= s && m.index + tok.length <= e)
      const inQualifiedNumber = qualifiedNumberRanges.some(
        ([s, e]) => m.index >= s && m.index + tok.length <= e,
      )
      const inFileToken = overlapsAnyRange(m.index, m.index + tok.length, fileRanges)
      if (inBranch || inQualifiedNumber || inFileToken) continue
      found.push({ kind: 'sha', value: tok, line, lineNo, at: m.index, end: m.index + tok.length })
    }

    // Claims use a length-preserving masked view; original split offsets and
    // diagnostic strings stay untouched.
    const claimLine = maskRanges(line, [...fileRanges, ...found.map((r) => [r.at, r.end])])

    // Attribution inputs: which segment each ref sits in, and whether that
    // segment holds a second ref (then no claim may be pinned on either).
    const perSegment = new Map()
    for (const r of found) {
      r.segIdx = segmentIndexAt(segments, r.at)
      perSegment.set(r.segIdx, (perSegment.get(r.segIdx) ?? 0) + 1)
    }
    for (const r of found) {
      const segment = segments[r.segIdx] ?? { text: r.line, start: 0, end: r.line.length }
      refs.push({
        kind: r.kind,
        value: r.value,
        repo: r.repo,
        line: r.line,
        lineNo: r.lineNo,
        segment: segment.text,
        claimLine,
        claimSegment: claimLine.slice(segment.start, segment.end),
        ambiguous: (perSegment.get(r.segIdx) ?? 0) >= 2,
        soleOnLine: found.length === 1,
      })
    }
  })
  return refs
}

function claimLineAt(line, lineNo, refs) {
  return (
    refs.find((ref) => ref.lineNo === lineNo)?.claimLine ?? maskRanges(line, fileTokenRanges(line))
  )
}

/**
 * Parse the status CLAIM a line makes about the refs on it.
 * Order matters: negated-merge forms («не влит», "not merged") must win over
 * their positive substrings.
 * @param {string} line
 * @returns {"open"|"closed"|"merged"|"unmerged"|null}
 */
export function parseClaim(line) {
  // NB: JS \b / \w are ASCII-only — Cyrillic stems are matched bare.
  const l = String(line).toLowerCase().replace(/ё/g, 'е')
  if (/\bunmerged\b|\bnot\s+merged\b|не\s+(?:влит|смерж|замерж|смердж)/.test(l)) return 'unmerged'
  if (/\bmerged\b|смерж|замерж|смердж|влит|приземл/.test(l)) return 'merged'
  if (/\bclosed\b|\bdone\b|закрыт/.test(l)) return 'closed'
  if (/\bopen(?:ed)?\b|открыт/.test(l)) return 'open'
  return null
}

/**
 * Verdict for one (claim, actual) pair. `actual` is one of
 * open|closed|merged|unmerged|not-found.
 * A "closed" claim accepts a merged PR (merged ⇒ closed); a "merged" claim does
 * NOT accept a closed-unmerged PR; "open"/"unmerged" cross-accept for the
 * branch/sha domain.
 * @param {"open"|"closed"|"merged"|"unmerged"|null} claim
 * @param {string} actual
 * @returns {"PASS"|"STALE"|"INFO"}
 */
export function verdictFor(claim, actual) {
  if (actual === 'not-found') return 'STALE'
  if (claim == null) return 'INFO'
  const accepts = {
    open: (a) => a === 'open' || a === 'unmerged',
    closed: (a) => a === 'closed' || a === 'merged',
    merged: (a) => a === 'merged',
    unmerged: (a) => a === 'unmerged' || a === 'open',
  }
  return accepts[claim](actual) ? 'PASS' : 'STALE'
}

/**
 * Claim attributed to ONE ref occurrence (review PR #150, blocker 1). Three
 * rules, in order:
 *   1. the claim of the SEGMENT the ref sits in — so
 *      `PR #148 смержен, issue #134 ещё открыт` gives merged/open, not
 *      merged/merged;
 *   2. a segment holding ≥2 refs pins its claim on NONE of them (→ INFO,
 *      "here is the actual state"): a false PASS is cheaper than a false STALE
 *      in a gate that exits 1;
 *   3. a claim-less segment falls back to the LINE's claim only when the line
 *      names exactly one ref — no ambiguity is possible there, and this keeps
 *      the shapes that separate ref and claim by punctuation («#92 — не влит»)
 *      working exactly as before.
 * @param {ReturnType<typeof extractRefs>[number]} ref
 * @returns {"open"|"closed"|"merged"|"unmerged"|null}
 */
export function claimForRef(ref) {
  if (ref.ambiguous) return null
  const own = parseClaim(ref.claimSegment ?? ref.segment ?? ref.line)
  if (own) return own
  return ref.soleOnLine ? parseClaim(ref.claimLine ?? ref.line) : null
}

/**
 * Dedupe raw refs into one entry per distinct ref, each carrying the set of
 * distinct claims made about it. Claim-less occurrences are dropped when the
 * same ref also has a claimed occurrence (the claim rows subsume the INFO row);
 * a ref with only claim-less occurrences keeps one `null` claim.
 * @param {ReturnType<typeof extractRefs>} refs
 */
export function dedupeRefs(refs) {
  const byId = new Map()
  for (const r of refs) {
    const id =
      r.kind === 'sha' || r.kind === 'branch'
        ? `${r.kind}:${r.value}`
        : `num:${r.repo ?? REPO}:${r.value}`
    let entry = byId.get(id)
    if (!entry) {
      entry = { kind: r.kind, value: r.value, repo: r.repo, claims: new Set(), lineNo: r.lineNo }
      byId.set(id, entry)
    }
    // A concrete issue/pr hint beats an unhinted `#N` for lookup ordering.
    if (entry.kind === 'number' && r.kind !== 'number') entry.kind = r.kind
    const claim = claimForRef(r)
    if (claim) entry.claims.add(claim)
  }
  return [...byId.values()].map((e) => ({
    kind: e.kind,
    value: e.value,
    repo: e.repo,
    claims: e.claims.size > 0 ? [...e.claims] : [null],
    lineNo: e.lineNo,
  }))
}

/**
 * Extract owner-approval CLAIMS about issue refs. A line carries an approval
 * claim when it has ≥1 issue-ref AND matches the TIGHT approval pattern.
 * @param {string} text
 * @param {ReturnType<typeof extractRefs>} [refs]
 * @returns {{issue: number, repo: string, line: string, lineNo: number}[]} deduped per repository and issue
 */
export function extractApprovalClaims(text, refs = extractRefs(text)) {
  const claims = []
  const seen = new Set()
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      const matches = numberMatches(line)
      if (matches.length === 0 || !isApprovalClaimLine(claimLineAt(line, i + 1, refs))) return
      for (const m of matches) {
        const issue = Number(m.groups?.number)
        const repo = m.groups?.repo ?? REPO
        const id = `${repo}#${issue}`
        if (seen.has(id)) continue
        seen.add(id)
        claims.push({ issue, repo, line, lineNo: i + 1 })
      }
    })
  return claims
}

/**
 * Resolve an issue's approval PROVENANCE via `gh issue view --json
 * body,comments` (its own payload — separate from the state cache).
 * `owner-quoted` when any line of the body/comments carries a task-cycle
 * `Stage-N: GO` marker or an owner token with a quoted span («…» / "…" / “…”);
 * `no-owner-provenance` otherwise; `not-found` on gh failure/404.
 * @param {Runner} runner
 * @param {number} n
 * @param {string} [repo]
 * @returns {"owner-quoted"|"no-owner-provenance"|"not-found"}
 */
export function resolveProvenance(runner, n, repo = REPO) {
  const res = runner.gh(ghViewArgs('issue', n, 'body,comments', repo))
  if (res.status !== 0) return 'not-found'
  let payload
  try {
    payload = JSON.parse(res.stdout)
  } catch {
    return 'not-found'
  }
  const texts = [
    String(payload.body ?? ''),
    ...(Array.isArray(payload.comments) ? payload.comments.map((c) => String(c?.body ?? '')) : []),
  ]
  for (const line of texts.join('\n').split(/\r?\n/)) {
    if (/stage[-\s]?(?:a|b|1a|1b|\d)\s*[:：]\s*go\b/i.test(line)) return 'owner-quoted'
    if (hasOwnerToken(line) && /«[^«»]+»|"[^"]+"|“[^“”]+”/.test(line)) return 'owner-quoted'
  }
  return 'no-owner-provenance'
}

/**
 * Verify approval claims against actual issue provenance. Rows share the
 * machine-parseable shape of verifyRefs(); STALE rows count into the exit-1
 * total, and each no-owner-provenance claim yields one stderr hint line.
 * @param {ReturnType<typeof extractApprovalClaims>} claims
 * @param {Runner} runner
 * @returns {{rows: HandoffRow[], stale: number, hints: string[]}}
 */
export function verifyApprovalClaims(claims, runner) {
  const rows = []
  const hints = []
  for (const c of claims) {
    const actual = resolveProvenance(runner, c.issue, c.repo)
    const ref = numberRefLabel(c.repo, c.issue)
    rows.push({
      verdict: actual === 'owner-quoted' ? 'PASS' : 'STALE',
      ref,
      claim: 'owner-approved',
      actual,
    })
    if (actual === 'no-owner-provenance')
      hints.push(
        `${TAG} ${ref} is claimed owner-approved but its provenance carries no quotable owner turn (discovery-only?) — «handoff ≠ go» (task-cycle stage 2): reconcile with the owner before building.`,
      )
  }
  return { rows, stale: rows.filter((r) => r.verdict === 'STALE').length, hints }
}

// ── qualitative-completeness domain (Detector A — non-blocking WARN) ─────────
// A handoff phrase asserting a SET is complete/empty/drained cannot be verified
// against any extractable ref — the consumer must re-derive the set (`pnpm
// backlog:triage`) instead of trusting the prose. The phrase list is
// deliberately CONSERVATIVE (false positives are the named risk); one claim per
// line (first matching pattern), deduped by phrase text across the handoff.

/** Matched against the lowercased, ё→е-normalized line. Order: specific first. */
const COMPLETENESS_PATTERNS = [
  /\bbacklog\s+(?:is\s+)?empty\b/,
  /\bfully\s+drained\b/,
  /\ball\s+(?:cleared|done|drained|merged)\b/,
  /\bnothing\s+(?:left|open|remaining)\b/,
  /\bepic\s+complete\b/,
  // NB: JS \b / \w are ASCII-only — Cyrillic stems are matched bare; bare stems
  // also cover the safe inflections (вычищено/вычищены, закрыт(а/о/ы)).
  /бэклог\s+пуст/,
  /все\s+вычищен/,
  /все\s+задачи\s+закрыт/,
  /хвост\s+пуст/,
  /полностью\s+закрыт/,
]

/**
 * Extract qualitative completeness claims (Detector A).
 * @param {string} text
 * @returns {{phrase: string, line: string, lineNo: number}[]}
 */
export function extractCompletenessClaims(text) {
  const claims = []
  const seen = new Set()
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      const l = line.toLowerCase().replace(/ё/g, 'е')
      for (const re of COMPLETENESS_PATTERNS) {
        const m = l.match(re)
        if (!m) continue
        const phrase = m[0].replace(/\s+/g, ' ')
        if (!seen.has(phrase)) {
          seen.add(phrase)
          claims.push({ phrase, line, lineNo: i + 1 })
        }
        break // one claim per line — the first matching pattern wins
      }
    })
  return claims
}

/**
 * WARN rows for completeness claims — pure, no runner, never bumps `stale`.
 * @param {ReturnType<typeof extractCompletenessClaims>} claims
 * @returns {{rows: HandoffRow[], hints: string[], warn: number}}
 */
export function verifyCompletenessClaims(claims) {
  const rows = []
  const hints = []
  for (const c of claims) {
    rows.push({ verdict: 'WARN', ref: `L${c.lineNo}`, claim: 'set-complete', actual: 'not-ref-checkable' })
    hints.push(
      `${TAG} completeness claim '${c.phrase}' is not ref-checkable — run \`pnpm backlog:triage\` before acting on it.`,
    )
  }
  return { rows, hints, warn: rows.length }
}

// ── unquoted owner-directive domain (Detector B — non-blocking WARN) ─────────
// Free text claiming owner direction («Owner-directed», «владелец дал го») is
// UNCONFIRMED agent framing unless the handoff carries a verbatim owner quote.
// Issue-ref-tied approval claims are the provenance domain above (verified
// against issue provenance) and are skipped here — no double-fire.

/** Matched against the ё→е-normalized line (case-insensitive). */
const OWNER_DIRECTIVE_PATTERNS = [
  /owner[-\s]directed/i,
  /owner[-\s]approved/i,
  /по\s+указанию\s+владельца/i,
  /одобрен[оаы]?\s+владельцем/i,
  /владелец\s+(?:дал\s+)?(?:го|добро|согласовал|утвердил)/i,
  /го\s+(?:получено|от\s+владельца)/i,
]

/**
 * Extract free-text owner-directive claims (Detector B). One claim per line
 * (first matching pattern); lines the provenance domain already verifies
 * (approval claim + issue ref on the same line) are excluded.
 * @param {string} text
 * @param {ReturnType<typeof extractRefs>} [refs]
 * @returns {{phrase: string, line: string, lineNo: number}[]}
 */
export function extractOwnerDirectiveClaims(text, refs = extractRefs(text)) {
  const claims = []
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      const claimLine = claimLineAt(line, i + 1, refs)
      // The provenance domain verifies issue-ref-tied approval claims against
      // the issue itself — skip those lines so one claim never fires twice.
      if (isApprovalClaimLine(claimLine) && numberMatches(line).length > 0) return
      const norm = claimLine.replace(/ё/g, 'е').replace(/Ё/g, 'Е')
      for (const re of OWNER_DIRECTIVE_PATTERNS) {
        const m = norm.match(re)
        if (m) {
          claims.push({ phrase: m[0], line, lineNo: i + 1 })
          return // one claim per line
        }
      }
    })
  return claims
}

/**
 * Verbatim-owner-quote evidence heuristic (documented + deliberately simple):
 * TRUE when the handoff carries a «…» span ANYWHERE (the house style for owner
 * quotes — see the rules files), or an attribution line (`Owner quote` /
 * `цитата`) carrying a "…" / “…” span.
 * @param {string} text
 * @returns {boolean}
 */
export function hasOwnerQuoteEvidence(text) {
  const s = String(text)
  if (/«[^«»]+»/.test(s)) return true
  for (const line of s.split(/\r?\n/)) {
    if (/owner\s+quote|цитат/i.test(line) && /"[^"]+"|“[^“”]+”/.test(line)) return true
  }
  return false
}

/**
 * Verify owner-directive claims against quote evidence — pure, never bumps
 * `stale`. Quote present → PASS row; absent → WARN row + stderr hint.
 * @param {ReturnType<typeof extractOwnerDirectiveClaims>} claims
 * @param {boolean} quoteEvidence result of hasOwnerQuoteEvidence(text)
 * @returns {{rows: HandoffRow[], hints: string[], warn: number}}
 */
export function verifyOwnerDirectiveClaims(claims, quoteEvidence) {
  const rows = []
  const hints = []
  for (const c of claims) {
    if (quoteEvidence) {
      rows.push({ verdict: 'PASS', ref: `L${c.lineNo}`, claim: 'owner-directive', actual: 'owner-quote-present' })
    } else {
      rows.push({ verdict: 'WARN', ref: `L${c.lineNo}`, claim: 'owner-directive', actual: 'no-owner-quote' })
      hints.push(
        `${TAG} '${c.phrase}' (line ${c.lineNo}) claims owner direction but the handoff carries no verbatim owner quote («…» / attributed "…") — treat it as UNCONFIRMED agent framing and reconcile with the owner before executing.`,
      )
    }
  }
  return { rows, hints, warn: rows.filter((r) => r.verdict === 'WARN').length }
}

// ── gh / git access (injectable seam) ────────────────────────────────────────

/**
 * `gh issue|pr view <n> --repo <slug> --json <fields>`. The explicit `--repo`
 * is the `backlog:triage` convention: a handoff is usually verified from a
 * session worktree, and inferring the repo from cwd is one more premise.
 */
export function ghViewArgs(kind, n, fields, repo = REPO) {
  return [kind === 'pr' ? 'pr' : 'issue', 'view', String(n), '--repo', repo, '--json', fields]
}

/**
 * Default runner — real `gh` (through the shared `ghResult` wrapper: argv array,
 * never a shell string) and real `git` via spawnSync.
 */
export function defaultRunner() {
  const git = (args) => {
    const res = spawnSync('git', args, { encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER })
    if (res.error) return { status: -1, stdout: '', stderr: String(res.error.message) }
    return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
  }
  return {
    gh: (args) => {
      const res = ghResult(args)
      return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
    },
    git,
  }
}

/** `gh issue|pr view <n> --json state` → canonical state string or null. */
function ghState(runner, kind, n, repo) {
  const res = runner.gh(ghViewArgs(kind, n, 'state', repo))
  if (res.status !== 0) return null
  try {
    const s = String(JSON.parse(res.stdout).state ?? '').toLowerCase()
    return s === 'open' || s === 'closed' || s === 'merged' ? s : null
  } catch {
    return null
  }
}

/** Resolve a #N to its actual state, trying the hinted kind first. */
function resolveNumber(runner, kind, n, repo) {
  const order = kind === 'pr' ? ['pr', 'issue'] : ['issue', 'pr']
  for (const k of order) {
    const s = ghState(runner, k, n, repo)
    if (s) return s
  }
  return 'not-found'
}

/** Resolve a sha/branch to merged|unmerged|not-found vs origin/main. */
function resolveGitRef(runner, kind, value) {
  let sha = value
  if (kind === 'branch') {
    sha = null
    for (const ref of [`refs/remotes/origin/${value}`, `refs/heads/${value}`]) {
      const res = runner.git(['rev-parse', '--verify', '--quiet', ref])
      if (res.status === 0 && res.stdout.trim()) {
        sha = res.stdout.trim()
        break
      }
    }
    if (!sha) return 'not-found'
  } else {
    const exists = runner.git(['cat-file', '-e', `${sha}^{commit}`])
    if (exists.status !== 0) return 'not-found'
  }
  const anc = runner.git(['merge-base', '--is-ancestor', sha, 'origin/main'])
  if (anc.status === 0) return 'merged'
  if (anc.status === 1) return 'unmerged'
  return 'not-found'
}

/**
 * Verify every extracted ref against actual gh/git state.
 * @param {ReturnType<typeof extractRefs>} refs
 * @param {Runner} runner
 * @returns {{rows: HandoffRow[], stale: number}}
 */
export function verifyRefs(refs, runner) {
  const rows = []
  const cache = new Map()
  for (const entry of dedupeRefs(refs)) {
    const cacheKey =
      entry.kind === 'sha' || entry.kind === 'branch'
        ? `${entry.kind}:${entry.value}`
        : `num:${entry.repo ?? REPO}:${entry.value}`
    let actual = cache.get(cacheKey)
    if (actual === undefined) {
      actual =
        entry.kind === 'sha' || entry.kind === 'branch'
          ? resolveGitRef(runner, entry.kind, entry.value)
          : resolveNumber(runner, entry.kind, entry.value, entry.repo ?? REPO)
      cache.set(cacheKey, actual)
    }
    const refLabel =
      entry.kind === 'sha' || entry.kind === 'branch'
        ? String(entry.value)
        : numberRefLabel(entry.repo ?? REPO, entry.value)
    for (const claim of entry.claims) {
      rows.push({ verdict: verdictFor(claim, actual), ref: refLabel, claim, actual })
    }
  }
  return { rows, stale: rows.filter((r) => r.verdict === 'STALE').length }
}

// ── orchestration seam ───────────────────────────────────────────────────────

/**
 * One machine-parseable output row.
 * @param {HandoffRow} row
 */
export function renderRow(row) {
  return `${row.verdict} ${row.ref} claimed=${row.claim ?? '-'} actual=${row.actual}`
}

/**
 * The summary line; `stale > 0` is exactly the exit-1 condition.
 * @param {{rows: HandoffRow[], stale: number, warn: number}} result
 */
export function renderSummary({ rows, stale, warn }) {
  const pass = rows.filter((r) => r.verdict === 'PASS').length
  const info = rows.filter((r) => r.verdict === 'INFO').length
  return (
    `${TAG} ${rows.length} row(s): ${pass} PASS, ${stale} STALE, ${info} INFO, ${warn} WARN — ` +
    (stale > 0 ? 'STALE premises found, fix the handoff before emitting/consuming it.' : 'OK')
  )
}

/**
 * Whole verification as a PURE function of (text, runner) — the seam the unit
 * tests drive: no stdin, no process.exit, no live `gh`.
 * @param {string} text
 * @param {Runner} runner
 * @returns {{rows: HandoffRow[], stale: number, warn: number, hints: string[], exitCode: 0|1, empty: boolean}}
 */
export function verifyHandoff(text, runner) {
  const refs = extractRefs(text)
  // The text-only detectors are pure scans — they run even on a ref-less
  // handoff (a «бэклог пуст» handoff with zero refs is exactly the dangerous
  // case).
  const completeness = verifyCompletenessClaims(extractCompletenessClaims(text))
  const directive = verifyOwnerDirectiveClaims(
    extractOwnerDirectiveClaims(text, refs),
    hasOwnerQuoteEvidence(text),
  )
  const textOnlyRows = [...completeness.rows, ...directive.rows]

  if (refs.length === 0 && textOnlyRows.length === 0) {
    return { rows: [], stale: 0, warn: 0, hints: [], exitCode: 0, empty: true }
  }

  let state = { rows: [], stale: 0 }
  let approval = { rows: [], stale: 0, hints: [] }
  if (refs.length > 0) {
    state = verifyRefs(refs, runner)
    approval = verifyApprovalClaims(extractApprovalClaims(text, refs), runner)
  }

  const rows = [...state.rows, ...approval.rows, ...textOnlyRows]
  // WARN rows never feed `stale`, so a WARN-only run still exits 0.
  const stale = state.stale + approval.stale
  const warn = completeness.warn + directive.warn
  const hints = [...approval.hints, ...completeness.hints, ...directive.hints]
  return { rows, stale, warn, hints, exitCode: stale > 0 ? 1 : 0, empty: false }
}

const USAGE = `Usage: pnpm handoff:verify <handoff-file>   (or pipe the handoff via stdin)\n`

function main() {
  const fileArg = process.argv[2]
  let text
  try {
    if (fileArg) {
      text = readFileSync(fileArg, 'utf8')
    } else if (!process.stdin.isTTY) {
      text = readFileSync(0, 'utf8') // fd 0 read works on Windows too
    } else {
      process.stderr.write(USAGE)
      process.exit(2)
    }
  } catch (e) {
    process.stderr.write(`${TAG} cannot read input: ${e.message}\n`)
    process.exit(2)
  }

  const runner = defaultRunner()
  if (extractRefs(text).length > 0) {
    // Ancestry checks need a fresh origin/main; tolerate offline (warn + local).
    const fetched = runner.git(['fetch', 'origin', 'main', '--quiet'])
    if (fetched.status !== 0)
      process.stderr.write(
        `${TAG} WARN: git fetch origin main failed — ancestry is checked against the LOCAL origin/main.\n`,
      )
  }

  const result = verifyHandoff(text, runner)
  if (result.empty) {
    process.stdout.write(`${TAG} no extractable refs (#N / PR N / sha / branch) found — nothing to verify.\n`)
    process.exit(0)
  }
  for (const row of result.rows) process.stdout.write(`${renderRow(row)}\n`)
  for (const hint of result.hints) process.stderr.write(`${hint}\n`)
  process.stdout.write(`${renderSummary(result)}\n`)
  process.exit(result.exitCode)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
