#!/usr/bin/env node
// workflow-auth — a workflow job that reaches GitHub must carry the auth block.
//
// Canon: docs/ci-guardrails.md §5. Severity: WARN since 2026-08-05; earliest
// promotion 2026-09-02 under the §4 clauses.
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
// Derived, never a literal list: the gh-consumer set comes from scanning
// `tools/lint/` for the `./lib/gh.mjs` import, and the alias map from
// `package.json`. A new gh-consuming guard is picked up with no edit here.
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
  const consumerHit = (cmd) => {
    if (ghConsumers.some((p) => cmd.includes(p) || cmd.includes(p.replace(/\.mjs$/, ''))))
      return true
    for (const [name, body] of Object.entries(scriptMap)) {
      const invoked = new RegExp(`\\b(pnpm|npm run|yarn)\\s+(run\\s+)?${name}\\b`)
      if (invoked.test(cmd) && ghConsumers.some((p) => String(body).includes(p))) return true
    }
    return false
  }

  const findings = []
  for (const { file, doc } of workflows) {
    const jobs = doc?.jobs ?? {}
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

  const ghConsumers = walkFiles(root, {
    include: (rel) => /^tools\/lint\/[^/]+-lint\.(mjs|ts)$/.test(rel),
  }).filter((rel) =>
    /from\s+'\.\/lib\/gh\.mjs'|require\(['"]\.\/lib\/gh/.test(
      readFileSync(resolve(root, rel), 'utf8'),
    ),
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
    out.ok('PASS — every GitHub-reaching job carries permissions + GH_TOKEN (+ PR_NUMBER).')
  }
  for (const f of findings) {
    out.finding(`${f.kind}  ${f.file} :: job \`${f.job}\`  — ${f.detail}`)
  }
  out.fail(
    `${findings.length} auth gap(s). The canonical block: the JOB carries ` +
      '`permissions: { contents: read, pull-requests: read }` and the invoking STEP carries ' +
      '`GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` + `PR_NUMBER: ${{ github.event.pull_request.number }}`. ' +
      'Without it the job goes red before it evaluates its own rule. Canon: docs/ci-guardrails.md §8.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
