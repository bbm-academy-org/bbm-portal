#!/usr/bin/env node
// bbm-portal — `pnpm backlog:triage`: backlog readiness report (#130).
//
// Readiness comes from GitHub's NATIVE graph (`dependencies/blocked_by`), not a
// label: a status label would be a second source of truth and the first to drift
// (canon §2). Prose such as «depends on #N» in a body is read too, but only as a
// signal that an edge was not recorded, never as the edge itself.
//
// Report contents (canon §7):
//   • takeable / blocked work, with the reason for every edge;
//   • drift between the `Dependencies` mirror and the graph in a separate
//     section, because that is hygiene, NOT readiness;
//   • claim drift: a worktree and `In Progress` are the two required signals
//     (§4); resolution is asymmetric and only reported here, never released by
//     the script on someone else's behalf;
//   • field hygiene: Type / channel:* / **Source:** line / milestone / assignee;
//   • epic checklist drift: an open epic whose native sub-issues are all closed
//     while its body checklist is still unticked (#299) — it reads as live work
//     when the graph says it is done;
//   • edges without recorded rationale (provenance-orphan, grounds to challenge the edge);
//   • mega-blockers — nodes blocking ≥5 issues.
//
// Read-only: no mutations and no comments. Exit 0 except when the issue list
// itself is unavailable (exit 1); the report must not break a session.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CHANNEL_LABELS,
  ISSUE_TYPES,
  PROJECT_NUMBER,
  REPO,
  buildBoardItemsPageQuery,
  ghGraphqlResult,
  ghJson,
  ghResult,
} from './lib/gh.mjs'
import { WAIVER_FORM, productLayerStatus } from './lib/product-layer.mjs'
import { isPlaceholder } from './lib/text.mjs'

// Re-exported: `isPlaceholder` moved to `lib/text.mjs` when the epic
// product-layer gate (#321) needed the same definition of an unfilled field.
// One definition, two readers — a second copy would be the one that drifts.
export { isPlaceholder }

const TAG = '[backlog:triage]'

/**
 * Default GitHub labels that do not belong in this repo (canon §2; migration
 * 7.2 decides their fate). This command only reports them.
 */
export const LEGACY_LABELS = [
  'bug',
  'enhancement',
  'documentation',
  'duplicate',
  'invalid',
  'wontfix',
  'question',
  'good first issue',
  'help wanted',
]

/** Relations that are NEVER blockers (canon §3): hierarchy ≠ dependency. */
const NON_BLOCKER_PHRASES = [
  'sub-issue of',
  '\u043f\u043e\u0434\u0437\u0430\u0434\u0430\u0447\u0430',
  '\u0447\u0430\u0441\u0442\u044c',
  '\u0440\u043e\u0434\u0438\u0442\u0435\u043b\u044c',
  'parent',
  '\u044d\u043f\u0438\u043a',
  'epic',
  '\u0441\u0432\u044f\u0437\u0430\u043d\u043e',
  'related',
  '\u043f\u0440\u0435\u0435\u043c\u043d\u0438\u043a',
  'successor',
  '\u0441\u043d\u0430\u0447\u0430\u043b\u0430 \u043e\u0431\u0441\u0443\u0434\u0438\u0442\u044c',
]

// ── pure seams (unit-tested in tests/unit/gh-backlog-triage.spec.ts) ─────────

/**
 * Text from the issue body's `**Source:**` line, or null when it is missing or
 * empty. Accepts both the `pnpm issue:create` form (`**Source:** text`) and the
 * GitHub issue-form shape (`### Source` followed by a value on later lines).
 * @param {string} body
 * @returns {string|null}
 */
