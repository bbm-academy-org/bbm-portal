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
// SEVERITY: WARN. Findings are printed and the process exits 0.
//   TODO(#136): promote per severity canon — task 7.5 owns the severity canon,
//   the `ci` meta-job and the guard workflow. Promotion is a one-knob change:
//   run this script with `LINT_SEVERITY=block` (or `--severity=block`) and it
//   exits 1 on findings. Nothing else in this file needs editing.
//
// Run: `pnpm lint:spec-link` (PR_NUMBER from Actions, or `--pr <n>` locally).
// Outside a PR context it exits 0 with a skip note.
//
// Seams for tests: `LINT_FIXTURE_ROOT` (spec tree) and `LINT_GH_FIXTURE_DIR`
// (canned `gh <kind> view <n> --json` payloads as `<kind>-view-<n>.json`).
// Both inert in production.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TAG = '[spec-link]'

/** The spec status ladder — canon: `docs/specs/README.md` § Status model. */
export const SPEC_STATUSES = ['Draft', 'In dev', 'Shipped', 'Superseded', 'Retired']

/** GitHub auto-close keywords: https://docs.github.com/en/issues */
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi

/** A spec path, in either spec directory. `README.md` is the format doc, not a spec. */
const SPEC_PATH_RE = /docs[\\/](?:superpowers[\\/])?specs[\\/][A-Za-z0-9][A-Za-z0-9._-]*\.md/g

/** Conventional Commit `feat` prefix, with or without a scope / `!`. */
const FEAT_TITLE_RE = /^feat(\([^)]*\))?!?:/i

/** The escape hatch. Captured group is the reason (possibly empty). */
const EXEMPT_RE = /^[ \t>*-]*spec-exempt:[ \t]*(.*)$/im

/** Production module code — the surface stage 1a is about. */
const PROD_CODE_RE = /^src[\\/]/

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

/**
 * The `spec-exempt:` reason: the string when present, `''` for a bare marker
 * (which the evaluator rejects), `null` when the marker is absent.
 */
