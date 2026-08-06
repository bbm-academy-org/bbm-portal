import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ALLOWED_OUTPUT_DIRS,
  SERVER_OUTPUT_DIR,
  decideScreenshotPath,
  guardedRoots,
  isScreenshotTool,
  resolveTarget,
} from '../../tools/hooks/screenshot-path-guard.mjs'

/**
 * Screenshot path guard (#134). Playwright MCP resolves a caller-supplied
 * `filename` against its own cwd — the repo root — so a bare name lands as
 * untracked clutter in a tree SHARED with other live sessions. Ported from
 * ds-platform as WARN (severity of record: docs/ci-guardrails.md §6); the
 * detection logic is the blocking
 * one, so these tests pin BOTH the detection and the WARN emission.
 */

const HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/hooks')
const SHOT = 'mcp__plugin_playwright_playwright__browser_take_screenshot'
const MAIN = 'C:/Users/sidor/repos/bbm-portal'
const WT = `${MAIN}/.claude/worktrees/134`

function decide(filename: unknown, cwd: string = WT, toolName: string = SHOT) {
  return decideScreenshotPath({ toolName, toolInput: { filename }, cwd })
}

describe('isScreenshotTool', () => {
  it('matches the file-writing browser tools under ANY MCP server id', () => {
    expect(isScreenshotTool(SHOT)).toBe(true)
    expect(isScreenshotTool('mcp__playwright__browser_take_screenshot')).toBe(true)
    expect(isScreenshotTool('mcp__playwright__browser_pdf_save')).toBe(true)
  })

  it('ignores read-only browser tools and non-MCP tools', () => {
    expect(isScreenshotTool('mcp__playwright__browser_snapshot')).toBe(false)
    expect(isScreenshotTool('Write')).toBe(false)
    expect(isScreenshotTool(undefined)).toBe(false)
  })
})

describe('resolveTarget: platform-independent', () => {
  it('walks segments itself, so a Windows payload resolves the same on Linux CI', () => {
    expect(resolveTarget(WT, 'shot.png')).toBe(`${WT}/shot.png`)
    expect(resolveTarget(WT, './a/../b.png')).toBe(`${WT}/b.png`)
    expect(resolveTarget(WT, '../../../shot.png')).toBe(`${MAIN}/shot.png`)
    expect(resolveTarget(WT, 'C:/tmp/shot.png')).toBe('C:/tmp/shot.png')
  })
})

describe('guardedRoots', () => {
  it('adds the worktree root and the SHARED main checkout above it', () => {
    expect(guardedRoots(WT)).toEqual([WT, MAIN])
    expect(guardedRoots(`${WT}/src`)).toEqual([`${WT}/src`, WT, MAIN])
  })

  it('a plain checkout guards only itself', () => {
    expect(guardedRoots(MAIN)).toEqual([MAIN])
  })
})

describe('decideScreenshotPath', () => {
  it('warns on a bare filename — it lands in the working tree root', () => {
    const d = decide('shot.png')
    expect(d.warn).toBe(true)
    expect(d.resolved).toBe(`${WT}/shot.png`)
  })

  it('warns on an escape out of the worktree into the shared main checkout', () => {
    expect(decide('../../../shot.png').warn).toBe(true)
    expect(decide('../../../shot.png').resolved).toBe(`${MAIN}/shot.png`)
  })

  it('stays silent on every git-ignored artifact dir of this repo', () => {
    for (const dir of ALLOWED_OUTPUT_DIRS) {
      expect(decide(`${dir}/134-login.png`).warn).toBe(false)
    }
    expect(decide(`${WT}/${SERVER_OUTPUT_DIR}/abs.png`).warn).toBe(false)
    // Below the worktree root, `..` back into the worktree's own output dir.
    expect(decide(`../${SERVER_OUTPUT_DIR}/x.png`, `${WT}/src`).warn).toBe(false)
  })

  it("stays silent outside the repo — the server's own checkFile adjudicates that", () => {
    expect(decide('C:/Users/sidor/AppData/Local/Temp/claude/scratchpad/shot.png').warn).toBe(false)
  })

  it('stays silent on an omitted filename, another tool and a malformed input', () => {
    expect(decide(undefined).warn).toBe(false)
    expect(decide('').warn).toBe(false)
    expect(decide(42).warn).toBe(false)
    expect(decide('shot.png', WT, 'Write').warn).toBe(false)
    expect(decideScreenshotPath({ toolName: SHOT, toolInput: null, cwd: WT }).warn).toBe(false)
  })

  it('without cwd falls back to the shape rule: relative and outside an output dir', () => {
    expect(decide('shot.png', '').warn).toBe(true)
    expect(decide(`${SERVER_OUTPUT_DIR}/shot.png`, '').warn).toBe(false)
    expect(decide('test-results/shot.png', '').warn).toBe(false)
    expect(decide('C:/tmp/shot.png', '').warn).toBe(false)
  })
})

function runHook(input: string, extraEnv: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [resolve(HOOKS_DIR, 'screenshot-path-guard.mjs')], {
    input,
    encoding: 'utf8',
    cwd: tmpdir(),
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...extraEnv },
  })
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

const CLUTTER_PAYLOAD = JSON.stringify({
  tool_name: SHOT,
  cwd: WT,
  tool_input: { filename: 'shot.png' },
})

describe('screenshot-path-guard as a process', () => {
  it('WARNs (exit 0 + systemMessage), it does NOT block — canon §6', () => {
    const res = runHook(CLUTTER_PAYLOAD)
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    const out = JSON.parse(res.stdout)
    expect(out.systemMessage).toContain('screenshot path guard')
    expect(out.systemMessage).toContain(SERVER_OUTPUT_DIR)
    // Stack convention (shared.mjs emitWarn): a warning never pre-authorises.
    expect(out.hookSpecificOutput).toBeUndefined()
  })

  it('the BBM_HOOKS_DISABLE kill switch silences it', () => {
    expect(runHook(CLUTTER_PAYLOAD, { BBM_HOOKS_DISABLE: '1' }).stdout).toBe('')
  })

  it('fail-open: garbage stdin exits 0 without output', () => {
    const res = runHook('{ это не JSON')
    expect(res.status).toBe(0)
    expect(res.stdout).toBe('')
  })
})