export function sourceLineText(body) {
  const text = String(body ?? '')
  // Indentation is ONLY space or tab: `\s` includes `\n`, so an empty
  // `**Source:**` line used to capture the next paragraph and make an unfilled
  // field read as populated.
  const inline = text.match(/^[ \t]*\*\*Source:\*\*[ \t]*(.*)$/im)
  if (inline) {
    const value = inline[1].trim()
    if (value !== '' && !isPlaceholder(value)) return value
  }
  // Without `m`, `$` must mean the end of ALL text (the last body section), not
  // the end of a line. The line start is therefore explicit as `(?:^|\n)`.
  const section = text.match(/(?:^|\n)#{2,4}[ \t]*Source[ \t]*\r?\n([\s\S]*?)(?=\n#{2,4}[ \t]|$)/i)
  if (section) {
    const value = section[1].trim()
    if (value !== '' && !isPlaceholder(value)) return value
  }
  return null
}

/**
 * Field hygiene for one issue. Classification uses the NATIVE Type field; the
 * only custom taxonomy is `channel:*` (how work enters the backlog). Issue
 * provenance is free text in the `**Source:**` line and is required too (owner
 * rulings from 2026-08-04).
 * @returns {string[]} violations; empty means clean
 */
export function missingFields(issue) {
  const missing = []
  const labels = (issue?.labels ?? [])
    .map((l) => (typeof l === 'string' ? l : l?.name))
    .filter(Boolean)

  const type = issue?.issueType?.name ?? issue?.issueType ?? null
  if (!type) missing.push('missing Type')
  else if (!ISSUE_TYPES.includes(type)) missing.push(`unknown Type «${type}»`)

  const channels = labels.filter((l) => l.startsWith('channel:'))
  if (channels.length === 0) missing.push('missing channel:*')
  else if (channels.length > 1) missing.push(`multiple channel:* labels (${channels.join(', ')})`)
  else if (!CHANNEL_LABELS.includes(channels[0])) {
    missing.push(`unknown channel «${channels[0]}»`)
  }

  // Provenance is free text, so only presence and non-emptiness are checked.
  // Meaning cannot and should not be validated here: substance belongs in task
  // review, not in a regular expression.
  if (!sourceLineText(issue?.body)) missing.push('missing non-empty **Source:** line')

  const kinds = labels.filter((l) => l.startsWith('kind:'))
  if (kinds.length > 0) missing.push(`retired kind:* labels (${kinds.join(', ')})`)

  const sources = labels.filter((l) => l.startsWith('source:'))
  if (sources.length > 0) missing.push(`retired source:* labels (${sources.join(', ')})`)

  const legacy = labels.filter((l) => LEGACY_LABELS.includes(l))
  if (legacy.length > 0)
    missing.push(`default GitHub labels (${legacy.join(', ')}) — migration 7.2`)

  if (!issue?.milestone?.title) missing.push('missing milestone')
  if ((issue?.assignees ?? []).length === 0) missing.push('missing assignee')

  return missing
}

/** Whether text mentions issue #N, including through a link. */
export function mentionsIssue(text, n) {
  if (!text || !Number.isInteger(n)) return false
  return new RegExp(`(?:#|/issues/|/pull/)${n}(?!\\d)`).test(String(text))
}

/**
 * Parse the body's `## Dependencies` section: lines such as
 * `**Blocked by:** #N — reason`. Accept heading levels `##`–`####`:
 * `pnpm issue:create` writes `##`, while GitHub issue forms render `###`.
 * @returns {{blockedBy: {number:number, rationale:string|null}[], blocks:number[]}}
 */
export function parseDependenciesSection(body) {
  const text = String(body ?? '')
  const blockedBy = []
  const blocks = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const blockedMatch = line.match(/^\s*(?:[-*]\s*)?\*\*Blocked by:?\*\*:?\s*(.*)$/i)
    if (blockedMatch) {
      for (const ref of parseRefsWithRationale(blockedMatch[1])) blockedBy.push(ref)
      continue
    }
    const blocksMatch = line.match(/^\s*(?:[-*]\s*)?\*\*Blocks:?\*\*:?\s*(.*)$/i)
    if (blocksMatch) {
      for (const ref of parseRefsWithRationale(blocksMatch[1])) blocks.push(ref.number)
    }
  }
  return { blockedBy, blocks }
}

