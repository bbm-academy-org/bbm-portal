import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Harness for the guard specs (docs/ci-guardrails.md §8).
 *
 * Every guard spec unit-tests the guard's exported decision seam AND spawns the
 * real script at least once against a fixture tree, asserting the exit code:
 * the exit code IS the severity contract, so it is tested, never assumed.
 *
 * Guards are plain `.mjs`, so the harness spawns `node` directly — no tsx, no
 * package-manager shim, identical on the Windows dev box and the ubuntu runner.
 */

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const LINT_DIR = resolve(REPO_ROOT, 'tools', 'lint')
export const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')

export interface GuardResult {
  code: number
  stdout: string
  stderr: string
}

export interface RunGuardOptions {
  /** Extra CLI args appended after the guard path. */
  extraArgs?: string[]
  /** Env layered over a cleaned `process.env` (see the ambient-CI note below). */
  env?: Record<string, string>
  /** Scan the real repo instead of a fixture tree (omit `caseDir`). */
  realTree?: boolean
}

/**
 * Ambient CI values must never leak into a guard run: the guard-tests job runs
 * inside a real `pull_request` event, so an un-cleaned env would make a PR-gated
 * guard reach for the live PR mid-test. Cleared, then re-set per case.
 */
const AMBIENT = [
  'GITHUB_EVENT_NAME',
  'GITHUB_REF',
  'PR_NUMBER',
  'GITHUB_PR_NUMBER',
  'PR_BODY',
  'LINT_FIXTURE_ROOT',
  'LINT_GH_FIXTURE_DIR',
  'LINT_AUDIT_ALLOWLIST',
  'LINT_TDD_ORDER_PAGE_SIZE',
]

export function runGuard(
  guardFile: string,
  caseDir: string | null,
  opts: RunGuardOptions = {},
): GuardResult {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of AMBIENT) delete env[key]
  if (caseDir) env.LINT_FIXTURE_ROOT = caseDir
  Object.assign(env, opts.env ?? {})

  const res = spawnSync(
    process.execPath,
    [resolve(LINT_DIR, guardFile), ...(opts.extraArgs ?? [])],
    {
      cwd: REPO_ROOT,
      // Next's ambient ProcessEnv makes NODE_ENV required; the cleaned copy is a
      // plain record, so the cast is the honest shape, not a suppression.
      env: env as NodeJS.ProcessEnv,
      encoding: 'utf8',
    },
  )
  return {
    // `.status` is null when the process was killed by a signal — surface as -1.
    code: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  }
}

/** Absolute path of a fixture case dir: fixtures/<guard>/<case>. */
export function caseDir(guard: string, name: string): string {
  return resolve(FIXTURES_DIR, guard, name)
}

/** Absolute path of a fixture case's canned `gh` dir: fixtures/<guard>/<case>/gh. */
export function ghDir(guard: string, name: string): string {
  return resolve(FIXTURES_DIR, guard, name, 'gh')
}