export function specExemptReason(body) {
  const m = String(body ?? '').match(EXEMPT_RE)
  if (!m) return null
  return m[1].trim()
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
  const changed = (files ?? []).map((f) => String(f).replace(/\\/g, '/'))
  const featureIssue = (issues ?? []).find((i) => String(i.type ?? '') === 'Feature')
  const featTitle = FEAT_TITLE_RE.test(String(title ?? ''))
  if (!featureIssue && !featTitle) {
    return { required: false, reason: 'no `feat:` title and no linked issue of type Feature' }
  }
  if (!changed.some((f) => PROD_CODE_RE.test(f.replace(/\//g, '/')) || f.startsWith('src/'))) {
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

  // Candidate specs, most explicit source first.
  const candidates = []
  const add = (paths) => {
    for (const p of paths) if (!candidates.includes(p)) candidates.push(p)
  }
  add(extractSpecPaths(body))
  for (const issue of issues ?? []) add(extractSpecPaths(issue.body))
  add(extractSpecPaths((pr?.files ?? []).join('\n')))
  // Implicit: the issue-numbered spec already on main.
  const known = tree.listSpecs ? tree.listSpecs() : []
  for (const n of linked) {
    const padded = String(n).padStart(3, '0')
    add(known.filter((p) => new RegExp(`^docs/specs/${padded}-`).test(p.replace(/\\/g, '/'))))
  }

  if (candidates.length === 0) {
    findings.push(
      `PR #${pr?.number} implements a feature but names no spec. ` +
        "Add the spec path to the PR body (or to the linked issue's `## Spec reference`), " +
        'author one per `docs/specs/README.md`, or state `spec-exempt: <reason>`.',
    )
    return { verdict: 'findings', notes, findings }
  }

  for (const rel of candidates) {
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

  return { verdict: findings.length > 0 ? 'findings' : 'ok', notes, findings }
}

/** WARN today; `LINT_SEVERITY=block` promotes it (see the header TODO(#136)). */
export function severityFromEnv(env = {}) {
  return String(env.LINT_SEVERITY ?? '').toLowerCase() === 'block' ? 'block' : 'warn'
}

/** Findings fail the run only under `block`. */
export function exitCodeFor(result, severity) {
  return result?.verdict === 'findings' && severity === 'block' ? 1 : 0
}

// ── runtime plumbing ─────────────────────────────────────────────────────────

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Filesystem seam over the real repo (or a fixture root). */
export function repoTree(root = REPO_ROOT) {
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

/** `gh <kind> view <n> --json <fields>`, or a canned fixture under the test seam. */
export function ghViewJson(kind, number, fields) {
  const fixtureDir = process.env.LINT_GH_FIXTURE_DIR
  if (fixtureDir) {
    try {
      return {
        ok: true,
        data: JSON.parse(readFileSync(resolve(fixtureDir, `${kind}-view-${number}.json`), 'utf8')),
      }
    } catch (e) {
      return {
        ok: false,
        error: `fixture ${kind}-view-${number}.json unavailable: ${String(e.message).split('\n')[0]}`,
      }
    }
  }
  // argv array, never a shell string — no command-injection class here.
  const res = spawnSync('gh', [kind, 'view', String(number), '--json', fields], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === 'win32',
  })
  if (res.status !== 0)
    return { ok: false, error: String(res.stderr || res.error || '').split('\n')[0] }
  try {
    return { ok: true, data: JSON.parse(res.stdout) }
  } catch (e) {
    return { ok: false, error: String(e.message).split('\n')[0] }
  }
}

/** PR number from Actions context, `--pr <n>`, or `gh` on the current branch. */
export function resolvePrNumber(argv = process.argv.slice(2), env = process.env) {
  const flag = argv.indexOf('--pr')
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1]
  if (env.PR_NUMBER) return env.PR_NUMBER
  if (env.GITHUB_PR_NUMBER) return env.GITHUB_PR_NUMBER
  const m = String(env.GITHUB_REF ?? '').match(/refs\/pull\/(\d+)\//)
  return m ? m[1] : ''
}

function main() {
  const severity = process.argv.includes('--severity=block')
    ? 'block'
    : severityFromEnv(process.env)
  const prNumber = resolvePrNumber()
  if (!prNumber) {
    process.stdout.write(`${TAG} no PR context (PR_NUMBER / --pr unset) — skipping\n`)
    process.exit(0)
  }

  const prRes = ghViewJson('pr', prNumber, 'number,title,body,files')
  if (!prRes.ok) {
    process.stdout.write(`${TAG} could not read PR #${prNumber} (${prRes.error}) — skipping\n`)
    process.exit(0)
  }
  const pr = {
    number: prRes.data.number,
    title: prRes.data.title,
    body: prRes.data.body ?? '',
    files: (prRes.data.files ?? []).map((f) => f.path ?? f),
  }

  const issues = []
  for (const n of extractClosedIssues(pr.body)) {
    const r = ghViewJson('issue', n, 'number,title,body,issueType')
    if (!r.ok) {
      process.stdout.write(`${TAG} could not read issue #${n} (${r.error})\n`)
      continue
    }
    issues.push({ number: n, type: r.data.issueType?.name ?? '', body: r.data.body ?? '' })
  }

  const result = evaluateSpecLink({ pr, issues, tree: repoTree() })
  for (const note of result.notes) process.stdout.write(`${TAG} ${note}\n`)
  for (const f of result.findings) {
    process.stderr.write(`${TAG} ${severity === 'block' ? 'BLOCK' : 'WARN'} ${f}\n`)
  }
  if (result.verdict === 'ok')
    process.stdout.write(`${TAG} PASS — the feature PR resolves to a spec.\n`)
  if (result.verdict === 'findings' && severity === 'warn') {
    process.stderr.write(`${TAG} WARN-only today; promotion to BLOCK is tracked in #136.\n`)
  }
  process.exit(exitCodeFor(result, severity))
}

// Only run when invoked directly, never on import from a test.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
