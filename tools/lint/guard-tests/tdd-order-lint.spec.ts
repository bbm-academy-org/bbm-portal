import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { evaluateStaged, isPlatformModule } from '../tdd-order-lint.mjs'
import { runGuard } from './run-guard'

/**
 * tdd-order — a pre-commit NOTE about how a new platform module and its test
 * were staged (#355, #621; canon docs/ci-guardrails.md §5).
 *
 * Since #621 the guard judges nothing: commit order is not the evidence of TDD
 * (tests that cover the change, green, confirmed by the stage-4 review are), so
 * it has no CI plane and every run exits 0. What it still does is tell a
 * developer, at commit time, that a new module went in with its test or with
 * none — a nudge toward the practice, never a refusal and never a rebase.
 */

describe('isPlatformModule', () => {
  it('scopes to the platform-module paths', () => {
    expect(isPlatformModule('src/lib/leads/intake.ts')).toBe(true)
    expect(isPlatformModule('src/app/(platform)/p/finance/page.tsx')).toBe(true)
  })

  it('leaves everything outside those paths alone', () => {
    expect(isPlatformModule('tools/lint/tdd-order-lint.mjs')).toBe(false)
    expect(isPlatformModule('src/app/(payload)/admin/page.tsx')).toBe(false)
    expect(isPlatformModule('src/collections/Leads.ts')).toBe(false)
    expect(isPlatformModule('docs/specs/355-guard.md')).toBe(false)
  })

  it('is not armed by a test source, a fixture, or an exempt file', () => {
    expect(isPlatformModule('src/lib/leads/intake.spec.ts')).toBe(false)
    expect(isPlatformModule('tools/lint/guard-tests/fixtures/x/src/lib/a.ts')).toBe(false)
    expect(isPlatformModule('src/lib/platform/db/types.d.ts')).toBe(false)
  })
})

describe('evaluateStaged', () => {
  it('is silent for a new module whose test is already in HEAD — the RED-first path', () => {
    expect(
      evaluateStaged([
        { path: 'src/lib/leads/intake.ts', headTests: ['tests/unit/x.spec.ts'], indexTests: [] },
      ]),
    ).toEqual({ mixed: [], advisory: [] })
  })

  it('classifies a MIXED commit — module and its test staged together', () => {
    expect(
      evaluateStaged([
        {
          path: 'src/lib/leads/intake.ts',
          headTests: [],
          indexTests: ['tests/unit/leads-intake.spec.ts'],
        },
      ]),
    ).toEqual({
      mixed: [{ path: 'src/lib/leads/intake.ts', tests: ['tests/unit/leads-intake.spec.ts'] }],
      advisory: [],
    })
  })

  it('only ADVISES on a new module nothing cites — never blocks it', () => {
    expect(
      evaluateStaged([{ path: 'src/lib/hours/index.ts', headTests: [], indexTests: [] }]),
    ).toEqual({ mixed: [], advisory: [{ path: 'src/lib/hours/index.ts' }] })
  })

  it('does not block a barrel, a layout or a schema table — the 41-of-78 class', () => {
    const uncitable = [
      'src/lib/hours/index.ts',
      'src/app/(platform)/p/layout.tsx',
      'src/lib/platform/db/schema/finance/accounts.ts',
      'src/lib/finance/core/money.ts',
    ].map((path) => ({ path, headTests: [], indexTests: [] }))
    const res = evaluateStaged(uncitable)
    expect(res.mixed).toEqual([])
    expect(res.advisory).toHaveLength(4)
  })

  it('a test in HEAD wins even when one is also staged — the obligation was already met', () => {
    expect(
      evaluateStaged([
        {
          path: 'src/lib/leads/intake.ts',
          headTests: ['tests/unit/x.spec.ts'],
          indexTests: ['tests/unit/x.spec.ts'],
        },
      ]),
    ).toEqual({ mixed: [], advisory: [] })
  })

  it('separates the two directions across several modules', () => {
    const res = evaluateStaged([
      { path: 'src/lib/a/one.ts', headTests: [], indexTests: [] },
      { path: 'src/lib/b/two.ts', headTests: [], indexTests: ['tests/unit/two.spec.ts'] },
    ])
    expect(res.mixed.map((m) => m.path)).toEqual(['src/lib/b/two.ts'])
    expect(res.advisory.map((a) => a.path)).toEqual(['src/lib/a/one.ts'])
  })
})

