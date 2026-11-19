import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { defaultRunner as briefRunner, gatherState } from '../../tools/gh/dispatch-brief.mjs'
import { defaultRunner as probeRunner, gatherEvidence } from '../../tools/gh/dispatch-probe.mjs'

/**
 * #577: the dispatch scripts read paths out of real git output. With git's
 * default `core.quotepath=true`, a non-ASCII path comes back as a quoted octal
 * escape (`"docs/\320\267..."`), so `dispatch:brief` seeded a scope list of
 * escapes and `dispatch:probe` stat-ed files that do not exist. The pure seams
 * live in `dispatch-scripts.spec.ts`, which never shells out; these cases run
 * each script's real default runner against a throwaway repo that pins
 * `quotepath=true` locally, so a machine-wide `false` cannot hide the bug.
 */

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

/** A throwaway repo with one commit, the default `quotepath=true` pinned locally. */
const repo = () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-git-')).replace(/\\/g, '/')
  repos.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'core.quotepath', 'true')
  git(root, 'config', 'user.email', 'guard@test.local')
  git(root, 'config', 'user.name', 'guard test')
  put(root, 'README.md', '# fixture repo\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'base')
  return root
}

describe('dispatch:brief — worktree diff against real git (non-ASCII paths)', () => {
  it('lists the changed paths of the task worktree verbatim', () => {
    const root = repo()
    git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    const wt = `${root}/.claude/worktrees/577`
    git(root, 'worktree', 'add', '-q', wt, '-b', 'fix/577')
    put(wt, 'docs/заметки/план.md', 'план\n')
    put(wt, 'tools/gh/заявка.mjs', 'export {}\n')
    put(wt, 'tools/gh/plain.mjs', 'export {}\n')
    git(wt, 'add', '.')
    git(wt, 'commit', '-qm', 'work')

    const real = briefRunner()
    const state = gatherState({
      issueNumber: 577,
      cwd: root,
      runner: {
        gh: () => ({ status: 1, stdout: '', stderr: 'offline' }),
        // The repo-root lookup reads the process cwd; the temp repo stands in.
        // The worktree diff — the call under test — runs through the real runner.
        git: (args: string[]) =>
          args.includes('diff')
            ? real.git(args)
            : { status: 0, stdout: `${root}/.git\n`, stderr: '' },
      },
    })
    expect(state.repoRoot).toBe(root)
    expect(state.worktreeChanged).toEqual([
      'docs/заметки/план.md',
      'tools/gh/plain.mjs',
      'tools/gh/заявка.mjs',
    ])
  })
})

describe('dispatch:probe — dirty paths against real git (non-ASCII paths)', () => {
  it('stats the dirty files under their real names, rename destination included', () => {
    const root = repo()
    put(root, 'old.md', 'old\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'old')
    put(root, 'заявка.md', 'new\n')
    git(root, 'mv', 'old.md', 'новый.md')

    const statted: string[] = []
    const NOW = 1_800_000_000_000
    const ev = gatherEvidence({
      worktreePath: root,
      runner: probeRunner(),
      statMtime: (p: string) => {
        statted.push(p)
        return NOW - 60_000
      },
      nowMs: NOW,
    })
    expect(ev).toEqual({ commitCount: 0, dirtyCount: 2, ageSeconds: 60 })
    expect(statted.sort()).toEqual([join(root, 'заявка.md'), join(root, 'новый.md')].sort())
  })
})
