import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { canonicalPath, shellMutationPaths } from '../../tools/hooks/shared.mjs'
import {
  classifyWritePath,
  commandReachPaths,
  decideEscapeBlock,
  escapeBlockMessage,
  gitWorktreeRoots,
  isolationContext,
  owningRoot,
  unparseableShellMessage,
  wrongWorktreeMessage,
} from '../../tools/hooks/worktree-path-guard.mjs'

/**
 * worktree-path-guard v2 (#594) — port of the ds-platform guard: git-registered
 * roots, junction canonicalisation, a `wrong-worktree` verdict distinct from the
 * main-tree escape, and a refusal of an unparseable shell write that reaches a
 * protected checkout. The guard is live for every session on the box, so the
 * cases that must NEVER block — the session's own worktree, a main-checkout
 * session, a guard that cannot reach git — are pinned here as hard as the
 * blocks are.
 */

const MAIN = 'C:/repo'
const A = `${MAIN}/.claude/worktrees/77`
const B = `${MAIN}/.claude/worktrees/88`
const ROOTS = [MAIN, A, B]

const ctxFor = (over: Record<string, unknown> = {}) =>
  isolationContext({ cwd: A, roots: ROOTS, sessionRoot: A, ...over })

describe('classifyWritePath — verdict per target', () => {
  it('own worktree → ok', () => {
    expect(classifyWritePath(`${A}/src/x.ts`, ctxFor()).verdict).toBe('ok')
  })

  it('outside the repo (scratchpad, temp) → ok', () => {
    expect(classifyWritePath('C:/Users/x/AppData/Local/Temp/s.md', ctxFor()).verdict).toBe('ok')
  })

  it('shared main tree from a worktree-pinned session → main-tree-escape', () => {
    expect(classifyWritePath(`${MAIN}/src/x.ts`, ctxFor()).verdict).toBe('main-tree-escape')
    expect(classifyWritePath(`${MAIN}/.claude/rules/dev-env.md`, ctxFor()).verdict).toBe(
      'main-tree-escape',
    )
  })

  it('ANOTHER registered worktree from a pinned session → wrong-worktree, naming it', () => {
    const v = classifyWritePath(`${B}/src/x.ts`, ctxFor())
    expect(v.verdict).toBe('wrong-worktree')
    expect(v.targetRoot).toBe(B)
  })

  it('an UNREGISTERED worktree-shaped path → ok (nobody`s checkout; deviation from ds)', () => {
    expect(classifyWritePath(`${MAIN}/.claude/worktrees/99/x.ts`, ctxFor()).verdict).toBe('ok')
  })

  it('a main-tree session may write the main tree and ANY registered worktree (ds #2373)', () => {
    const ctx = isolationContext({ cwd: MAIN, roots: ROOTS, sessionRoot: MAIN })
    expect(ctx.pinned).toBe(false)
    expect(classifyWritePath(`${MAIN}/src/x.ts`, ctx).verdict).toBe('ok')
    expect(classifyWritePath(`${B}/src/x.ts`, ctx).verdict).toBe('ok')
  })

  it('#187 kept: a lead launched in the main tree whose cwd drifted into A may write B', () => {
    const ctx = ctxFor({ launchRoot: MAIN })
    expect(ctx.leadFromMain).toBe(true)
    expect(classifyWritePath(`${B}/DEBT.md`, ctx).verdict).toBe('ok')
    // …but the escape into the shared checkout stays blocked, exactly as before.
    expect(classifyWritePath(`${MAIN}/DEBT.md`, ctx).verdict).toBe('main-tree-escape')
  })

  it('a SUBAGENT inheriting the lead`s main launch root is still pinned (ds #1453)', () => {
    const ctx = ctxFor({ launchRoot: MAIN, agentId: 'agent-1' })
    expect(ctx.leadFromMain).toBe(false)
    expect(classifyWritePath(`${B}/src/x.ts`, ctx).verdict).toBe('wrong-worktree')
  })

  it('a session whose own worktree is gone is not refused other worktrees (incident 1)', () => {
    const gone = `${MAIN}/.claude/worktrees/172`
    const ctx = isolationContext({ cwd: gone, roots: ROOTS, sessionRoot: '' })
    expect(ctx.sessionRegistered).toBe(false)
    expect(classifyWritePath(`${A}/src/x.ts`, ctx).verdict).toBe('ok')
    expect(classifyWritePath(`${MAIN}/src/x.ts`, ctx).verdict).toBe('main-tree-escape')
  })

  it('git unavailable (no roots): falls back to the path shape, as v1 did', () => {
    const ctx = isolationContext({ cwd: A, roots: [], sessionRoot: '' })
    expect(ctx.mainRoot).toBe(MAIN)
    expect(classifyWritePath(`${MAIN}/src/x.ts`, ctx).verdict).toBe('main-tree-escape')
    expect(classifyWritePath(`${B}/src/x.ts`, ctx).verdict).toBe('ok')
    expect(classifyWritePath(`${A}/src/x.ts`, ctx).verdict).toBe('ok')
  })

  it('a cwd outside any checkout places no session and blocks nothing', () => {
    const ctx = isolationContext({ cwd: 'C:/tmp/elsewhere', roots: [], sessionRoot: '' })
    expect(ctx.pinned).toBe(false)
    expect(classifyWritePath(`${MAIN}/src/x.ts`, ctx).verdict).toBe('ok')
  })
})

