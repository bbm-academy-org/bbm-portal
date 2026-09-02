import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * `tools/gh/set-board-status.mjs` as a CHILD PROCESS (#440, review of PR #450).
 *
 * `tests/unit/gh-board-tools.spec.ts` injects `io.exit` in every case, so the
 * script's DEFAULT termination path is unobserved there — and that default is
 * exactly what changed: `process.exit(code)` became `process.exitCode = code`
 * plus a return, because on a Windows pipe the preceding stdout write is
 * asynchronous and exiting immediately truncates it (#132 class: mutation
 * succeeded, the DONE line was cut, `pr:land` read completed work as failure).
 *
 * `pr-land.mjs` reads this script's CHILD STATUS (`runBoardDone` →
 * `spawnSync` → `res.status`), so the contract has two halves and both are
 * asserted here from the outside:
 *
 *   1. the exit CODES are unchanged (0 on `--help`, 1 on a parse failure), and
 *      the USAGE text reaches the pipe COMPLETE — the truncation symptom;
 *   2. the default seam RETURNS instead of terminating, so a caller keeps
 *      running (and its output keeps flushing) after `die()`.
 *
 * Hermetic: no network, no live board. Case 3 injects the resolver.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = resolve(REPO_ROOT, 'tools/gh/set-board-status.mjs')
const SCRIPT_URL = pathToFileURL(SCRIPT).href

/** The last line of USAGE — present only if the whole text made it out. */
const USAGE_TAIL = 'Exit codes: 0 — status set (or resolved); 1 — error.'
const USAGE_HEAD = 'Usage: pnpm board:status'

const runScript = (args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  })

describe('board:status as a child process', () => {
  it('--help prints the COMPLETE usage on stdout and exits 0', () => {
    const res = runScript(['--help'])

    expect(res.status).toBe(0)
    expect(res.stdout).toContain(USAGE_HEAD)
    // The tail is the assertion that matters: a truncated write loses the end,
    // not the beginning.
    expect(res.stdout).toContain(USAGE_TAIL)
    expect(res.stderr).toBe('')
  })

  it('a bad status exits 1 with the error line and the COMPLETE usage on stderr', () => {
    const res = runScript(['42', 'Bogus'])

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('[board:status] invalid status «Bogus»')
    expect(res.stderr).toContain(USAGE_HEAD)
    expect(res.stderr).toContain(USAGE_TAIL)
    expect(res.stdout).toBe('')
  })

  it('the DEFAULT io.exit seam sets the code and RETURNS — the caller keeps running', () => {
    // Driver: import the module (the `main()` guard does not fire under `-e`),
    // call `runBoardStatus` with a failing INJECTED resolver and NO `io.exit`,
    // then print a sentinel. Under `process.exit(1)` the child dies inside
    // `die()` and the sentinel never appears; under `process.exitCode = 1` the
    // function returns, the sentinel prints, and the child still ends with 1.
    const driver = `
      const { runBoardStatus } = await import(${JSON.stringify(SCRIPT_URL)})
      runBoardStatus(
        { issueNumber: 42, resolveOnly: false, status: 'Done' },
        {
          resolve: () => ({ ok: false, error: 'injected resolver failure' }),
          mutate: () => { throw new Error('must not mutate') },
          out: () => {},
          err: () => {},
        },
      )
      process.stdout.write('SEAM-RETURNED\\n')
    `

    const res = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
    })

    expect(res.stdout).toContain('SEAM-RETURNED')
    expect(res.status).toBe(1)
  })
})
