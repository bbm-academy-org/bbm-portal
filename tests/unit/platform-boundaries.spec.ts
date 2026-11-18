// @vitest-environment node
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

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

type Cruise = { code: number; output: string }

/**
 * Every case is one dependency-cruiser CLI run, and most of a run is the CLI
 * loading its own module graph (measured 2026-11-18 on the Windows dev box:
 * `dependency-cruise --version` ≈ 0.95 s, a fixture cruise ≈ 1.2 s, the real
 * tree ≈ 3.3 s). Sixteen of them back to back made this file ~20–40 s and
 * pushed single cases past Vitest's 5 s under machine load (#566). The runs are
 * independent — each has its own cwd and reads nothing another writes — so
 * they start together, a bounded pool at a time, ONCE per file, and the cases
 * read the settled results. Still the real CLI, real config, real exit code.
 */
function runCruise(cwd: string): Promise<Cruise> {
  return new Promise((settle) => {
    execFile(
      process.execPath,
      [DEPCRUISE_BIN, 'src', '--config', CONFIG, '--output-type', 'err'],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // A non-zero exit arrives as a numeric `error.code`; a failed spawn or a
        // signal reads as -1, as `spawnSync`'s null status did.
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
        settle({ code, output: `${stdout ?? ''}${stderr ?? ''}` })
      },
    )
  })
}

async function cruiseAll(dirs: string[], width: number): Promise<Map<string, Cruise>> {
  const results = new Map<string, Cruise>()
  const queue = [...dirs]
  const worker = async () => {
    for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
      results.set(dir, await runCruise(dir))
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, dirs.length) }, worker))
  return results
}

let cruises = new Map<string, Cruise>()

beforeAll(
  async () => {
    const fixtureDirs = readdirSync(FIXTURES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(FIXTURES, entry.name))
    cruises = await cruiseAll(
      [...fixtureDirs, REPO_ROOT],
      Math.max(2, Math.min(8, availableParallelism())),
    )
  },
  // The whole file's cruising happens in this one hook. Measured 2026-11-18 on
  // the Windows dev box: the serial file took 40.5 s inside a loaded full
  // `pnpm test:unit`, and one fixture cruise alone hit 7.8 s. Vitest's 10 s
  // hook default would turn machine load into a red unit tier; 60 s still
  // fails a genuinely hung cruise.
  60_000,
)