describe('owningRoot / gitWorktreeRoots', () => {
  it('picks the LONGEST containing root (a worktree wins over the main tree)', () => {
    expect(owningRoot(`${A}/x`, ROOTS)).toBe(A)
    expect(owningRoot(`${MAIN}/x`, ROOTS)).toBe(MAIN)
    expect(owningRoot('C:/other/x', ROOTS)).toBe('')
  })

  it('parses `git worktree list --porcelain`', () => {
    const out = [
      'worktree C:/repo',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree C:/repo/.claude/worktrees/77',
      'HEAD def',
      '',
    ].join('\n')
    expect(gitWorktreeRoots('C:/repo', () => out)).toEqual(['C:/repo', A])
  })

  it('fails open to [] when git cannot run', () => {
    expect(
      gitWorktreeRoots('C:/repo', () => {
        throw new Error('no git')
      }),
    ).toEqual([])
  })
})

describe('decideEscapeBlock — editor writes', () => {
  const base = { roots: ROOTS, sessionRoot: A, cwd: A }

  it('own worktree passes', () => {
    expect(
      decideEscapeBlock({ ...base, toolName: 'Edit', toolInput: { file_path: `${A}/src/a.ts` } }),
    ).toEqual({ block: false, inWorktreeSession: true })
  })

  it('a foreign registered worktree is refused with the wrong-worktree verdict', () => {
    const d = decideEscapeBlock({
      ...base,
      toolName: 'Write',
      toolInput: { file_path: `${B}/src/a.ts` },
    })
    expect(d.block).toBe(true)
    expect(d.verdict).toBe('wrong-worktree')
    expect(d.targetRoot).toBe(B)
  })

  it('the shared checkout is refused with the main-tree verdict', () => {
    const d = decideEscapeBlock({
      ...base,
      toolName: 'Write',
      toolInput: { file_path: `${MAIN}/src/a.ts` },
    })
    expect(d.block).toBe(true)
    expect(d.verdict).toBe('main-tree-escape')
    expect(d.worktreeName).toBe('77')
  })

  it('a main-tree session is never blocked', () => {
    for (const file_path of [`${MAIN}/src/a.ts`, `${B}/src/a.ts`, `${A}/x.ts`]) {
      expect(
        decideEscapeBlock({
          toolName: 'Write',
          toolInput: { file_path },
          cwd: MAIN,
          roots: ROOTS,
          sessionRoot: MAIN,
        }).block,
      ).toBe(false)
    }
  })
})

describe('messages — the two verdicts read differently', () => {
  it('wrong-worktree names EnterWorktree for the target and is not a main-tree escape', () => {
    const m = wrongWorktreeMessage(`${B}/src/a.ts`, B, A)
    expect(m).toContain('wrong-worktree')
    expect(m).toContain('EnterWorktree path:.claude/worktrees/88')
    expect(m).toContain('NOT a main-tree escape')
    expect(m).not.toBe(escapeBlockMessage(`${B}/src/a.ts`, MAIN, '77'))
  })

  it('the main-tree message keeps its #91 wording', () => {
    expect(escapeBlockMessage(`${MAIN}/a.ts`, MAIN, '77')).toContain('BLOCKED (#91)')
  })

  it('the unparseable-shell message names the reason and the reached path', () => {
    const m = unparseableShellMessage('dynamic write', `${MAIN}/src`, A)
    expect(m).toContain('unparseable-shell')
    expect(m).toContain('dynamic write')
    expect(m).toContain(`${MAIN}/src`)
  })
})