/** `#12 — reason, #34` → [{number:12, rationale:'reason'},{number:34, rationale:null}] */
export function parseRefsWithRationale(clause) {
  const text = String(clause ?? '').trim()
  if (isPlaceholder(text)) return []
  const out = []
  const re = /#(\d+)\s*(?:[—–-]\s*([^#\n]*))?/g
  let m
  while ((m = re.exec(text)) !== null) {
    const rationale = (m[2] ?? '').trim().replace(/[,;]\s*$/, '')
    out.push({ number: Number(m[1]), rationale: rationale === '' ? null : rationale })
  }
  return out
}

/**
 * Prose dependency mentions OUTSIDE the Dependencies section signal that an
 * edge was not recorded; they are not edges. Hierarchical wording is ignored:
 * parent, epic, related and successor relations are not blockers (canon §3).
 */
export function parseProseBlockers(body) {
  const out = []
  for (const line of String(body ?? '').split(/\r?\n/)) {
    if (/^\s*(?:[-*]\s*)?\*\*Blocked by/i.test(line)) continue // Dependencies section
    if (
      !/(?:blocked by|\u0437\u0430\u0432\u0438\u0441\u0438\u0442 \u043e\u0442|\u0431\u043b\u043e\u043a\u0438\u0440\u0443\u0435\u0442\u0441\u044f|\u0436\u0434\u0451\u0442|\u0436\u0434\u0435\u0442)/i.test(
        line,
      )
    )
      continue
    const lower = line.toLowerCase()
    if (NON_BLOCKER_PHRASES.some((p) => lower.includes(p))) continue
    for (const ref of parseRefsWithRationale(line)) out.push(ref.number)
  }
  return [...new Set(out)]
}

/**
 * Whether an edge has recorded rationale. Canon §3 puts rationale in the
 * blocked issue's `Dependencies` line; text on either side is accepted.
 * @returns {'present'|'absent'|'unknown'}
 */
export function evaluateRationale(blockedNumber, blockerNumber, blockedText, blockerText) {
  if (blockedText == null && blockerText == null) return 'unknown'
  const deps = parseDependenciesSection(blockedText ?? '')
  const edge = deps.blockedBy.find((e) => e.number === blockerNumber)
  if (edge?.rationale) return 'present'
  if (blockedText && mentionsIssue(blockedText, blockerNumber)) {
    // A mention exists outside the edge line; count it only if the line carries
    // an explanation longer than the link itself.
    const line = String(blockedText)
      .split(/\r?\n/)
      .find((l) => mentionsIssue(l, blockerNumber) && l.replace(/[^\p{L}]/gu, '').length > 12)
    if (line) return 'present'
  }
  if (blockerText && mentionsIssue(blockerText, blockedNumber)) return 'present'
  return 'absent'
}

/**
 * Classify an issue as takeable or blocked.
 *
 * ONLY an open edge in the NATIVE graph blocks work. Prose and the
 * `Dependencies` mirror do not affect readiness at all — canon §3: prose is not
 * a relation and neither the board nor triage sees it. Otherwise an issue with
 * a correctly filled body but a missing graph edge would disappear from the
 * takeable set, and step 6 of `spec-issue-graph` («exactly one issue became
 * takeable») would return a false green in the exact scenario it guards.
 *
 * Filtering on `source` happens here, not only at the boundary, deliberately:
 * this is the last line of defence if a caller ever mixes the mirror back in.
 * @param {{number:number,title:string,labels:string[]}} issue
 * @param {{number:number, source:'native'|'prose', open:boolean, rationale:'present'|'absent'|'unknown'}[]} edges
 */
export function classify(issue, edges) {
  const seen = new Map()
  for (const e of edges ?? []) {
    if (e?.source !== 'native') continue
    if (!seen.has(e.number)) seen.set(e.number, e)
  }
  const unique = [...seen.values()]
  const blockers = unique.filter((e) => e.open)
  return {
    number: issue.number,
    title: issue.title,
    blocked: blockers.length > 0,
    edges: unique,
    blockers,
  }
}

