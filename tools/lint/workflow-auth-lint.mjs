#!/usr/bin/env node
// workflow-auth — a workflow job that reaches GitHub must carry the auth block.
//
// Canon: docs/ci-guardrails.md §5, which is the severity of record. WARN from
// 2026-08-05, promoted to BLOCK on 2026-09-02 (#438) under the §4 clauses. The job carries no
// `continue-on-error` and is in the `ci` meta-job needs-list — which is what §2.1
// says BLOCK IS on that plane.
//
// Why it exists: a job that reads PR metadata through the `gh` CLI needs an
// explicit permission grant plus token wiring, because the default `GITHUB_TOKEN`
// scope under restrictive workflow permissions lacks `pull-requests: read` — so
// `gh pr view` exits non-zero and the guard fails BEFORE it ever evaluates its
// rule. That failure is indistinguishable from a real finding at a glance, and
// it silently poisons the guard's promotion clock (canon §4: a vacuous red is
// not a clean window). In ds-platform one PR shipped three PR-gated guard jobs
// without the block and all three went red on every PR. This meta-guard makes
// that class deterministic and local.
//
// The rule (exact). Parse every `.github/workflows/*.yml`. A job is GH-GATED
// when any of its `run:` steps reaches GitHub — a bare `gh …` invocation, or a
// `tools/lint/*-lint.mjs` guard that imports `./lib/gh.mjs`, invoked by path or
// through its `pnpm lint:<name>` alias. For every gh-gated job:
//   (a) effective permissions grant `contents` AND `pull-requests` — effective
//       means the job's own block, or the workflow-level block it inherits when
//       it declares none (a job-level block fully REPLACES the workflow one);
//   (b) each gh-gated step carries `GH_TOKEN` in its `env`; a step invoking a
//       lib/gh consumer additionally carries `PR_NUMBER` (the guards read it).
//       A bare `gh …` step names its own target, so no `PR_NUMBER` is demanded.
//
// Second check — DECLARED SEVERITY (canon §2.1, added in review of PR #154). In
// the workflow that owns the `ci` aggregate, every job must be either WARN
// (`continue-on-error: true`) or BLOCK (listed in the aggregate's needs-list). A
// job that is neither is representable and was undetected: it shows a red X on
// the PR while gating nothing. The `ci` job itself is exempt — it cannot be in
// its own needs-list — and the rule does not apply to workflows with no
// aggregate, where `needs` could not reach it anyway.
//
// Third check — VACUOUS BLOCK (#207). The severity pair above has a fourth
// state: a job that is BOTH `continue-on-error: true` AND in the needs-list. It
// sits there looking like a gate while its failure can no longer redden the
// aggregate, so the needs-list — which canon §2.1 declares to BE the BLOCK set —
// becomes factually wrong. One rule covers both topologies: under the old
// per-job shape it masks one guard, under a batch job every guard in it at once,
// BLOCK ones included.
//
// Fourth check — UNAGGREGATED WARN STEP (#207, from review of PR #206). In a
// batch job the severity moves from the job to the STEP: a guard step carries
// `continue-on-error: true`, and its finding reaches a reader only if some other
// step of the same job reads `steps.<id>.outcome`. A WARN step nothing reads is
// invisible twice over — the finding is swallowed by `continue-on-error` and no
// annotation is emitted — so §4's clean promotion window gets counted off a
// table that does not include it. Canon: docs/ci-guardrails.md §8, «Wiring
// convention for a batch job».
//
// Only GUARD steps are held to this (a `run:` INVOKING a `tools/lint/*-lint.*`
// in command position, by path or through its `pnpm lint:<name>` alias); a
// non-guard step is free to tolerate its own failure, and a command that merely
// names a guard path is not invoking one. A WARN guard step with no `id:` is the
// same finding: nothing can reference it at all.
//
// "Reads the outcome" is deliberately as wide as GitHub's own notion, because a
// narrower one produced three false positives on legitimate workflows (review of
// PR #245): the reference counts in a `run:` body, in an `if:` gate, and in a
// `uses:` step's `with:`/`env:` inputs — a `uses:` aggregator such as
// `actions/github-script` has no `run:` at all — and in either syntax,
// `steps.<id>.outcome` or `steps['<id>'].outcome`. `.conclusion` is NOT accepted
// in its place: `continue-on-error` rewrites it to `success`, so a table built
// on it reports nothing. KNOWN LIMIT: a guard invoked through `uses:` (a
// composite action wrapping it) is not recognised as a guard step, so a WARN
// step of that shape is a false negative. Closing it means resolving the
// action's own definition — a different rule class, deliberately not built until
// a composite action exists in this repo.
//
// Derived, never a literal list: the gh-consumer set comes from scanning
// `tools/lint/` for the `./lib/gh.mjs` import, and the alias map from
// `package.json`. A new gh-consuming guard is picked up with no edit here. The
// scan is deliberately flat (`tools/lint/<name>-lint.{mjs,ts}`) and that is
// safe because `guard-test-coverage` BLOCKS a guard living anywhere else — the
// two meta-guards share one layout assumption, and one of them enforces it.
//
// The guard satisfies its own rule: it touches neither `gh` nor `./lib/gh.mjs`,
// so its own job is not gh-gated and correctly needs no auth block.
//
// Run: `pnpm lint:workflow-auth`. Findings: stderr + exit 1. Clean/empty: exit 0.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

