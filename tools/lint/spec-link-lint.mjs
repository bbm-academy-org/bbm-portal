#!/usr/bin/env node
// bbm-portal — spec-link guard (#135, epic #117 §11 "SDD").
//
// Symptom → root cause: a feature lands on prod that the owner never signed
// off, because the spec gate of task-cycle stage 1a lives only in prose. The
// owner is a non-developer: the spec IS his control interface. A feature PR
// with no spec behind it means he approved a diff he cannot read, or nothing
// at all.
//
// The rule (deliberately narrow — it fires only where stage 1a actually
// applies):
//   A PR is IN SCOPE when it changes production module code (`src/**`) AND
//   either its title is a `feat:` Conventional Commit or a linked issue has
//   issue type `Feature`. Chore/fix/docs/tooling PRs are out of scope, and so
//   is a `feat:` PR that ships no `src/**` change (tooling, skills, docs).
//   An in-scope PR must resolve to a spec file — named in the PR body, named
//   in a linked issue body, present in the PR's own diff, or already living at
//   `docs/specs/<linked-issue>-*.md` — and that spec must exist, carry a
//   `status:` from the ladder (docs/specs/README.md), and not still be `Draft`
//   (a Draft spec is one the owner has not said "go" to).
//   Escape hatch: a `spec-exempt: <reason>` line in the PR body. The reason is
//   mandatory — a reasonless exemption is not an exemption.
//
// SEVERITY: WARN, registered in docs/ci-guardrails.md §5. Mind the canon's two
//   WARNs: run locally the guard reports and exits 0, while in the canon WARN
//   means `continue-on-error` on the CI job. The `spec-link` job in
//   `pr-body-guards.yml` uses both deliberately — it passes `--severity block`
//   so the script gives a REAL signal (canon §4 promotion clause 1: a guard that
//   prints and always exits 0 is a stub and is not promotable) while
//   `continue-on-error: true` keeps the CI plane at WARN. Promotion to BLOCK
//   follows the canon's §4 clauses (earliest 2026-09-02) and is the three-edit
//   change described there — nothing in this file needs editing for it.
//
// Run: `pnpm lint:spec-link` (PR_NUMBER from Actions, or `--pr <n>` locally).
// Outside a PR context it exits 0 with a skip note.
//
// Seams for tests: `LINT_FIXTURE_ROOT` (spec tree) and `LINT_GH_FIXTURE_DIR`
// (canned `gh <kind> view <n> --json` payloads as `<kind>-view-<n>.json`), both
// via the shared `lib/` modules the contract (§8) forbids re-implementing.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { ghViewJson } from './lib/gh.mjs'
import { isEntryPoint, reporter, repoRoot, resolvePrNumber as envPrNumber } from './lib/guard.mjs'

/** The spec status ladder — canon: `docs/specs/README.md` § Status model. */
export const SPEC_STATUSES = ['Draft', 'In dev', 'Shipped', 'Superseded', 'Retired']

/** GitHub auto-close keywords: https://docs.github.com/en/issues */
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi

/**
 * A spec path, in either spec directory. `README.md` is the format doc, not a
 * spec. Two copies on purpose: the `/g` one is for `matchAll` scanning, the
 * anchored one for single-path tests — calling `.test()` on a `/g` regex
 * advances its `lastIndex` and makes the NEXT call lie.
 */
const SPEC_PATH_RE = /docs[\\/](?:superpowers[\\/])?specs[\\/][A-Za-z0-9][A-Za-z0-9._-]*\.md/g
const IS_SPEC_PATH_RE = /^docs\/(?:superpowers\/)?specs\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/

/** Conventional Commit `feat` prefix, with or without a scope / `!`. */
const FEAT_TITLE_RE = /^feat(\([^)]*\))?!?:/i

/**
 * The escape hatch, anchored to a REAL line start: no blockquote `>`, no list
 * marker, no indent (an indented line is a markdown code block), and fenced
 * blocks are stripped before matching. A body that merely QUOTES the hatch —
 * a pasted review comment, a PR documenting the guard — must not turn the gate
 * off. The docs write the marker in backticks, so the backticked form is
 * accepted too; doc and tool agree on both spellings.
 * Captured group is the reason (empty for a bare marker, which is rejected).
 */