/**
 * Drift between the human-readable mirror and the graph diagnoses hygiene, NOT
 * readiness. The three kinds have different remedies:
 *   • `mirror`     — a `Dependencies` line exists but no graph edge does → add the edge;
 *   • `prose`      — prose outside the section names the dependency → move it to the graph;
 *   • `graph-only` — the graph edge is missing from the body → add a line with rationale.
 * @param {string} body
 * @param {number[]} nativeNumbers blocker numbers from the native graph
 * @returns {{number:number, source:'mirror'|'prose'|'graph-only'}[]}
 */
export function findMirrorDrift(body, nativeNumbers) {
  const native = new Set(nativeNumbers ?? [])
  const mirror = new Set(parseDependenciesSection(body).blockedBy.map((e) => e.number))
  const prose = new Set(parseProseBlockers(body))
  const rows = []
  for (const n of mirror) if (!native.has(n)) rows.push({ number: n, source: 'mirror' })
  for (const n of prose) {
    if (!native.has(n) && !mirror.has(n)) rows.push({ number: n, source: 'prose' })
  }
  for (const n of native) if (!mirror.has(n)) rows.push({ number: n, source: 'graph-only' })
  return rows
}

/**
 * An epic whose native graph is FINISHED while its body checklist still shows
 * unticked boxes (#299, retro 2026-08-20). Epic #111 sat in the open list looking
 * like live work with every child closed — a direct contributor to the owner's
 * reading that «nothing ever gets closed».
 *
 * The graph is the fact and the checklist is its mirror, so the drift is a
 * hygiene WARN, never a closure: whether a finished epic closes is the lead's or
 * the owner's call. An epic with no sub-issues is not judged at all — its boxes
 * are a plan, not a mirror of anything.
 * @param {{number:number, body?:string, subIssues?:{number?:number, state?:string}[]}} epic
 * @returns {{number:number, closed:number, uncheckedCount:number, unchecked:number[]}|null}
 */
export function findEpicChecklistDrift({ number, body, subIssues }) {
  const children = subIssues ?? []
  if (children.length === 0) return null
  if (children.some((s) => String(s?.state ?? 'open').toLowerCase() === 'open')) return null
  const unchecked = []
  let uncheckedCount = 0
  for (const line of String(body ?? '').split(/\r?\n/)) {
    if (!/^\s*[-*]\s*\[\s\]/.test(line)) continue
    uncheckedCount += 1
    const ref = /#(\d+)/.exec(line)
    if (ref) unchecked.push(Number(ref[1]))
  }
  if (uncheckedCount === 0) return null
  return { number, closed: children.length, uncheckedCount, unchecked }
}

/**
 * An open epic whose body neither names a `docs/product/…` artifact nor records
 * an explicit waiver (#321, retro 2026-08-24). Epic #112 was decomposed straight
 * from a technical spec and re-framed by the owner only afterwards, seven
 * sub-issues later — nothing mechanical had asked what the epic was FOR.
 *
 * Here it is a FLAG, never a refusal and never an auto-edit: refusal lives at
 * filing time in `pnpm issue:create`, and the existing corpus predates the rule.
 * @param {{number:number, title?:string, body?:string}} epic
 * @returns {{number:number, title:string, kind:'missing'|'waiver-incomplete'}|null}
 */
export function findEpicProductLayerGap({ number, title, body }) {
  const status = productLayerStatus(body)
  if (status.ok) return null
  return { number, title: title ?? '', kind: status.kind }
}

/** Nodes blocking at least `threshold` open issues. */
export function findMegaBlockers(triaged, threshold = 5) {
  const fanout = new Map()
  for (const t of triaged ?? []) {
    for (const e of t.blockers ?? []) {
      if (!fanout.has(e.number)) fanout.set(e.number, [])
      fanout.get(e.number).push(t.number)
    }
  }
  return [...fanout.entries()]
    .filter(([, blocked]) => blocked.length >= threshold)
    .map(([number, blocked]) => ({ number, blocked, count: blocked.length }))
    .sort((a, b) => b.count - a.count)
}

/** Human-readable age. */
export function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/**
 * Compare the two claim signals (canon §4). Resolution is asymmetric: the
 * worktree is a filesystem fact, while the board grants the right to take the
 * issue. The script releases NOTHING; it only names the mismatch.
 * @returns {{kind:'in-flight'|'board-lags'|'branch-only'|'stale-claim'|'free', message:string}}
 */