describe('shellMutationPaths — bounded literal shell-writer parser (ds port)', () => {
  const cwd = 'C:/repo/.claude/worktrees/77'

  it('read-only commands carry no targets', () => {
    expect(shellMutationPaths({ command: 'git status' }, cwd)).toEqual([])
    expect(shellMutationPaths({ command: 'Get-Content ./a.txt' }, cwd)).toEqual([])
    expect(shellMutationPaths({ command: 'pnpm test:unit' }, cwd)).toEqual([])
  })

  it('a git -C checkpoint command is not a write, even with a writer word in its message', () => {
    expect(
      shellMutationPaths({ command: `git -C ${cwd} commit -m "drop the rm helper"` }, cwd),
    ).toEqual([])
  })

  it('literal single writers resolve to absolute targets', () => {
    expect(shellMutationPaths({ command: 'touch a.txt' }, cwd)).toEqual([
      'C:\\repo\\.claude\\worktrees\\77\\a.txt',
    ])
    expect(
      shellMutationPaths({ command: "Set-Content -Path 'C:/repo/x.txt' -Value y" }, cwd),
    ).toEqual(['C:\\repo\\x.txt'])
  })

  it('chained, redirected, moved or git-checkout writes are unparseable (throw)', () => {
    for (const command of [
      'echo x > a.txt',
      'touch a; touch b',
      'mv a b',
      "Remove-Item 'C:/repo/src'",
      'git checkout feat/x',
      'git -C C:/repo reset --hard',
    ]) {
      expect(() => shellMutationPaths({ command }, cwd), command).toThrow()
    }
  })
})

describe('decideEscapeBlock — shell writes', () => {
  const base = { roots: ROOTS, sessionRoot: A, cwd: A }
  const sh = (command: string, over: Record<string, unknown> = {}) =>
    decideEscapeBlock({ ...base, toolName: 'Bash', toolInput: { command }, ...over })

  it('an unparseable write that reaches the shared checkout is refused', () => {
    const d = sh(`Remove-Item -Recurse 'C:/repo/src/app'`)
    expect(d.block).toBe(true)
    expect(d.verdict).toBe('unparseable-shell')
  })

  it('an unparseable write that reaches ANOTHER worktree is refused', () => {
    expect(sh(`echo x > ${B}/a.txt`).verdict).toBe('unparseable-shell')
  })

  it('relative traversal out of the worktree counts as reach', () => {
    expect(sh('echo x > ../../../src/a.txt').block).toBe(true)
    expect(sh('git -C ../../.. checkout feat/x').block).toBe(true)
  })

  it('an inherited project-dir variable counts as reaching the main tree', () => {
    expect(sh('echo x > "$CLAUDE_PROJECT_DIR/src/a.txt"').block).toBe(true)
  })

  it('an unparseable write confined to the own worktree or outside the repo passes', () => {
    expect(sh(`Remove-Item -Recurse '${A}/tmp'`).block).toBe(false)
    expect(sh('pnpm test:unit 2>/dev/null').block).toBe(false)
    expect(sh('git checkout -- src/a.ts').block).toBe(false)
    expect(sh('echo x > C:/Users/x/AppData/Local/Temp/out.txt').block).toBe(false)
  })

  it('a literal writer is classified by its target, not refused', () => {
    expect(sh(`touch ${A}/a.txt`).block).toBe(false)
    expect(sh(`touch ${B}/a.txt`).verdict).toBe('wrong-worktree')
    expect(sh(`touch ${MAIN}/a.txt`).verdict).toBe('main-tree-escape')
  })

  it('a main-tree session is never refused an unparseable write', () => {
    expect(
      sh(`Remove-Item -Recurse 'C:/repo/src/app'`, { cwd: MAIN, sessionRoot: MAIN }).block,
    ).toBe(false)
  })

  it('read-only shell calls stay silent', () => {
    expect(sh('git status')).toEqual({ block: false })
  })
})

describe('commandReachPaths', () => {
  it('collects absolute and traversal paths, resolved against cwd', () => {
    const reach = commandReachPaths(`cp ${B}/a ../../../x "C:\\repo\\y"`, A, MAIN).map(
      (p: string) => p.replace(/\\/g, '/').toLowerCase(),
    )
    expect(reach).toContain(`${B}/a`.toLowerCase())
    expect(reach).toContain('c:/repo/x')
    expect(reach).toContain('c:/repo/y')
  })

  it('a project-dir variable reaches the main root', () => {
    const reach = commandReachPaths('rm "$env:CLAUDE_PROJECT_DIR/x"', A, MAIN)
    expect(reach.map((p: string) => p.toLowerCase())).toContain(MAIN.toLowerCase())
  })
})

