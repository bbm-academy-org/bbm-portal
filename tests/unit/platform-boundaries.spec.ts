// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * `pnpm boundaries` — the module-boundary rules the platform database adds
 * (#125, acceptance criterion «`pnpm depcruise` fails when a module reaches for
 * another module's tables»).
 *
 * The rules are regexes over paths, so the only honest test is to RUN
 * dependency-cruiser against a tree that violates them and read its exit code —
 * an assertion on the config object would only re-state the regex.
 *
 * The fixture trees are fake repos with their own `src/`, cruised with the
 * fixture dir as cwd, so the real `^src/…` rules match them exactly as they
 * match this repo. They live under `tools/lint/guard-tests/fixtures/` because
 * that path is already excluded from eslint, prettier and tsc as "fake repo
 * trees fed to the CI guards as input under test" (docs/ci-guardrails.md §8);
 * the SPEC cannot live there, since `guard-test-coverage` requires every spec in
 * `tools/lint/guard-tests/` to pair with a `tools/lint/<name>-lint.<ext>` guard,
 * and `boundaries` is dependency-cruiser, not one of ours.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONFIG = resolve(REPO_ROOT, '.dependency-cruiser.cjs')
const DEPCRUISE_BIN = resolve(
  REPO_ROOT,
  'node_modules',
  'dependency-cruiser',
  'bin',
  'dependency-cruise.mjs',
)
const FIXTURES = resolve(REPO_ROOT, 'tools', 'lint', 'guard-tests', 'fixtures', 'boundaries')

function cruiseFixture(name: string) {
  const cwd = resolve(FIXTURES, name)
  expect(existsSync(cwd)).toBe(true)
  const res = spawnSync(
    process.execPath,
    [DEPCRUISE_BIN, 'src', '--config', CONFIG, '--output-type', 'err'],
    { cwd, encoding: 'utf8' },
  )
  return { code: res.status ?? -1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` }
}

describe('module-must-not-import-foreign-tables', () => {
  it('FAILS when a module reaches for another module’s tables', () => {
    const { code, output } = cruiseFixture('module-imports-foreign-tables')
    expect(output).toContain('module-must-not-import-foreign-tables')
    expect(code).not.toBe(0)
  })

  it('allows a module its OWN tables and the shared `core` schema handle', () => {
    const { code, output } = cruiseFixture('module-owns-its-tables')
    expect(output).not.toContain('module-must-not-import-foreign-tables')
    expect(code).toBe(0)
  })
})

describe('cms-must-not-import-platform-db', () => {
  it('FAILS when CMS-side code opens the platform database', () => {
    const { code, output } = cruiseFixture('cms-imports-platform-db')
    expect(output).toContain('cms-must-not-import-platform-db')
    expect(code).not.toBe(0)
  })
})

describe('the real tree', () => {
  it('is clean under the same rules (this is `pnpm boundaries`)', () => {
    const res = spawnSync(
      process.execPath,
      [DEPCRUISE_BIN, 'src', '--config', CONFIG, '--output-type', 'err'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(`${res.stdout ?? ''}${res.stderr ?? ''}`).not.toContain('error')
    expect(res.status).toBe(0)
  })
})