const EXEMPT_RE = /^`?spec-exempt:[ \t]*([^\n`]*?)[ \t]*`?[ \t]*$/im

/**
 * The declared position of a spec reference in a PR body: a line that STARTS
 * with `Spec:` / `Spec reference:` (bold markers tolerated). A path mentioned
 * anywhere else is background reading, not a declaration.
 */
const SPEC_LINE_RE = /^\**spec(?:\s+reference)?:?\**\s*:?[ \t]*(.+)$/gim

/** The task-canon `## Spec reference` section heading of an issue body. */
const SPEC_SECTION_RE = /^#{1,6}[ \t]*spec\s+reference\b.*$/im

/** A markdown heading, which ends the section above. */
const NEXT_HEADING_RE = /\n#{1,6}[ \t]/

/** Production module code — the surface stage 1a is about. */
const PROD_CODE_RE = /^src[\\/]/

/** Changed lines below which a spec edit is a graze, not work on that spec. */
export const MIN_SPEC_EDIT_LINES = 3

// ── pure helpers (the unit-tested seam) ──────────────────────────────────────

/** Frontmatter key/value pairs of a markdown file; `{}` when there is none. */
export function parseFrontmatter(text) {
  const src = String(text ?? '')
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/)
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/** The declared ladder status of a spec file, or null when it declares none. */
export function specStatus(text) {
  const status = parseFrontmatter(text).status
  return status ? status : null
}

/** Issue numbers the body auto-closes, in first-seen order, deduplicated. */
export function extractClosedIssues(body) {
  const out = []
  for (const m of String(body ?? '').matchAll(CLOSE_RE)) {
    const n = Number(m[1])
    if (!out.includes(n)) out.push(n)
  }
  return out
}

/** Drop fenced code blocks — anything shown as a code sample is not a declaration. */
export function stripCodeFences(text) {
  return String(text ?? '').replace(/^```[\s\S]*?^```[ \t]*$/gm, '')
}

/**
 * The `spec-exempt:` reason: the string when present, `''` for a bare marker
 * (which the evaluator rejects), `null` when the marker is absent or merely
 * quoted (blockquote, list item, indented line, fenced block).
 */
export function specExemptReason(body) {
  const m = stripCodeFences(body).match(EXEMPT_RE)
  if (!m) return null
  return m[1].trim()
}

/** Spec paths declared on a `Spec:` / `Spec reference:` line of a PR body. */
export function specRefsFromPrBody(body) {
  const out = []
  const src = stripCodeFences(body)
  for (const m of src.matchAll(SPEC_LINE_RE)) {
    for (const p of extractSpecPaths(m[1])) if (!out.includes(p)) out.push(p)
  }
  return out
}

/** Spec paths inside an issue's `## Spec reference` section (task-canon §1). */
export function specRefsFromIssueBody(body) {
  const src = stripCodeFences(body)
  const h = src.match(SPEC_SECTION_RE)
  if (h?.index === undefined) return []
  const rest = src.slice(h.index + h[0].length)
  const next = rest.search(NEXT_HEADING_RE)
  return extractSpecPaths(next === -1 ? rest : rest.slice(0, next))
}

/** A `gh pr view --json files` entry, or a bare path string → the path. */
export function filePath(f) {
  return String(f?.path ?? f).replace(/\\/g, '/')
}

/**
 * A spec edit big enough to mean "this PR works on that spec". Without a floor,
 * a whitespace touch — a `prettier --write` sweep over `docs/` — satisfies the
 * gate for free. `gh` gives per-file additions/deletions; an entry with no
 * counts (a bare path) is NOT taken as substantial, because we cannot tell.
 */
export function substantiallyEdited(specPath, files) {
  const rel = String(specPath).replace(/\\/g, '/')
  const entry = (files ?? []).find((f) => filePath(f) === rel)
  if (!entry || typeof entry === 'string') return false
  return Number(entry.additions ?? 0) + Number(entry.deletions ?? 0) >= MIN_SPEC_EDIT_LINES
}