describe('tdd-order --staged (spawned against a real git index)', () => {
  const repos: string[] = []
  afterAll(() => {
    for (const dir of repos) rmSync(dir, { recursive: true, force: true })
  })

  const git = (cwd: string, ...args: string[]) => {
    const res = spawnSync('git', args, { cwd, encoding: 'utf8' })
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`)
    return res.stdout
  }

  const put = (root: string, rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }

  /** A throwaway repo with a real index — the plumbing under test is the real one. */
  const repo = (build: (root: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'tdd-order-staged-'))
    repos.push(root)
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'guard@test.local')
    git(root, 'config', 'user.name', 'guard test')
    put(root, 'README.md', '# fixture repo\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'base')
    build(root)
    return root
  }

  const staged = (root: string) => runGuard('tdd-order-lint.mjs', root, { extraArgs: ['--staged'] })

  const MODULE = 'src/lib/leads/intake.ts'
  const TEST = 'tests/unit/leads-intake.spec.ts'
  const testBody = "import { intake } from '@/lib/leads/intake'\nit('reds', () => intake())\n"

  it('exits 0 when the failing test is already committed — the ritual followed', () => {
    const root = repo((r) => {
      put(r, TEST, testBody)
      git(r, 'add', '.')
      git(r, 'commit', '-qm', 'test(leads): RED')
      put(r, MODULE, 'export const intake = () => true\n')
      git(r, 'add', MODULE)
    })
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('PASS')
    expect(res.stdout).not.toContain('mixed commit')
  })

  it('ADVISES but exits 0 when a new module is staged with no test anywhere', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      git(r, 'add', MODULE)
    })
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain(MODULE)
    expect(res.stdout).toContain('write a failing test for it')
  })

  // REGRESSION (round-2 review, BLOCKER): 41 of 78 platform files on `main` are
  // not name-cited by any test — barrels are structurally uncitable, and a route
  // layout or a Drizzle table is not imported by path in a test. None is a TDD
  // violation, and blocking them would make `--no-verify` the correct usage.
  it('exits 0 for a barrel, a layout and a schema table staged alone', () => {
    const root = repo((r) => {
      put(r, 'src/lib/hours/index.ts', "export * from './format'\n")
      put(r, 'src/app/(platform)/p/layout.tsx', 'export default function L() {}\n')
      put(r, 'src/lib/platform/db/schema/finance/accounts.ts', 'export const accounts = {}\n')
      git(r, 'add', '.')
    })
    expect(staged(root).code).toBe(0)
  })

  it('exits 0 on a MIXED commit and names module and test in a note', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      put(r, TEST, testBody)
      git(r, 'add', '.')
    })
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('mixed commit')
    expect(res.stdout).toContain(MODULE)
    expect(res.stdout).toContain(TEST)
  })

  // #570: on Windows the guard ran git through cmd.exe, which split an argument
  // with a space — the `git grep -e '<module path>'` needle came apart, no test
  // was found citing the module, and the MIXED commit was reported as the uncited advisory instead.
  it.each([
    ['a directory', 'src/lib/lead forms/intake.ts', '@/lib/lead forms/intake'],
    ['a file name', 'src/lib/leads/lead intake.ts', '@/lib/leads/lead intake'],
  ])('notes a MIXED commit whose module path has a space in %s', (_, module, cite) => {
    const spacedTest = 'tests/unit/lead forms.spec.ts'
    const root = repo((r) => {
      put(r, module, 'export const intake = () => true\n')
      put(r, spacedTest, `import { intake } from '${cite}'\nit('reds', () => intake())\n`)
      git(r, 'add', '.')
    })
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('mixed commit')
    expect(res.stdout).toContain(module)
    expect(res.stdout).toContain(spacedTest)
  })

  // #573: with git's default `core.quotepath=true`, `git diff --name-only` and
  // `git grep -l` print a non-ASCII path as a quoted octal escape
  // (`"src/lib/\320\273..."`), which never matched a module path — a MIXED
  // commit under a Cyrillic path passed with exit 0. The repo pins the default
  // locally so a machine-wide `quotepath=false` cannot hide the bug.
  const cyrillic = (build: (root: string) => void) =>
    repo((r) => {
      git(r, 'config', 'core.quotepath', 'true')
      build(r)
    })

  it.each([
    ['a directory', 'src/lib/лиды/intake.ts', '@/lib/лиды/intake', 'tests/unit/leads.spec.ts'],
    ['a file name', 'src/lib/leads/заявка.ts', '@/lib/leads/заявка', 'tests/unit/leads.spec.ts'],
    ['the test path too', 'src/lib/лиды/intake.ts', '@/lib/лиды/intake', 'tests/unit/лиды.spec.ts'],
  ])('notes a MIXED commit whose path is non-ASCII in %s', (_, mod, cite, test) => {
    const root = cyrillic((r) => {
      put(r, mod, 'export const intake = () => true\n')
      put(r, test, `import { intake } from '${cite}'\nit('reds', () => intake())\n`)
      git(r, 'add', '.')
    })
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('mixed commit')
    expect(res.stdout).toContain(mod)
    expect(res.stdout).toContain(test)
  })

  it('exits 0 when the non-ASCII test is already committed — the ritual followed', () => {
    const mod = 'src/lib/лиды/intake.ts'
    const test = 'tests/unit/лиды.spec.ts'
    const root = cyrillic((r) => {
      put(r, test, "import { intake } from '@/lib/лиды/intake'\nit('reds', () => intake())\n")
      git(r, 'add', '.')
      git(r, 'commit', '-qm', 'test(leads): RED')
      put(r, mod, 'export const intake = () => true\n')
      git(r, 'add', mod)
    })
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('PASS')
    expect(res.stdout).not.toContain('mixed commit')
  })

  it('exits 0 when nothing new lands under the platform-module scope', () => {
    const root = repo((r) => {
      put(r, 'docs/notes.md', 'prose\n')
      put(r, 'tools/lint/whatever.mjs', 'export const x = 1\n')
      git(r, 'add', '.')
    })
    const res = staged(root)
    expect(res.code).toBe(0)
  })

  it('exits 0 for a MODIFIED existing module — v1 scope is new files', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      git(r, 'add', '.')
      git(r, 'commit', '-qm', 'feat: module')
      put(r, MODULE, 'export const intake = () => false\n')
      git(r, 'add', MODULE)
    })
    expect(staged(root).code).toBe(0)
  })

  it('exits 0 for a RENAME of a tracked module — moving code re-opens no obligation', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      git(r, 'add', '.')
      git(r, 'commit', '-qm', 'feat: module')
      git(r, 'mv', MODULE, 'src/lib/leads/renamed.ts')
    })
    expect(staged(root).code).toBe(0)
  })

  it('exits 0 with nothing staged at all', () => {
    const root = repo(() => {})
    const res = staged(root)
    expect(res.code).toBe(0)
  })

  // #621: the guard has no CI plane any more — run without `--staged` (as
  // `pnpm lint:tdd-order` and a stale CI job would) it reads the index exactly
  // the same way and never reaches for the PR's commit graph.
  it('without --staged it still reads only the index and exits 0 on a MIXED commit', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      put(r, TEST, testBody)
      git(r, 'add', '.')
    })
    const res = runGuard('tdd-order-lint.mjs', root, {
      env: { GITHUB_EVENT_NAME: 'pull_request', PR_NUMBER: '7' },
    })
    expect(res.code).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('mixed commit')
  })

  it('never presents commit order as something CI judges, and never says rebase', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      git(r, 'add', MODULE)
    })
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('advisory')
    expect(res.stdout).not.toMatch(/judges the real commit order|rebase/i)
  })

  // #621: a MIXED commit is a note, never a refusal — commit order is not the
  // evidence of TDD, so nothing here may push a developer into a rebase or a
  // hook bypass.
  it('a MIXED commit exits 0 and says a separate RED commit is not required', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      put(r, TEST, testBody)
      git(r, 'add', '.')
    })
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stderr).toBe('')
    expect(res.stdout).toContain('mixed commit')
    expect(res.stdout).toContain('not required')
    expect(res.stdout).toContain('PASS')
  })
})

/**
 * #565 — a MERGE in progress (MERGE_HEAD present). The index then holds every
 * file the other parent brought in; read against HEAD alone, main's module and
 * its test arrive together and look like a MIXED commit this branch authored.
 * Only what the resolution itself introduces — new against EVERY parent — is
 * this commit's authorship, and a test already committed on ANY parent is a RED
 * commit that already happened.
 *
 * Rebase / cherry-pick continuations need no special case (probed on git 2.55):
 * `git rebase --continue` runs no pre-commit hook, and a manual `git commit` or
 * `git cherry-pick --continue` mid-sequence stages only the picked commit's own
 * delta against HEAD — the plain-commit rule, unchanged. The last case pins it.
 */
describe('tdd-order --staged during a merge (#565)', () => {
  const repos: string[] = []
  afterAll(() => {
    for (const dir of repos) rmSync(dir, { recursive: true, force: true })
  })

  const git = (cwd: string, ...args: string[]) => {
    const res = spawnSync('git', args, { cwd, encoding: 'utf8' })
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`)
    return res.stdout
  }
  /** Exit code only — a conflicting merge exits non-zero by design. */
  const gitTry = (cwd: string, ...args: string[]) =>
    spawnSync('git', args, { cwd, encoding: 'utf8' }).status

  const put = (root: string, rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }

  const MODULE = 'src/lib/leads/intake.ts'
  const TEST = 'tests/unit/leads-intake.spec.ts'
  const testBody = "import { intake } from '@/lib/leads/intake'\nit('reds', () => intake())\n"
  const EXTRA = 'src/lib/leads/extra.ts'
  const EXTRA_TEST = 'tests/unit/leads-extra.spec.ts'

  /**
   * `main` lands a module the honest way (test commit, then module commit) and
   * edits `shared.md`; `feature` edits `shared.md` too and touches no module, so
   * merging `main` conflicts — the case where git runs the pre-commit hook.
   * Returns the repo with `feature` checked out and `main` not yet merged.
   */
  const diverged = (opts: { mainMixed?: boolean; extraRedOnMain?: boolean } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'tdd-order-merge-'))
    repos.push(root)
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'guard@test.local')
    git(root, 'config', 'user.name', 'guard test')
    git(root, 'config', 'core.autocrlf', 'false')
    put(root, 'shared.md', 'base\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'base')
    git(root, 'branch', '-M', 'main')
    git(root, 'checkout', '-qb', 'feature')
    put(root, 'shared.md', 'feature\n')
    put(root, 'docs/feature.md', 'prose\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'docs: feature')
    git(root, 'checkout', '-q', 'main')
    put(root, TEST, testBody)
    if (opts.extraRedOnMain) put(root, EXTRA_TEST, "import { extra } from '@/lib/leads/extra'\n")
    if (!opts.mainMixed) {
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'test(leads): RED')
    }
    put(root, MODULE, 'export const intake = () => true\n')
    put(root, 'shared.md', 'main\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'feat(leads): intake')
    git(root, 'checkout', '-q', 'feature')
    return root
  }

  const staged = (root: string) => runGuard('tdd-order-lint.mjs', root, { extraArgs: ['--staged'] })
  // Every plane exits 0 since #621, so the NOTE is what tells the cases apart.
  const expectMixed = (res: { code: number | null; stdout: string }) => {
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('mixed commit')
  }
  const expectClean = (res: { code: number | null; stdout: string }) => {
    expect(res.code).toBe(0)
    expect(res.stdout).not.toContain('mixed commit')
  }

  it('exits 0 concluding a CONFLICTED merge of main that brings a module and its test', () => {
    const root = diverged()
    expect(gitTry(root, 'merge', '--no-edit', 'main')).not.toBe(0)
    put(root, 'shared.md', 'resolved\n')
    git(root, 'add', 'shared.md')
    const res = staged(root)
    expect(res.stderr).toBe('')
    expectClean(res)
  })

  it('exits 0 even when main itself landed its module and test in one commit', () => {
    // Whatever main did was judged on main's own PR; this merge did not author it.
    const root = diverged({ mainMixed: true })
    expect(gitTry(root, 'merge', '--no-edit', 'main')).not.toBe(0)
    put(root, 'shared.md', 'resolved\n')
    git(root, 'add', 'shared.md')
    expectClean(staged(root))
  })

  it('still notes a resolution that itself introduces a new module together with its test', () => {
    const root = diverged()
    gitTry(root, 'merge', '--no-edit', 'main')
    put(root, 'shared.md', 'resolved\n')
    put(root, 'src/lib/evil/merge.ts', 'export const evil = () => true\n')
    put(root, 'tests/unit/evil-merge.spec.ts', "import { evil } from '@/lib/evil/merge'\n")
    git(root, 'add', '.')
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('mixed commit')
    expect(res.stdout).toContain('src/lib/evil/merge.ts')
    // main's module arrived unchanged from the other parent — not this commit's authorship.
    expect(res.stdout).not.toContain(MODULE)
    expect(res.stdout).toContain('merge')
    expect(res.stdout).toContain('not required')
  })

  it('exits 0 when the resolution adds a module whose RED test was committed on the merged parent', () => {
    const root = diverged({ extraRedOnMain: true })
    gitTry(root, 'merge', '--no-edit', 'main')
    put(root, 'shared.md', 'resolved\n')
    put(root, EXTRA, 'export const extra = 1\n')
    git(root, 'add', '.')
    expectClean(staged(root))
  })

  it('without MERGE_HEAD, the same files staged by hand are still a MIXED commit', () => {
    const root = diverged()
    put(root, MODULE, 'export const intake = () => true\n')
    put(root, TEST, testBody)
    git(root, 'add', '.')
    expectMixed(staged(root))
  })

  it('a cherry-pick continuation of an honest module commit exits 0 — the plain rule applies', () => {
    const root = diverged()
    git(root, 'cherry-pick', 'main~1') // the RED test commit — applies cleanly
    expect(gitTry(root, 'cherry-pick', 'main')).not.toBe(0) // module + shared.md conflict
    put(root, 'shared.md', 'resolved\n')
    git(root, 'add', 'shared.md')
    expectClean(staged(root))
  })

  // ── `git merge --squash` (#569) ──────────────────────────────────────────────
  // A squash writes no MERGE_HEAD, only SQUASH_MSG listing the squashed commits,
  // so before #569 the index was read against HEAD alone and main's module+test
  // looked like this commit's MIXED authorship.

  it('exits 0 concluding a squash merge of main that brings a module and its test (#569)', () => {
    const root = diverged()
    expect(gitTry(root, 'merge', '--squash', 'main')).not.toBe(0)
    put(root, 'shared.md', 'resolved\n')
    git(root, 'add', 'shared.md')
    const res = staged(root)
    expect(res.stderr).toBe('')
    expectClean(res)
    expect(res.stdout).toContain('squash')
  })

  it('exits 0 for a squash merge when main itself landed module and test in one commit (#569)', () => {
    const root = diverged({ mainMixed: true })
    expect(gitTry(root, 'merge', '--squash', 'main')).not.toBe(0)
    put(root, 'shared.md', 'resolved\n')
    git(root, 'add', 'shared.md')
    expectClean(staged(root))
  })

  it('exits 0 for a squash merge concluded from a LINKED worktree, whose .git is a file (#569)', () => {
    const root = diverged()
    const wt = mkdtempSync(join(tmpdir(), 'tdd-order-squash-wt-'))
    repos.push(wt)
    git(root, 'checkout', '-q', '--detach')
    git(root, 'worktree', 'add', '-q', wt, 'feature')
    expect(gitTry(wt, 'merge', '--squash', 'main')).not.toBe(0)
    put(wt, 'shared.md', 'resolved\n')
    git(wt, 'add', 'shared.md')
    expectClean(staged(wt))
  })

  it('still notes a squash resolution that itself introduces a module with its test (#569)', () => {
    const root = diverged()
    gitTry(root, 'merge', '--squash', 'main')
    put(root, 'shared.md', 'resolved\n')
    put(root, 'src/lib/evil/merge.ts', 'export const evil = () => true\n')
    put(root, 'tests/unit/evil-merge.spec.ts', "import { evil } from '@/lib/evil/merge'\n")
    git(root, 'add', '.')
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('mixed commit')
    expect(res.stdout).toContain('src/lib/evil/merge.ts')
    expect(res.stdout).not.toContain(MODULE)
    expect(res.stdout).toContain('squash')
    expect(res.stdout).toContain('not required')
  })

  it('a SQUASH_MSG naming no readable commit leaves the plain rule in force (#569)', () => {
    const root = diverged()
    const rel = git(root, 'rev-parse', '--git-path', 'SQUASH_MSG').trim()
    writeFileSync(
      join(root, rel),
      `Squashed commit of the following:\n\ncommit ${'0'.repeat(40)}\n`,
    )
    put(root, MODULE, 'export const intake = () => true\n')
    put(root, TEST, testBody)
    git(root, 'add', '.')
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('mixed commit')
    expect(res.stdout).toContain(MODULE)
  })

  it('a `rebase -i` squash-step conflict is NOT a squash merge, even if a message cites a sha (#569)', () => {
    // `rebase -i` also writes SQUASH_MSG on a squash-step conflict, but with the
    // commit messages UNINDENTED — so a message line `commit <sha of main>` must not
    // make main's module+test (copied in by hand) read as the squashed side.
    const root = diverged()
    const mainSha = git(root, 'rev-parse', 'main').trim()
    git(root, 'branch', 'other', 'main~2')
    git(root, 'checkout', '-q', 'other')
    put(root, 'shared.md', 'other\n')
    git(root, 'commit', '-qam', 'other')
    git(root, 'checkout', '-q', 'feature')
    put(root, 'docs/second.md', 'prose\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', `docs: second\n\ncommit ${mainSha}`)
    // Reorder so the clean commit is picked first and the conflicting one squashed onto it.
    const todo = [
      `pick ${git(root, 'rev-parse', 'HEAD').trim()} second`,
      `squash ${git(root, 'rev-parse', 'HEAD~1').trim()} feature`,
      '',
    ].join('\n')
    const todoFile = join(root, '..', `${root.split(/[\\/]/).pop()}-todo`)
    repos.push(todoFile)
    writeFileSync(todoFile, todo)
    const editor = `node -e "require('fs').copyFileSync(process.argv[1], process.argv[2])" ${JSON.stringify(todoFile.replace(/\\/g, '/'))}`
    const rebase = spawnSync('git', ['rebase', '-i', '--onto', 'other', 'main~2'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_SEQUENCE_EDITOR: editor, GIT_EDITOR: 'true' },
    })
    expect(rebase.status).not.toBe(0) // the squash step conflicts on shared.md
    const rel = git(root, 'rev-parse', '--git-path', 'SQUASH_MSG').trim()
    expect(readFileSync(join(root, rel), 'utf8')).toContain(`\ncommit ${mainSha}`)
    put(root, 'shared.md', 'resolved\n')
    git(root, 'checkout', 'main', '--', 'src', 'tests')
    git(root, 'add', '.')
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('mixed commit')
    expect(res.stdout).toContain(MODULE)
    expect(res.stdout).not.toContain('squash merge in progress')
  })
})
