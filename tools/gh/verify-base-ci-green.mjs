#!/usr/bin/env node
// `pnpm ci:verify-base` — is the base branch's CI green right now?
//
// task-cycle stage 3 says: "before pushing, check CI is green on `main`, so an
// inherited red is not mistaken for your own". This is that sentence as a
// command with an exit code (#136). The failure it prevents is specific and has
// happened: an agent reads its own PR's red check, assumes it broke something,
// and spends the session repairing a baseline failure that has nothing to do
// with its change.
//
// Verdict comes from `gh run list` structured fields — never from grepping job
// names, which produce a false green the first time a job is renamed. The
// NEWEST COMPLETED run decides; a still-running run is not evidence.
//
//   exit 0  green    — the base's last completed run succeeded
//   exit 1  red      — it failed / was cancelled / timed out. The command prints
//                      a ready disclaimer block: paste it into the PR body so a
//                      reviewer can tell an inherited red from an introduced one.
//   exit 2  pending  — nothing completed yet, or `gh` could not be read. Not
//                      green: an unknown base is exactly the case this exists for.
//
// Usage: pnpm ci:verify-base [--branch main] [--workflow CI] [--json]
//        `--workflow ""` reads every workflow on the branch.

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const EXIT = { green: 0, red: 1, pending: 2 }

const RED_CONCLUSIONS = ['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required']

/**
 * Structural classification of `gh run list --json` rows.
 * @param {{workflowName?:string,status?:string,conclusion?:string|null,headSha?:string,displayTitle?:string,url?:string,createdAt?:string}[]} runs
 * @param {string} [workflow] only consider this workflow; '' means all
 * @returns {{verdict:'green'|'red'|'pending', run: any}}
 */
export function classifyRuns(runs, workflow = 'CI') {
  const completed = (runs ?? [])
    .filter((r) => !workflow || r.workflowName === workflow)
    .filter((r) => r.status === 'completed')
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
  const latest = completed[0]
  if (!latest) return { verdict: 'pending', run: null }
  if (latest.conclusion === 'success' || latest.conclusion === 'skipped') {
    return { verdict: 'green', run: latest }
  }
  if (RED_CONCLUSIONS.includes(String(latest.conclusion))) return { verdict: 'red', run: latest }
  return { verdict: 'pending', run: latest }
}

/** The block to paste into the PR body when the base is already red. */
export function disclaimer(run, branch) {
  return [
    `> **Baseline CI on \`${branch}\` was already red before this PR.**`,
    `> Last completed run: ${run?.conclusion} on \`${String(run?.headSha ?? '').slice(0, 7)}\` — ${run?.url}`,
    '> Red checks here are not necessarily introduced by this change; compare against that run.',
  ].join('\n')
}

export function parseFlags(argv) {
  const opts = { ok: true, branch: 'main', workflow: 'CI', json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--branch') opts.branch = argv[++i] ?? ''
    else if (a === '--workflow') opts.workflow = argv[++i] ?? ''
    else if (a === '--json') opts.json = true
    else return { ...opts, ok: false, error: `unknown argument: ${a}` }
  }
  return opts
}

function ghRunList(branch) {
  const res = spawnSync(
    'gh',
    [
      'run',
      'list',
      '--branch',
      branch,
      '--limit',
      '20',
      '--json',
      'workflowName,status,conclusion,headSha,displayTitle,url,createdAt',
    ],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  )
  if (res.status !== 0) return { ok: false, error: (res.stderr || 'gh run list failed').trim() }
  try {
    return { ok: true, data: JSON.parse(res.stdout) }
  } catch (e) {
    return { ok: false, error: `could not parse gh output: ${e.message}` }
  }
}

function main() {
  const opts = parseFlags(process.argv.slice(2))
  if (!opts.ok) {
    process.stderr.write(`[verify-base-ci-green] ${opts.error}\n`)
    process.exit(EXIT.pending)
  }
  if (opts.help) {
    process.stdout.write('usage: pnpm ci:verify-base [--branch main] [--workflow CI] [--json]\n')
    process.exit(EXIT.green)
  }

  const list = ghRunList(opts.branch)
  if (!list.ok) {
    process.stderr.write(`[verify-base-ci-green] could not read runs: ${list.error}\n`)
    process.exit(EXIT.pending)
  }

  const { verdict, run } = classifyRuns(list.data, opts.workflow)
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ verdict, branch: opts.branch, run }, null, 2)}\n`)
  }

  if (verdict === 'green') {
    process.stdout.write(
      `[verify-base-ci-green] GREEN — \`${opts.branch}\` last completed run succeeded (${String(run.headSha).slice(0, 7)}).\n`,
    )
    process.exit(EXIT.green)
  }
  if (verdict === 'pending') {
    process.stdout.write(
      `[verify-base-ci-green] PENDING — no completed run on \`${opts.branch}\` yet. Not green: re-run before you attribute a red check to your own change.\n`,
    )
    process.exit(EXIT.pending)
  }
  process.stderr.write(
    `[verify-base-ci-green] RED — \`${opts.branch}\` is already broken (${run.conclusion}, ${run.url}).\n` +
      'Put this in the PR body so an inherited red is not read as your regression:\n\n' +
      `${disclaimer(run, opts.branch)}\n`,
  )
  process.exit(EXIT.red)
}

// Entry-point guard: importing this file in its spec must not spawn `gh`.
const invoked = process.argv[1]
if (invoked && import.meta.url === pathToFileURL(resolve(invoked)).href) main()