/**
 * Is this spec actually about the work being reviewed? Three routes, any one
 * suffices: the `NNN-` filename prefix matches a linked issue; the spec's own
 * `issue:` frontmatter matches one; or the PR substantially edits the spec file
 * (the shared-spec case — one spec covering work tracked under a later issue).
 *
 * `editedSpecPaths` is already filtered by `substantiallyEdited` at the call
 * site — this function does not re-decide what "edited" means.
 *
 * NOTE: declaration is handled by the CALLER, not here. A spec named in the
 * linked issue's `## Spec reference` is related BY DECLARATION whatever this
 * function says — see `evaluateSpecLink`.
 */
export function isRelatedSpec(specPath, frontmatter, linkedIssues, editedSpecPaths) {
  const rel = String(specPath).replace(/\\/g, '/')
  const issues = (linkedIssues ?? []).map(Number)
  const prefix = rel.match(/\/(\d{2,4})-/)
  if (prefix && issues.includes(Number(prefix[1]))) return true
  const declared = Number(frontmatter?.issue)
  if (declared && issues.includes(declared)) return true
  return (editedSpecPaths ?? []).some((f) => String(f).replace(/\\/g, '/') === rel)
}

/** Spec paths mentioned in a text, normalized to forward slashes, deduplicated. */
export function extractSpecPaths(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(SPEC_PATH_RE)) {
    const p = m[0].replace(/\\/g, '/')
    if (/\/README\.md$/i.test(p)) continue
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/**
 * Does the task-cycle spec gate apply to this PR? Returns the verdict with the
 * reason, so a skip is legible in the log instead of silent.
 */
export function specRequired({ title, files, issues }) {
  const changed = (files ?? []).map(filePath)
  const featureIssue = (issues ?? []).find((i) => String(i.type ?? '') === 'Feature')
  const featTitle = FEAT_TITLE_RE.test(String(title ?? ''))
  if (!featureIssue && !featTitle) {
    return { required: false, reason: 'no `feat:` title and no linked issue of type Feature' }
  }
  if (!changed.some((f) => PROD_CODE_RE.test(f))) {
    return {
      required: false,
      reason:
        'no production module code changed (nothing under `src/`) — no user-facing behavior to spec',
    }
  }
  return {
    required: true,
    reason: featureIssue
      ? `linked issue #${featureIssue.number} is a Feature and the PR changes src/`
      : '`feat:` PR changing src/',
  }
}

/**
 * The guard's decision.
 *
 * Input shape: `pr` is `{ number, title, body, files: string[] }`; `issues` is
 * the list of auto-closed issues as `{ number, type, body }`; `tree` is the
 * filesystem seam `{ exists(path), read(path), listSpecs() }`.
 * Returns `{ verdict: 'ok' | 'skip' | 'findings', notes, findings }`.
 */
export function evaluateSpecLink({ pr, issues, tree }) {
  const notes = []
  const findings = []
  const body = String(pr?.body ?? '')

  const exempt = specExemptReason(body)
  if (exempt !== null) {
    if (exempt === '') {
      findings.push(
        '`spec-exempt:` carries no reason. An exemption without a stated reason is not an exemption — write why this PR needs no spec.',
      )
      return { verdict: 'findings', notes, findings }
    }
    notes.push(`exempt by PR body: ${exempt}`)
    return { verdict: 'skip', notes, findings }
  }

  const linked = extractClosedIssues(body)
  if (linked.length === 0) {
    notes.push('PR body has no `Closes #N` link — nothing to resolve a spec against, skipping')
    return { verdict: 'skip', notes, findings }
  }

  const gate = specRequired({ title: pr?.title, files: pr?.files, issues })
  if (!gate.required) {
    notes.push(`spec gate does not apply: ${gate.reason}`)
    return { verdict: 'skip', notes, findings }
  }
  notes.push(`spec gate applies: ${gate.reason}`)

  // Candidate specs — ONLY from declared positions. A path mentioned loosely in
  // the prose is background reading; treating it as a declaration is how a PR
  // that cites a spec as context passed the gate without having one.
  //
  // Each candidate carries the SOURCES it came from, because the source decides
  // relatedness: a spec the linked issue itself names in `## Spec reference` is
  // related BY DECLARATION — the issue saying "this spec governs me" IS the
  // relation, and it is the dominant shape here (an epic sub-task declaring the
  // parent epic's design spec, whose filename and `issue:` both point at the
  // epic, not at the sub-task).
  const files = pr?.files ?? []
  const editedSpecs = files
    .map(filePath)
    .filter(
      (p) => IS_SPEC_PATH_RE.test(p) && !/\/README\.md$/i.test(p) && substantiallyEdited(p, files),
    )
  const candidates = new Map()
  const add = (paths, source) => {
    for (const p of paths) {
      if (!candidates.has(p)) candidates.set(p, new Set())
      candidates.get(p).add(source)
    }
  }
  add(specRefsFromPrBody(body), 'pr-spec-line')
  for (const issue of issues ?? []) add(specRefsFromIssueBody(issue.body), 'issue-declaration')
  add(editedSpecs, 'pr-edit')
  // Implicit: the issue-numbered spec already on main.
  const known = tree.listSpecs ? tree.listSpecs() : []
  for (const n of linked) {
    const padded = String(n).padStart(3, '0')
    add(
      known.filter((p) => new RegExp(`^docs/specs/${padded}-`).test(p.replace(/\\/g, '/'))),
      'issue-numbered',
    )
  }

  /** Sources that establish relatedness on their own, without any name matching. */
  const DECLARING = new Set(['issue-declaration', 'pr-edit', 'issue-numbered'])

  if (candidates.size === 0) {
    findings.push(
      `PR #${pr?.number} implements a feature but names no spec. ` +
        'Declare it on a `Spec: docs/specs/NNN-<slug>.md` line in the PR body, or in the ' +
        "linked issue's `## Spec reference` section; author one per `docs/specs/README.md`; " +
        'or state `spec-exempt: <reason>` on its own line.',
    )
    return { verdict: 'findings', notes, findings }
  }

  // PASS 1 — relatedness, BEFORE any status check. A Draft/statusless spec that
  // belongs to someone else's work must not produce a finding about this PR.
  const mine = []
  for (const [rel, sources] of candidates) {
    const declared = [...sources].some((s) => DECLARING.has(s))
    const fm = tree.exists(rel) ? parseFrontmatter(tree.read(rel)) : {}
    if (declared || isRelatedSpec(rel, fm, linked, editedSpecs)) {
      mine.push(rel)
      continue
    }
    notes.push(
      `spec \`${rel}\` does not reference ${linked.map((n) => `#${n}`).join(' / ')} ` +
        "and neither the PR nor the issue declares it as governing — read as background, not as this PR's spec.",
    )
  }

  // PASS 2 — validate only the specs that ARE this PR's.
  for (const rel of mine) {
    if (!tree.exists(rel)) {
      findings.push(`spec \`${rel}\` is referenced but does not exist in the tree.`)
      continue
    }
    const status = specStatus(tree.read(rel))
    if (status === null) {
      findings.push(
        `spec \`${rel}\` has no \`status:\` frontmatter (docs/specs/README.md § Status model).`,
      )
      continue
    }
    if (!SPEC_STATUSES.includes(status)) {
      findings.push(
        `spec \`${rel}\`: \`status: ${status}\` is not a ladder status (${SPEC_STATUSES.join(' | ')}).`,
      )
      continue
    }
    if (status === 'Draft') {
      findings.push(
        `spec \`${rel}\` is still \`Draft\` while its implementation is in review — a Draft spec is one the owner has not said "go" to (task-cycle stage 2). Move it to \`In dev\`.`,
      )
      continue
    }
    notes.push(`spec \`${rel}\` → status \`${status}\` OK`)
  }
  const related = mine.length

  // A declared spec that belongs to different work does not satisfy the gate.
  if (related === 0 && findings.length === 0) {
    findings.push(
      `PR #${pr?.number} names ${candidates.size} spec(s), but none of them references ` +
        `${linked.map((n) => `#${n}`).join(' / ')}. Relate the spec to the issue — by its ` +
        '`NNN-` prefix, its `issue:` frontmatter, or by editing that spec in this PR.',
    )
  }

  return { verdict: findings.length > 0 ? 'findings' : 'ok', notes, findings }
}

/** WARN today; `LINT_SEVERITY=block` promotes it (canon §4, see the header). */
export function severityFromEnv(env = {}) {
  return String(env.LINT_SEVERITY ?? '').toLowerCase() === 'block' ? 'block' : 'warn'
}

/**
 * The same severity dial as the sibling guard `stage-b-lint.mjs` (#151): both
 * `--severity block` and `--severity=block`, else the env, else WARN. Two
 * guards in one directory disagreeing about their own flag is how a CI job
 * silently runs at the wrong severity.
 */
export function severityFromArgv(argv = [], env = {}) {
  const args = argv.map(String)
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--severity='))
      return args[i].slice('--severity='.length) === 'block' ? 'block' : 'warn'
    if (args[i] === '--severity') return String(args[i + 1] ?? '') === 'block' ? 'block' : 'warn'
  }
  return severityFromEnv(env)
}