describe('canonicalPath — junction escape', () => {
  let root = ''
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'bbm-wt-canon-')))
    mkdirSync(join(root, 'real'), { recursive: true })
    mkdirSync(join(root, 'wt'), { recursive: true })
    symlinkSync(join(root, 'real'), join(root, 'wt', 'escape'), 'junction')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('resolves an existing junction ancestor of a NEW file', () => {
    expect(canonicalPath(join(root, 'wt', 'escape', 'new', 'file.ts'))).toBe(
      join(root, 'real', 'new', 'file.ts'),
    )
  })

  it('leaves a plain path unchanged', () => {
    expect(canonicalPath(join(root, 'wt', 'x.ts'))).toBe(join(root, 'wt', 'x.ts'))
  })
})

/**
 * End-to-end: a real repo with two real `git worktree add` checkouts, the real
 * hook process. The CRITICAL half is the "must pass" cases — this guard runs for
 * every session on the box once merged.
 */
describe('worktree-path-guard as a process (real git worktrees)', { timeout: 60_000 }, () => {
  const HOOK = resolve(import.meta.dirname, '..', '..', 'tools', 'hooks', 'worktree-path-guard.mjs')
  let main = ''
  let a = ''
  let b = ''

  beforeAll(() => {
    main = realpathSync(mkdtempSync(join(tmpdir(), 'bbm-wt-guard-')))
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], {
        cwd: main,
        stdio: 'pipe',
      })
    git('init', '-q', '-b', 'main')
    writeFileSync(join(main, 'README.md'), 'x\n')
    git('add', 'README.md')
    git('commit', '-q', '-m', 'init')
    a = join(main, '.claude', 'worktrees', '77')
    b = join(main, '.claude', 'worktrees', '88')
    mkdirSync(join(main, '.claude', 'worktrees'), { recursive: true })
    git('worktree', 'add', '-q', '-b', 'wt-77', a)
    git('worktree', 'add', '-q', '-b', 'wt-88', b)
    symlinkSync(main, join(a, 'escape'), 'junction')
  })
  afterAll(() => rmSync(main, { recursive: true, force: true }))

  const run = (
    cwd: string,
    tool_input: Record<string, unknown>,
    { tool_name = 'Write', projectDir = cwd, agent_id = '' } = {},
  ) =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({
        session_id: 'wt-guard-e2e',
        cwd,
        tool_name,
        tool_input,
        ...(agent_id ? { agent_id } : {}),
      }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, BBM_HOOKS_DISABLE: '' },
    })

  it('MUST PASS: a worktree session writes its own worktree', () => {
    const r = run(a, { file_path: join(a, 'src', 'x.ts'), content: 'x' })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })

  it('MUST PASS: a main-checkout session writes the main checkout and a registered worktree', () => {
    expect(run(main, { file_path: join(main, 'src', 'x.ts') }).status).toBe(0)
    expect(run(main, { file_path: join(b, 'src', 'x.ts') }).status).toBe(0)
  })

  it('MUST PASS: a main-launched lead whose cwd drifted into A writes B (#187)', () => {
    expect(run(a, { file_path: join(b, 'x.ts') }, { projectDir: main }).status).toBe(0)
  })

  it('MUST PASS: a non-repo cwd and a garbage payload exit 0 (fail-open)', () => {
    expect(run(tmpdir(), { file_path: join(main, 'src', 'x.ts') }).status).toBe(0)
    const garbage = spawnSync(process.execPath, [HOOK], { input: '{ nope', encoding: 'utf8' })
    expect(garbage.status).toBe(0)
  })

  it('a worktree-pinned session writing ANOTHER registered worktree → wrong-worktree', () => {
    const r = run(a, { file_path: join(b, 'src', 'x.ts') })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('wrong-worktree')
  })

  it('a subagent with the lead`s main launch root is still pinned to its cwd worktree', () => {
    const r = run(a, { file_path: join(b, 'x.ts') }, { projectDir: main, agent_id: 'ag-1' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('wrong-worktree')
  })

  it('a worktree session writing the shared checkout → the main-tree verdict, not wrong-worktree', () => {
    const r = run(a, { file_path: join(main, 'src', 'x.ts') })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('BLOCKED (#91)')
    expect(r.stderr).not.toContain('wrong-worktree')
  })

  it('a junction escape from the worktree into the shared checkout is caught', () => {
    const r = run(a, { file_path: join(a, 'escape', 'src', 'new.ts') })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('BLOCKED (#91)')
  })

  it('Codex shell: unparseable write into the main tree refused, own-worktree one passes', () => {
    const blocked = run(
      a,
      { command: `Remove-Item -Recurse '${join(main, 'README.md')}'` },
      { tool_name: 'exec_command' },
    )
    expect(blocked.status).toBe(2)
    expect(blocked.stderr).toContain('unparseable-shell')
    expect(
      run(a, { command: `Remove-Item -Recurse '${join(a, 'tmp')}'` }, { tool_name: 'exec_command' })
        .status,
    ).toBe(0)
  })
})