export function detectClaimState({ number, hasWorktree, hasBranch, boardStatus, ageMs }) {
  const inProgress = boardStatus === 'In Progress'
  if (hasWorktree && inProgress) {
    return { kind: 'in-flight', message: 'worktree + In Progress — the claim is complete' }
  }
  if (hasWorktree && !inProgress) {
    return {
      kind: 'board-lags',
      message:
        `a worktree exists and status is «${boardStatus ?? 'not set'}» — work is active but the board lags; ` +
        `repair the board: pnpm board:status ${number} "In Progress"`,
    }
  }
  if (inProgress && !hasWorktree && hasBranch) {
    return {
      kind: 'branch-only',
      message:
        'status is In Progress with no worktree, but a branch exists on origin — work exists outside this machine; leave it alone',
    }
  }
  if (inProgress && !hasWorktree && !hasBranch) {
    return {
      kind: 'stale-claim',
      message:
        `status is In Progress with no worktree or branch (idle ${formatAge(ageMs)}) — the claim is stale; ` +
        `the lead/owner decides whether to release it, not the script`,
    }
  }
  return { kind: 'free', message: '' }
}

/** Build the Markdown report. Pure function: no external calls. */
export function formatReport(model) {
  const {
    generatedAt,
    takeable = [],
    inFlight = [],
    blocked = [],
    claimIssues = [],
    epics = [],
    hygiene = [],
    mirrorDrift = [],
    epicChecklistDrift = [],
    epicProductLayer = [],
    orphanEdges = [],
    megaBlockers = [],
    warnings = [],
  } = model

  const lines = []
  lines.push(`# backlog triage — ${REPO} — ${generatedAt}`)
  lines.push('')
  lines.push(
    `Open: ${takeable.length + inFlight.length + blocked.length + epics.length} ` +
      `(takeable ${takeable.length}, in flight ${inFlight.length}, blocked ${blocked.length}, epics ${epics.length}).`,
  )
  lines.push('')

  lines.push(`## Takeable (${takeable.length})`)
  if (takeable.length === 0) {
    lines.push('_none — an empty takeable list ≠ an empty backlog; see blocked work below_')
  }
  for (const t of takeable) lines.push(`- #${t.number} ${t.title}`)
  lines.push('')

  lines.push(`## In flight (${inFlight.length})`)
  if (inFlight.length === 0) lines.push('_none_')
  for (const t of inFlight) lines.push(`- #${t.number} ${t.title} — ${t.claim}`)
  lines.push('')

  lines.push(`## Claim drift (${claimIssues.length})`)
  if (claimIssues.length === 0) lines.push('_none — both signals agree_')
  for (const c of claimIssues) lines.push(`- #${c.number} — ${c.message}`)
  lines.push('')

  lines.push(`## Blocked (${blocked.length})`)
  if (blocked.length === 0) lines.push('_none_')
  for (const t of blocked) {
    lines.push(`- #${t.number} ${t.title}`)
    for (const e of t.blockers) {
      const rat =
        e.rationale === 'present'
          ? 'rationale recorded'
          : e.rationale === 'absent'
            ? '⚠ rationale not recorded'
            : 'rationale not checked'
      lines.push(
        `  ↳ #${e.number} (${e.source === 'native' ? 'native edge' : 'PROSE ONLY — no edge recorded'}) — ${rat}`,
      )
    }
  }
  lines.push('')

  lines.push(`## Dependencies mirror drift (${mirrorDrift.length})`)
  if (mirrorDrift.length === 0) lines.push('_none — body and graph agree_')
  for (const d of mirrorDrift) {
    if (d.source === 'mirror') {
      lines.push(
        `- #${d.number} ← #${d.blocker}: a Dependencies line exists but the graph edge DOES NOT — ` +
          `this does not affect readiness (canon §3); add the edge`,
      )
    } else if (d.source === 'prose') {
      lines.push(
        `- #${d.number} ← #${d.blocker}: prose outside Dependencies mentions the dependency — ` +
          `it is not a relation; move it to the graph or reword it`,
      )
    } else {
      lines.push(
        `- #${d.number} ← #${d.blocker}: the graph edge is not mirrored in the body — ` +
          `add a Dependencies line with rationale`,
      )
    }
  }
  lines.push('')

  lines.push(`## Epic checklist drift (${epicChecklistDrift.length})`)
  if (epicChecklistDrift.length === 0) lines.push('_none — epic bodies and the graph agree_')
  for (const e of epicChecklistDrift) {
    lines.push(
      `- #${e.number}: all ${e.closed} native sub-issues are closed, but ${e.uncheckedCount} ` +
        `checklist box(es) in the body are still unticked` +
        `${e.unchecked?.length ? ` (${e.unchecked.map((n) => `#${n}`).join(', ')})` : ''} — ` +
        `the epic reads as live work while the graph says it is done. Tick the boxes and decide ` +
        `whether the epic closes; the script decides neither`,
    )
  }
  lines.push('')

  lines.push(`## Epic product layer (${epicProductLayer.length})`)
  if (epicProductLayer.length === 0) {
    lines.push('_none — every open epic names its product layer or records a waiver_')
  }
  if (epicProductLayer.length > 0) {
    // The cure is printed ONCE for the section, not per row: six identical
    // paragraphs are how a report stops being read.
    lines.push(
      `Each of these can be decomposed into other people's work before anyone establishes what ` +
        `it is FOR (#321). Two cures per epic: run the \`do-product-discovery\` skill and LINK the ` +
        `resulting \`docs/product/<epic-slug>/brief.md\` from the body, or record «${WAIVER_FORM}» ` +
        `in it. A product-layer file that exists but is not named in the epic body does not clear ` +
        `this. Existing epics are FLAGGED here — never blocked, never auto-edited; filing-time ` +
        `refusal lives in \`pnpm issue:create --label epic\`.`,
    )
    lines.push('')
  }
  for (const e of epicProductLayer) {
    const what =
      e.kind === 'waiver-incomplete'
        ? 'carries a «product-layer: waived» line with NO tail — a waiver names who waived it and when'
        : 'names no docs/product/… artifact and records no waiver'
    lines.push(`- #${e.number} ${e.title} — ${what}`)
  }
  lines.push('')

  lines.push(`## Edges without rationale (${orphanEdges.length})`)
  if (orphanEdges.length === 0) lines.push('_none_')
  for (const e of orphanEdges) {
    lines.push(
      `- #${e.blocked} ← #${e.blocker} — provenance-orphan: grounds to challenge the edge, not accept it as fact`,
    )
  }
  lines.push('')

  lines.push(`## Mega-blockers (${megaBlockers.length})`)
  if (megaBlockers.length === 0) lines.push('_no nodes block ≥5 issues_')
  for (const m of megaBlockers) {
    lines.push(`- #${m.number} blocks ${m.count}: #${m.blocked.join(', #')}`)
  }
  lines.push('')

  lines.push(`## Epics (${epics.length})`)
  if (epics.length === 0) lines.push('_none_')
  for (const e of epics) lines.push(`- #${e.number} ${e.title} — an umbrella, not takeable itself`)
  lines.push('')

  lines.push(`## Field hygiene (${hygiene.length})`)
  if (hygiene.length === 0) lines.push('_clean_')
  for (const h of hygiene) lines.push(`- #${h.number} — ${h.missing.join('; ')}`)
  lines.push('')

  if (warnings.length > 0) {
    lines.push(`## Warnings (${warnings.length})`)
    for (const w of warnings) lines.push(`- ${w}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ── imperative part ─────────────────────────────────────────────────────────

function labelNames(issue) {
  return (issue?.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
}

/**
 * Root of the MAIN checkout: worktrees live under it, not under whichever tree
 * launched triage. `--git-common-dir` yields `<root>/.git` even from inside a
 * worktree (the same technique as `tools/dev/task-worktree.mjs`).
 */
function mainRepoRoot() {
  const res = spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' })
  if (res.status !== 0 || !res.stdout) return process.cwd()
  return dirname(resolve(res.stdout.trim()))
}

function listWorktreeNumbers(root) {
  const dir = join(root, '.claude', 'worktrees')
  if (!existsSync(dir)) return new Map()
  const out = new Map()
  for (const entry of readdirSync(dir)) {
    if (!/^\d+$/.test(entry)) continue
    let mtime = null
    try {
      mtime = statSync(join(dir, entry)).mtimeMs
    } catch {
      /* the directory may disappear between reads */
    }
    out.set(Number(entry), mtime)
  }
  return out
}

function listRemoteBranchNumbers() {
  const res = ghResult(['api', `repos/${REPO}/branches?per_page=100`, '--jq', '.[].name'])
  if (!res.ok) return new Set()
  const out = new Set()
  for (const name of res.stdout.split(/\r?\n/)) {
    const m = /^[a-z]+\/(\d+)-/.exec(name.trim())
    if (m) out.add(Number(m[1]))
  }
  return out
}

/** Board statuses: one paginated scan instead of one request per issue. */
function fetchBoardStatuses(warnings) {
  const statuses = new Map()
  let cursor = null
  for (let page = 0; page < 10; page++) {
    const res = ghGraphqlResult(buildBoardItemsPageQuery(cursor))
    if (!res.ok) {
      warnings.push(`could not read Project ${PROJECT_NUMBER}: ${res.error}`)
      return statuses
    }
    const items = res.data?.organization?.projectV2?.items
    for (const node of items?.nodes ?? []) {
      const number = node?.content?.number
      if (number != null) statuses.set(number, node?.fieldValueByName?.name ?? null)
    }
    if (!items?.pageInfo?.hasNextPage) break
    cursor = items.pageInfo.endCursor
  }
  return statuses
}

function fetchNativeBlockers(number, warnings) {
  const res = ghJson(['api', `repos/${REPO}/issues/${number}/dependencies/blocked_by`])
  if (!res.ok) {
    warnings.push(`#${number}: could not read native blocked_by — ${res.error}`)
    return []
  }
  return (Array.isArray(res.data) ? res.data : []).map((i) => ({
    number: i?.number,
    open: String(i?.state ?? 'open') === 'open',
  }))
}

/**
 * Native sub-issue graph of one epic. Unreadable → an empty list plus a warning:
 * the checklist-drift check then simply does not fire for that epic (#299).
 */
function fetchSubIssues(number, warnings) {
  const res = ghJson(['api', `repos/${REPO}/issues/${number}/sub_issues`])
  if (!res.ok) {
    warnings.push(`#${number}: could not read the sub-issue graph — ${res.error}`)
    return []
  }
  return (Array.isArray(res.data) ? res.data : []).map((i) => ({
    number: i?.number,
    state: String(i?.state ?? 'open'),
  }))
}

export const USAGE = `Usage: pnpm backlog:triage

  Backlog readiness report for ${REPO}. Read-only: no mutations, no comments,
  and no release of someone else's claim.

  Report sections:
    Takeable / In flight / Blocked — readiness from the NATIVE graph
      (\`dependencies/blocked_by\`). Prose and the body mirror do not affect it.
    Claim drift — compares canon §4's two signals (worktree AND board status).
    Dependencies mirror drift — hygiene diagnostics, not readiness.
    Epic checklist drift — an open epic whose native sub-issues are ALL closed
      while its body checklist is still unticked (#299): it reads as live work
      when the graph says it is done. WARN — closing it stays a human call.
    Epic product layer — an open epic that neither names a \`docs/product/…\`
      artifact nor records a waiver (#321): it can be decomposed into other
      people's work before anyone establishes what it is FOR. FLAG only —
      filing-time refusal lives in \`pnpm issue:create --label epic\`.
    Edges without rationale — provenance-orphan: grounds to challenge an edge.
    Mega-blockers — nodes blocking ≥5 issues.
    Epics — umbrellas, not takeable themselves.
    Field hygiene — Type / channel:* / **Source:** line / milestone / assignee.

  Exit codes: 0 — report printed (including partial failures, which appear under
  Warnings); 1 — could not retrieve the issue list.
`

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  if (argv.length > 0) {
    process.stderr.write(`${TAG} unknown argument «${argv[0]}»\n${USAGE}`)
    process.exit(1)
  }

  const warnings = []
  const issuesRes = ghJson([
    'issue',
    'list',
    '--repo',
    REPO,
    '--state',
    'open',
    '--limit',
    '300',
    '--json',
    'number,title,body,labels,milestone,assignees,issueType,updatedAt',
  ])
  if (!issuesRes.ok) {
    process.stderr.write(`${TAG} ${issuesRes.error}\n`)
    process.exit(1)
  }
  const issues = issuesRes.data ?? []
  const byNumber = new Map(issues.map((i) => [i.number, i]))

  const boardStatuses = fetchBoardStatuses(warnings)
  const root = resolve(mainRepoRoot())
  const worktrees = listWorktreeNumbers(root)
  const branchNumbers = listRemoteBranchNumbers()
  const now = Date.now()

  const triaged = []
  const hygiene = []
  const mirrorDrift = []
  const epicChecklistDrift = []
  const epicProductLayer = []
  const orphanEdges = []
  const claimIssues = []
  const epics = []
  const inFlight = []

  for (const issue of issues) {
    const labels = labelNames(issue)
    const missing = missingFields(issue)
    if (missing.length > 0) hygiene.push({ number: issue.number, missing })

    // Readiness comes ONLY from the native graph (canon §3). Neither the body
    // mirror nor prose is mixed in; both go to separate diagnostics.
    const native = fetchNativeBlockers(issue.number, warnings)
    const edges = []
    for (const n of native) {
      const rationale = evaluateRationale(
        issue.number,
        n.number,
        issue.body,
        byNumber.get(n.number)?.body ?? null,
      )
      edges.push({ number: n.number, source: 'native', open: n.open, rationale })
      if (rationale === 'absent') orphanEdges.push({ blocked: issue.number, blocker: n.number })
    }
    for (const d of findMirrorDrift(
      issue.body,
      native.map((e) => e.number),
    )) {
      mirrorDrift.push({ number: issue.number, blocker: d.number, source: d.source })
    }

    const t = classify({ number: issue.number, title: issue.title, labels }, edges)

    // Compute age explicitly: `now - Date.parse(x) || 0` collapsed NaN to 0 and
    // made a stale claim with no date report as «idle <1m».
    const updatedAt = Date.parse(issue.updatedAt ?? '')
    const claim = detectClaimState({
      number: issue.number,
      hasWorktree: worktrees.has(issue.number),
      hasBranch: branchNumbers.has(issue.number),
      boardStatus: boardStatuses.get(issue.number) ?? null,
      ageMs: Number.isFinite(updatedAt) ? now - updatedAt : null,
    })
    if (claim.kind === 'in-flight') {
      inFlight.push({ number: issue.number, title: issue.title, claim: claim.message })
      continue
    }
    if (claim.kind !== 'free') claimIssues.push({ number: issue.number, message: claim.message })

    if (labels.includes('epic')) {
      epics.push({ number: issue.number, title: issue.title })
      const drift = findEpicChecklistDrift({
        number: issue.number,
        body: issue.body,
        subIssues: fetchSubIssues(issue.number, warnings),
      })
      if (drift) epicChecklistDrift.push(drift)
      const gap = findEpicProductLayerGap({
        number: issue.number,
        title: issue.title,
        body: issue.body,
      })
      if (gap) epicProductLayer.push(gap)
      continue
    }
    triaged.push(t)
  }

  const report = formatReport({
    generatedAt: new Date().toISOString(),
    takeable: triaged.filter((t) => !t.blocked),
    inFlight,
    blocked: triaged.filter((t) => t.blocked),
    claimIssues,
    epics,
    hygiene,
    mirrorDrift,
    epicChecklistDrift,
    epicProductLayer,
    orphanEdges,
    megaBlockers: findMegaBlockers(triaged),
    warnings,
  })
  process.stdout.write(`${report}\n`)
  process.exit(0)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