/** Findings fail the run only under `block`. */
export function exitCodeFor(result, severity) {
  return result?.verdict === 'findings' && severity === 'block' ? 1 : 0
}

// ── runtime plumbing ─────────────────────────────────────────────────────────

/** Filesystem seam over the real repo (or the `LINT_FIXTURE_ROOT` tree). */
export function repoTree(root = repoRoot()) {
  const list = (rel) => {
    const dir = resolve(root, rel)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((n) => n.endsWith('.md') && n.toLowerCase() !== 'readme.md')
      .map((n) => `${rel}/${n}`)
  }
  return {
    exists: (p) => existsSync(resolve(root, p)),
    read: (p) => readFileSync(resolve(root, p), 'utf8'),
    listSpecs: () => [...list('docs/specs'), ...list('docs/superpowers/specs')],
  }
}

/**
 * The PR under test: `--pr <n>` for a local run, otherwise the shared env
 * resolution (`PR_NUMBER` / `GITHUB_PR_NUMBER` / the Actions ref). `''` when
 * there is no PR context, which the contract (§8) makes a skip, not a finding.
 */
export function resolvePrNumber(argv = process.argv.slice(2), env = process.env) {
  const flag = argv.indexOf('--pr')
  if (flag !== -1 && argv[flag + 1]) return String(argv[flag + 1])
  return envPrNumber(env)
}