function cruiseFixture(name: string): Cruise {
  const cwd = resolve(FIXTURES, name)
  expect(existsSync(cwd)).toBe(true)
  const result = cruises.get(cwd)
  if (!result) throw new Error(`fixture ${name} was not cruised in beforeAll`)
  return result
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

describe('route-layer-must-not-import-tables', () => {
  it('FAILS when a route file imports a module’s tables directly', () => {
    // The hole review major 5 found: `module-must-not-import-foreign-tables`
    // keys on `^src/(lib|modules)/<module>/`, and `cms-must-not-import-platform-db`
    // deliberately omits the (platform) route group — so nothing stopped
    // `src/app/(platform)/hours/page.tsx` from holding a table handle, which is
    // the very invariant ADR-004 §6 states as machine-enforced. The view layer
    // has no business with a table at all, so the rule needs no `$1` exception.
    const { code, output } = cruiseFixture('route-imports-tables')
    expect(output).toContain('route-layer-must-not-import-tables')
    expect(code).not.toBe(0)
  })
})

describe('the member module boundary (spec 124 EARS-8)', () => {
  it('EARS-8: FAILS when hours imports member module internals instead of its public API', () => {
    const { code, output } = cruiseFixture('hours-imports-member-internals')
    expect(output).toContain('hours-must-import-member-only-via-api')
    expect(code).not.toBe(0)
  })

  it('EARS-8: allows hours the member public API (src/lib/member/index.ts)', () => {
    const { code, output } = cruiseFixture('hours-imports-member-api')
    expect(output).not.toContain('hours-must-import-member-only-via-api')
    expect(code).toBe(0)
  })

  it('EARS-8: FAILS when the CMS side or the OKR module reaches for the member registry at all', () => {
    const { code, output } = cruiseFixture('cms-and-okr-import-member')
    expect(output).toContain('cms-and-okr-must-not-import-member')
    // Both from-sets are exercised by the one fixture — the CMS collection and
    // the OKR module each import the member barrel, so a rule that lost half its
    // from-set would still leave one of these two dependencies reported.
    expect(output).toContain('collections/Team.ts')
    expect(output).toContain('okr/rollup.ts')
    expect(code).not.toBe(0)
  })
})

describe('cms-must-not-import-platform-db', () => {
  it('FAILS when CMS-side code opens the platform database', () => {
    const { code, output } = cruiseFixture('cms-imports-platform-db')
    expect(output).toContain('cms-must-not-import-platform-db')
    expect(code).not.toBe(0)
  })
})

describe('the UI kit boundary (spec 311 EARS-458, consolidation §10)', () => {
  it('EARS-458: FAILS when src/ui imports a module', () => {
    const { code, output } = cruiseFixture('ui-imports-module')
    expect(output).toContain('ui-kit-must-not-import-src')
    expect(code).not.toBe(0)
  })

  it('EARS-458: FAILS when src/ui reaches for a route, the CMS side or the platform db', () => {
    // The clause says «`src/ui` не импортирует ни один модуль», and the rule is
    // written wider than the word "module" on purpose: a kit that may not
    // import `src/lib/hours` but MAY import `src/app`, `src/collections` or
    // `src/lib/platform/db` is not context-free, it just leaks through a door
    // nobody named. One fixture exercises all three so a rule that lost part of
    // its to-set still leaves a dependency unreported.
    const { code, output } = cruiseFixture('ui-imports-app-and-cms')
    expect(output).toContain('ui-kit-must-not-import-src')
    expect(output).toContain('app/(platform)')
    expect(output).toContain('collections/Team.ts')
    expect(output).toContain('platform/db')
    expect(code).not.toBe(0)
  })

  it('EARS-458: allows a module, a route and the CMS side to import src/ui', () => {
    const { code, output } = cruiseFixture('module-imports-ui')
    expect(output).not.toContain('ui-kit-must-not-import-src')
    expect(code).toBe(0)
  })

  it('EARS-458: allows src/ui to import its own files', () => {
    const { code, output } = cruiseFixture('ui-imports-itself')
    expect(output).not.toContain('ui-kit-must-not-import-src')
    expect(code).toBe(0)
  })
})

describe('the workspace registry boundary (spec 311 EARS-456/EARS-457, D-3)', () => {
  it('EARS-456: FAILS when a module imports the composition root', () => {
    const { code, output } = cruiseFixture('module-imports-workspace-registry')
    expect(output).toContain('module-must-not-import-workspace-registry')
    // The barrel is named in the to-set as well as registry.ts — otherwise the
    // rule is one import specifier away from meaning nothing.
    expect(output).toContain('modules/okr/workspace.ts')
    expect(code).not.toBe(0)
  })

  it('EARS-456: allows a module the contract, and the route group the registry', () => {
    const { code, output } = cruiseFixture('module-imports-workspace-contract')
    expect(output).not.toContain('module-must-not-import-workspace-registry')
    expect(output).not.toContain('workspace-registry-is-not-importable-outside-the-frame')
    expect(code).toBe(0)
  })

  it('EARS-457: FAILS when anything outside the frame imports the registry', () => {
    // The CMS side is the caller EARS-457 catches that EARS-456 does not: it is
    // no module, so the module rule's from-set never sees it.
    const { code, output } = cruiseFixture('cms-imports-workspace-registry')
    expect(output).toContain('workspace-registry-is-not-importable-outside-the-frame')
    expect(output).not.toContain('module-must-not-import-workspace-registry')
    expect(code).not.toBe(0)
  })

  it('EARS-457: reports a module reaching for the registry under BOTH rules', () => {
    const { output } = cruiseFixture('module-imports-workspace-registry')
    expect(output).toContain('workspace-registry-is-not-importable-outside-the-frame')
  })
})

describe('the real tree', () => {
  it('is clean under the same rules (this is `pnpm boundaries`)', () => {
    const res = cruises.get(REPO_ROOT)
    expect(res).toBeDefined()
    expect(res?.output).not.toContain('error')
    expect(res?.code).toBe(0)
  })
})