import { isEntryPoint, reporter, repoRoot, runMain, walkFiles } from './lib/guard.mjs'

const TAG = 'workflow-auth'
const REQUIRED_SCOPES = ['contents', 'pull-requests']

/** A bare `gh` invocation at the start of a command or after a shell separator. */
const BARE_GH_RE = /(^|[\n;&|]\s*|\s&&\s|\s\|\|\s)gh\s/

// A guard reaches GitHub either through the shared seam or by spawning the CLI
// itself. Both count: `stage-b-lint.mjs` (#151) has its own runner, and a
// derivation that only looked for the import would have wired it with no auth
// block — vacuously red on every PR, which is what this guard exists to stop.
const IMPORTS_GH_LIB_RE = /['"][^'"]*lib\/gh\.mjs['"]/
const SPAWNS_GH_RE = /(?:spawnSync|spawn|execFile|execFileSync|execa)\(\s*['"]gh['"]/

/** A guard path — the flat layout §8 enforces and both meta-guards assume. */
const GUARD_PATH_RE = /tools\/lint\/[A-Za-z0-9_-]+-lint\.(?:mjs|ts)\b/
/**
 * A guard path in COMMAND position: at the start of the command or after a shell
 * separator, optionally behind a runner word (`node`, `npx`, `tsx`, `pnpm exec`,
 * a `cross-env` prefix ending in one of them). A command that merely NAMES the
 * path — `git diff --name-only | grep tools/lint/no-stub-lint.mjs` — does not
 * invoke a guard and must not be read as one (review of PR #245, minor 1).
 */
const GUARD_INVOKED_RE = new RegExp(
  String.raw`(?:^|[\n;&|(]\s*|\s&&\s|\s\|\|\s)` +
    String.raw`(?:[^\n;&|]*?\b(?:node|npx|tsx|pnpm|npm|yarn)\b[^\n;&|]*?)?` +
    String.raw`(?:\.\/)?tools\/lint\/[A-Za-z0-9_-]+-lint\.(?:mjs|ts)\b`,
)
/**
 * A reference to a step's OUTCOME — the value `continue-on-error` does not mask
 * (unlike `.conclusion`, which it rewrites to `success`). Both syntaxes GitHub
 * accepts: the property form and the index form (review of PR #245, blocker 1).
 */
const STEP_OUTCOME_RE = /steps(?:\.[A-Za-z0-9_-]+|\[\s*['"][^'"]+['"]\s*\])\.outcome/
const outcomeRefRe = (id) =>
  new RegExp(String.raw`steps(?:\.${escapeRe(id)}|\[\s*['"]${escapeRe(id)}['"]\s*\])\.outcome`)

/** `continue-on-error: ${{ … }}` — legal, but the file then declares no severity. */
const isExpression = (v) => typeof v === 'string' && v.includes('${{')

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Every string a step can carry that GitHub evaluates as an expression context:
 * the shell body, the `if:` gate, and — for a `uses:` step, which has no `run:`
 * at all — its `with:` inputs (`actions/github-script`'s `script`, an input
 * passed to a composite action). Read as one blob: this asks "does this step
 * reference that outcome anywhere GitHub would evaluate it", not "where".
 */
function stepExpressionText(step) {
  const parts = []
  for (const key of ['run', 'if', 'name']) {
    if (typeof step?.[key] === 'string') parts.push(step[key])
  }
  const collect = (value, depth = 0) => {
    if (depth > 4) return
    if (typeof value === 'string') parts.push(value)
    else if (Array.isArray(value)) value.forEach((v) => collect(v, depth + 1))
    else if (value && typeof value === 'object')
      Object.values(value).forEach((v) => collect(v, depth + 1))
  }
  collect(step?.with)
  collect(step?.env)
  return parts.join('\n')
}

/**
 * Pure decision seam: guard sources in, the paths that reach GitHub out.
 * @param {{rel: string, text: string}[]} sources
 * @returns {string[]}
 */
export function ghConsumerSources(sources) {
  return sources
    .filter(({ text }) => IMPORTS_GH_LIB_RE.test(text) || SPAWNS_GH_RE.test(text))
    .map(({ rel }) => rel)
}

function permissionsGrant(perms) {
  if (perms === 'read-all' || perms === 'write-all') return REQUIRED_SCOPES
  if (!perms || typeof perms !== 'object') return []
  return REQUIRED_SCOPES.filter((scope) => perms[scope] === 'read' || perms[scope] === 'write')
}

/**
 * Pure decision seam.
 *   workflows  — [{ file, doc }] parsed YAML
 *   ghConsumers — repo-relative paths of guards importing ./lib/gh.mjs
 *   scriptMap  — package.json `scripts`
 * Returns a flat findings list; empty means the workflow set is clean.
 *
 * @param {{ file: string, doc: any }[]} workflows
 * @param {{ ghConsumers?: string[], scriptMap?: Record<string, string> }} [options]
 * @returns {{ file: string, job: string, kind: string, detail: string }[]}
 */
export function auditWorkflows(workflows, { ghConsumers = [], scriptMap = {} } = {}) {
  // A package-manager alias in command position. The trailing lookahead — not
  // `\b` — is what keeps `pnpm lint:css` from resolving through the script named
  // `lint`: `\b` sits happily at the `:` and matched the shorter name (review of
  // PR #245, minor 4). The name is escaped: a script name is data here.
  const aliasRe = (name) =>
    new RegExp(
      String.raw`(?:^|[\s;&|(])(?:pnpm|npm|yarn)\s+(?:run\s+|exec\s+)?${escapeRe(name)}(?=\s|$|[;&|)])`,
    )

  const consumerHit = (cmd) => {
    if (ghConsumers.some((p) => cmd.includes(p) || cmd.includes(p.replace(/\.mjs$/, ''))))
      return true
    for (const [name, body] of Object.entries(scriptMap)) {
      if (aliasRe(name).test(cmd) && ghConsumers.some((p) => String(body).includes(p))) return true
    }
    return false
  }

  // A step is a GUARD step when its command INVOKES a `tools/lint/<name>-lint.*`
  // — by path in command position, or through the `pnpm lint:<name>` alias that
  // resolves to one. Derived from package.json exactly like the gh-consumer set
  // above, so a new guard is covered with no edit here.
  const guardStep = (cmd) => {
    if (GUARD_INVOKED_RE.test(cmd)) return true
    for (const [name, body] of Object.entries(scriptMap)) {
      if (aliasRe(name).test(cmd) && GUARD_PATH_RE.test(String(body))) return true
    }
    return false
  }

  const findings = []
  for (const { file, doc } of workflows) {
    const jobs = doc?.jobs ?? {}

    // Declared-severity check (canon §2.1). Only meaningful in the workflow that
    // owns the `ci` aggregate: elsewhere `needs` cannot reach it, and the canon
    // already fixes every job in pr-body-guards.yml as WARN.
    const aggregate = jobs.ci
    const needsList = aggregate ? [aggregate.needs ?? []].flat().map(String) : null
    if (needsList) {
      for (const [jobName, job] of Object.entries(jobs)) {
        if (jobName === 'ci') continue // the aggregate cannot be in its own needs-list
        const flag = job?.['continue-on-error']
        const warn = flag === true
        const listed = needsList.includes(jobName)
        if (isExpression(flag)) {
          // Neither state is readable off the file, which is what §2.1 requires
          // — and under a `=== true` reading such a job escaped both checks.
          findings.push({
            file,
            job: jobName,
            kind: 'undeclared-severity',
            detail: `job's \`continue-on-error\` is an expression (\`${String(flag).trim()}\`) — severity is then decided at runtime, so the file declares neither WARN nor BLOCK; use a literal \`true\` or drop the key`,
          })
          continue
        }
        if (!warn && !listed) {
          findings.push({
            file,
            job: jobName,
            kind: 'undeclared-severity',
            detail:
              'job is neither WARN (`continue-on-error: true`) nor BLOCK (listed in the `ci` needs-list) — it shows red on the PR while gating nothing',
          })
        }
        if (warn && listed) {
          findings.push({
            file,
            job: jobName,
            kind: 'vacuous-block',
            detail:
              'job is in the `ci` needs-list (BLOCK) while carrying `continue-on-error: true` — it looks like a gate but its failure can no longer redden the aggregate; drop one of the two',
          })
        }
      }
    }

    // Step-level severity inside a batch job (#207): every WARN guard step needs
    // a row in the job's WARN-outcomes aggregation step, or its finding is
    // swallowed silently. Applies to every workflow — the batch shape is not
    // specific to the one that owns the `ci` aggregate.
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : []
      // An expression-valued flag counts: the step may be WARN at runtime, and
      // then its finding is swallowed exactly the same way (PR #245, minor 3).
      const warnSteps = steps.filter(
        (step) =>
          typeof step?.run === 'string' &&
          (step['continue-on-error'] === true || isExpression(step['continue-on-error'])) &&
          guardStep(step.run),
      )
      if (warnSteps.length === 0) continue

      // "Surfaced" is read the way GITHUB reads it: any OTHER step of the job
      // referencing the outcome in an expression context — a `run:` body, an
      // `if:` gate, or a `uses:` step's `with:`/`env:` inputs (a `uses:`
      // aggregator such as `actions/github-script` has no `run:` at all). The
      // aggregator is still identified by what it DOES, never by its `name:`;
      // widening the surface is what the review of PR #245 corrected. A WARN
      // guard step is never its own aggregator.
      const aggregation = steps
        .filter((step) => !warnSteps.includes(step))
        .map(stepExpressionText)
        .filter((text) => STEP_OUTCOME_RE.test(text))
        .join('\n')

      for (const step of warnSteps) {
        const label = step.name ?? step.id ?? step.run.split('\n')[0].slice(0, 40)
        if (step.id === undefined) {
          findings.push({
            file,
            job: jobName,
            kind: 'unaggregated-warn-step',
            detail: `WARN guard step (${label}) carries no \`id:\`, so nothing in the job can read its \`outcome\``,
          })
          continue
        }
        if (!outcomeRefRe(step.id).test(aggregation)) {
          findings.push({
            file,
            job: jobName,
            kind: 'unaggregated-warn-step',
            detail: `WARN guard step \`${step.id}\` (${label}) — no other step in this job reads \`steps.${step.id}.outcome\`, so its finding is swallowed by \`continue-on-error\` and never annotated`,
          })
        }
      }
    }

    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : []
      const gated = steps
        .map((step, i) => ({ step, i }))
        .filter(({ step }) => typeof step?.run === 'string')
        .map(({ step, i }) => ({
          step,
          i,
          consumer: consumerHit(step.run),
          bare: BARE_GH_RE.test(step.run),
        }))
        .filter((s) => s.consumer || s.bare)
      if (gated.length === 0) continue

      const granted = permissionsGrant(job?.permissions ?? doc?.permissions)
      for (const scope of REQUIRED_SCOPES) {
        if (!granted.includes(scope)) {
          findings.push({
            file,
            job: jobName,
            kind: 'missing-permission',
            detail: `job reaches GitHub but its effective permissions do not grant \`${scope}\``,
          })
        }
      }
      for (const { step, i, consumer } of gated) {
        const env = step.env ?? {}
        if (env.GH_TOKEN === undefined) {
          findings.push({
            file,
            job: jobName,
            kind: 'missing-token',
            detail: `step ${i + 1} (${step.name ?? step.run.split('\n')[0].slice(0, 40)}) has no GH_TOKEN in env`,
          })
        }
        if (consumer && env.PR_NUMBER === undefined) {
          findings.push({
            file,
            job: jobName,
            kind: 'missing-pr-number',
            detail: `step ${i + 1} invokes a lib/gh guard without PR_NUMBER in env`,
          })
        }
      }
    }
  }
  return findings
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()

  const workflowFiles = walkFiles(root, {
    include: (rel) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(rel),
  })
  const workflows = workflowFiles.map((file) => ({
    file,
    doc: parse(readFileSync(resolve(root, file), 'utf8')),
  }))

  const ghConsumers = ghConsumerSources(
    walkFiles(root, {
      include: (rel) => /^tools\/lint\/[^/]+-lint\.(mjs|ts)$/.test(rel),
    }).map((rel) => ({ rel, text: readFileSync(resolve(root, rel), 'utf8') })),
  )

  let scriptMap = {}
  try {
    scriptMap = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts ?? {}
  } catch {
    scriptMap = {}
  }

  out.info(
    `${workflows.length} workflow file(s), ${ghConsumers.length} gh-consuming guard(s) derived from tools/lint`,
  )
  const findings = auditWorkflows(workflows, { ghConsumers, scriptMap })
  if (findings.length === 0) {
    out.ok(
      'PASS — every GitHub-reaching job carries permissions + GH_TOKEN (+ PR_NUMBER), ' +
        'and every job/WARN guard step declares its severity honestly.',
    )
  }
  for (const f of findings) {
    out.finding(`${f.kind}  ${f.file} :: job \`${f.job}\`  — ${f.detail}`)
  }
  out.fail(
    `${findings.length} finding(s). Auth: the JOB carries ` +
      '`permissions: { contents: read, pull-requests: read }` and the invoking STEP carries ' +
      '`GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` + `PR_NUMBER: ${{ github.event.pull_request.number }}`; ' +
      'without it the job goes red before it evaluates its own rule. Severity (canon §2.1): a job is ' +
      'WARN (`continue-on-error: true`, absent from the `ci` needs-list) or BLOCK (needs-listed, no ' +
      '`continue-on-error`) — never both, never neither, and never an expression. A WARN guard STEP ' +
      'in a batch job carries an `id:` and some other step of that job reads `steps.<id>.outcome` — ' +
      "in a `run:`, an `if:` or a `uses:` step's `with:`. Canon: docs/ci-guardrails.md §2.1 (job " +
      'severity) + §8 «Wiring convention for a batch job» (step severity).',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