function main() {
  const report = reporter('spec-link')
  const severity = severityFromArgv(process.argv.slice(2), process.env)
  const prNumber = resolvePrNumber()
  if (!prNumber) {
    // Nothing to check is a clean exit 0 — but it says so, because a silent
    // exit 0 cannot be told apart from a stub (canon §8).
    report.ok('no PR context (PR_NUMBER / --pr unset) — nothing to check')
  }

  // A guard ERROR is not a finding and does NOT follow the severity dial: it
  // exits non-zero under every severity. A check that never ran must not look
  // clean (canon §8, fail-closed).
  const prRes = ghViewJson('pr', prNumber, 'number,title,body,files', repoRoot())
  if (!prRes.ok) report.fail(`ERROR could not read PR #${prNumber}: ${prRes.error}`)
  const pr = {
    number: prRes.data.number,
    title: prRes.data.title,
    body: prRes.data.body ?? '',
    // Keep the whole entry: `additions`/`deletions` decide whether a touched
    // spec was actually worked on or merely grazed (`substantiallyEdited`).
    files: prRes.data.files ?? [],
  }

  const issues = []
  for (const n of extractClosedIssues(pr.body)) {
    const r = ghViewJson('issue', n, 'number,title,body,issueType', repoRoot())
    if (!r.ok) report.fail(`ERROR could not read linked issue #${n}: ${r.error}`)
    issues.push({ number: n, type: r.data.issueType?.name ?? '', body: r.data.body ?? '' })
  }

  const result = evaluateSpecLink({ pr, issues, tree: repoTree() })
  for (const note of result.notes) report.info(note)
  for (const f of result.findings) {
    report.finding(`${severity === 'block' ? 'BLOCK' : 'WARN'} ${f}`)
  }
  if (result.verdict === 'ok') report.info('PASS — the feature PR resolves to a spec.')
  if (result.verdict === 'findings' && severity === 'warn') {
    report.finding('WARN severity (docs/ci-guardrails.md §5 — earliest promotion 2026-09-02)')
  }
  process.exit(exitCodeFor(result, severity))
}

// Only run when invoked directly, never on import from a spec.
if (isEntryPoint(import.meta.url)) main()
