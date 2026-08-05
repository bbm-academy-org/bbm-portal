import { describe, expect, it, vi } from 'vitest'

import {
  DEPLOY_STAGES,
  IMAGE_RETENTION,
  buildDeployScript,
  buildRetentionScript,
  buildShipCommand,
  buildVerifyScript,
  caddyNeedsRestart,
  classifyCheckRuns,
  parseRollbackSha,
  preflightVerdict,
  createStallWatchdog,
  formatStallMessage,
  runDeploy,
  verifyVerdict,
} from '../../tools/deploy/prod.mjs'

/**
 * `pnpm deploy:prod` — the fail-closed pipeline (task 7.6, #137).
 *
 * The contract these tests pin down is not "the steps work" (that needs the
 * real box, and a real deploy is the owner's acceptance step) but "the script
 * REFUSES in every situation where continuing would leave prod in a state
 * nobody can describe":
 *
 *   • it never ships an uncommitted or un-pushed tree;
 *   • it never ships a sha whose CI is red or still running;
 *   • it never prints a success line the box does not back (the running
 *     container must carry the deployed image tag);
 *   • when a step goes red it stops THERE — no release tag, no Deployment
 *     record, no hand-patching — and points at the rollback.
 *
 * The pipeline is therefore expressed as an ordered list of injected steps, so
 * the abort behaviour itself is unit-testable without touching the VPS.
 */

const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

// ── pre-flight ───────────────────────────────────────────────────────────────

describe('classifyCheckRuns', () => {
  it('keeps only the LATEST run per check name — a green re-run beats an old red', () => {
    const runs = [
      {
        name: 'CI',
        status: 'completed',
        conclusion: 'failure',
        completed_at: '2026-08-05T10:00:00Z',
      },
      {
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-08-05T11:00:00Z',
      },
    ]
    expect(classifyCheckRuns(runs)).toEqual({ total: 1, pending: [], bad: [] })
  })

  it('treats neutral and skipped as good, everything else as bad', () => {
    const runs = [
      { name: 'a', status: 'completed', conclusion: 'neutral' },
      { name: 'b', status: 'completed', conclusion: 'skipped' },
      { name: 'c', status: 'completed', conclusion: 'cancelled' },
      { name: 'd', status: 'completed', conclusion: 'timed_out' },
    ]
    const res = classifyCheckRuns(runs)
    expect(res.bad).toEqual(['c=cancelled', 'd=timed_out'])
  })

  it('reports a still-running check as pending, not as green', () => {
    expect(classifyCheckRuns([{ name: 'CI', status: 'in_progress' }]).pending).toEqual(['CI'])
  })
})

describe('preflightVerdict', () => {
  const green = [{ name: 'CI', status: 'completed', conclusion: 'success' }]

  it('passes a clean tree on origin/main with green CI, and fixes the target sha', () => {
    const v = preflightVerdict({ dirty: '', head: SHA, originMain: SHA, checkRuns: green })
    expect(v.ok).toBe(true)
    expect(v.sha).toBe(SHA)
    expect(v.errors).toEqual([])
  })

  it('REFUSES a dirty tree — prod ships committed main, never local edits', () => {
    const v = preflightVerdict({
      dirty: ' M src/app.ts',
      head: SHA,
      originMain: SHA,
      checkRuns: green,
    })
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/dirty/i)
  })

  it('REFUSES a sha with no CI run at all — absence of red is not green', () => {
    const v = preflightVerdict({ dirty: '', head: SHA, originMain: SHA, checkRuns: [] })
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/no CI check-runs/i)
  })

  it('REFUSES red CI and REFUSES still-running CI', () => {
    expect(
      preflightVerdict({
        dirty: '',
        head: SHA,
        originMain: SHA,
        checkRuns: [{ name: 'CI', status: 'completed', conclusion: 'failure' }],
      }).ok,
    ).toBe(false)
    expect(
      preflightVerdict({
        dirty: '',
        head: SHA,
        originMain: SHA,
        checkRuns: [{ name: 'CI', status: 'queued' }],
      }).ok,
    ).toBe(false)
  })

  it('--skip-ci-check is an escape hatch that WARNS loudly rather than going quiet', () => {
    const v = preflightVerdict({
      dirty: '',
      head: SHA,
      originMain: SHA,
      checkRuns: [],
      skipCi: true,
    })
    expect(v.ok).toBe(true)
    expect(v.warnings.join(' ')).toMatch(/skip-ci-check/i)
  })

  it('a HEAD other than origin/main is a WARNING, and origin/main is what ships', () => {
    // Deliberate: the tool must be runnable from the very branch that
    // introduces it. What ships is always origin/main's sha, never local HEAD —
    // so un-pushed local work can not reach prod, which is what makes the
    // divergence safe to merely warn about.
    const v = preflightVerdict({ dirty: '', head: OTHER, originMain: SHA, checkRuns: green })
    expect(v.ok).toBe(true)
    expect(v.sha).toBe(SHA)
    expect(v.warnings.join(' ')).toMatch(/origin\/main/)
  })
})

// ── remote scripts ───────────────────────────────────────────────────────────

describe('buildShipCommand', () => {
  it('wipes src/ before extracting — tar is additive and never deletes', () => {
    // A file retired in the branch would otherwise linger on the box and break
    // the build (the trap deploy/README.md documented from 2026-07-30).
    const cmd = buildShipCommand()
    expect(cmd).toContain('rm -rf ~/bbm-portal/src')
    expect(cmd).toContain('tar -xz -C ~/bbm-portal')
    expect(cmd.indexOf('rm -rf')).toBeLessThan(cmd.indexOf('tar -xz'))
  })

  it('never touches deploy/ — the host-only env files live there', () => {
    expect(buildShipCommand()).not.toMatch(/rm -rf[^\n]*deploy/)
  })
})

describe('buildDeployScript', () => {
  const script = buildDeployScript(SHA)

  it('records DEPLOY_SHA without clobbering other interpolation vars', () => {
    expect(script).toContain(`DEPLOY_SHA=%s\\n' '${SHA}'`)
    expect(script).toContain("grep -v '^DEPLOY_SHA=' .env")
  })

  it('rebuilds the migrate image too — a stale tooling image is a SILENT no-op', () => {
    expect(script).toMatch(/--profile tools run --build --rm migrate/)
  })

  it('never lets `compose run` eat the rest of the script from stdin', () => {
    expect(script).toContain('</dev/null')
  })

  it('migrates BEFORE the new app starts serving', () => {
    expect(script.indexOf('migrate')).toBeLessThan(script.indexOf('up -d'))
  })

  it('builds app AND migrate, then brings the stack up', () => {
    expect(script).toMatch(/docker compose -f docker-compose\.prod\.yml build app migrate/)
    expect(script).toMatch(/docker compose -f docker-compose\.prod\.yml up -d/)
  })
})

describe('buildVerifyScript / verifyVerdict', () => {
  it('asks the box for the running container’s image tag and state', () => {
    const script = buildVerifyScript(SHA)
    expect(script).toContain('bbm-portal-app-1')
    expect(script).toContain('{{.Config.Image}}')
    expect(script).toContain(`bbm-portal-app:${SHA}`)
  })

  it('accepts only an OK line naming the deployed image', () => {
    expect(verifyVerdict(`OK image=bbm-portal-app:${SHA} state=running`, SHA).ok).toBe(true)
  })

  it('REFUSES a timeout, an absent container, or the previous image', () => {
    expect(verifyVerdict(`TIMEOUT image=bbm-portal-app:${OTHER} state=running`, SHA).ok).toBe(false)
    expect(verifyVerdict('TIMEOUT image=absent state=absent', SHA).ok).toBe(false)
    expect(verifyVerdict('', SHA).ok).toBe(false)
    // A success line the box does not back would be a lie — the whole point.
    expect(verifyVerdict(`OK image=bbm-portal-app:${OTHER} state=running`, SHA).ok).toBe(false)
  })
})

describe('caddyNeedsRestart', () => {
  it('restarts when the running mount differs from the shipped Caddyfile', () => {
    // `up -d caddy` does NOT pick up a bind-mounted config change and
    // `caddy reload` reports "config is unchanged" — the runbook's trap.
    expect(caddyNeedsRestart('caddy=mismatch')).toBe(true)
  })

  it('does not restart when they already match', () => {
    expect(caddyNeedsRestart('caddy=match')).toBe(false)
  })

  it('treats unreadable output as stale — fail-closed, not fail-quiet', () => {
    expect(caddyNeedsRestart('')).toBe(true)
    expect(caddyNeedsRestart('docker: command not found')).toBe(true)
  })
})

describe('buildRetentionScript', () => {
  it('keeps the last N sha tags and never prunes the :local fallback', () => {
    const script = buildRetentionScript()
    expect(script).toContain('bbm-portal-app')
    expect(script).toContain(String(IMAGE_RETENTION))
    expect(script).toMatch(/grep -v/)
    expect(script).toContain('local')
  })

  it('treats "nothing to prune" as success, not as a failed deploy', () => {
    // Under `set -o pipefail` a grep that filters every line exits 1.
    expect(buildRetentionScript()).toContain('|| true')
  })
})

// ── rollback ─────────────────────────────────────────────────────────────────

describe('parseRollbackSha', () => {
  it('accepts a sha and rejects a ref name', () => {
    expect(parseRollbackSha(SHA)).toMatchObject({ ok: true, sha: SHA })
    expect(parseRollbackSha('main').ok).toBe(false)
    expect(parseRollbackSha(undefined).ok).toBe(false)
    expect(parseRollbackSha('').ok).toBe(false)
  })
})

// ── the fail-closed contract ─────────────────────────────────────────────────

describe('runDeploy — stops at the first red step and records nothing', () => {
  function stubs(overrides: Record<string, unknown> = {}) {
    const order: string[] = []
    const make = (name: string) =>
      vi.fn(async () => {
        order.push(name)
      })
    const steps = {
      preflight: vi.fn(async () => {
        order.push('preflight')
        return SHA
      }),
      readPrevSha: vi.fn(async () => {
        order.push('readPrevSha')
        return OTHER
      }),
      ship: make('ship'),
      deployStack: make('deployStack'),
      applyCaddy: make('applyCaddy'),
      verifyRunningSha: make('verifyRunningSha'),
      prune: make('prune'),
      smoke: make('smoke'),
      cutRelease: make('cutRelease'),
      recordDeployment: make('recordDeployment'),
      log: () => {},
      ...overrides,
    }
    return { steps, order }
  }

  it('runs the stages in the documented order on the happy path', async () => {
    const { steps, order } = stubs()
    await runDeploy(steps)
    expect(order).toEqual([
      'preflight',
      'readPrevSha',
      'ship',
      'deployStack',
      'applyCaddy',
      'verifyRunningSha',
      'prune',
      'smoke',
      'cutRelease',
      'recordDeployment',
    ])
  })

  it('DEPLOY_STAGES is that same order — the doc and the code cannot drift', () => {
    const { steps, order } = stubs()
    return runDeploy(steps).then(() => expect(order).toEqual(DEPLOY_STAGES))
  })

  it('a RED smoke aborts: no release tag, no Deployment record', async () => {
    // This is acceptance criterion 2 of #137. Prod is running the new code at
    // this point — "no half-state" means the pipeline does not go on to declare
    // a release nobody validated, and does not hand-patch the box. The operator
    // is left with one decision: roll back, or fix forward.
    const { steps } = stubs({
      smoke: vi.fn(async () => {
        throw new Error('prod smoke RED')
      }),
    })
    await expect(runDeploy(steps)).rejects.toThrow(/smoke/i)
    expect(steps.cutRelease).not.toHaveBeenCalled()
    expect(steps.recordDeployment).not.toHaveBeenCalled()
  })

  it('a failed verify aborts BEFORE the smoke and before any record', async () => {
    const { steps } = stubs({
      verifyRunningSha: vi.fn(async () => {
        throw new Error('running container does not carry the deployed sha')
      }),
    })
    await expect(runDeploy(steps)).rejects.toThrow(/deployed sha/)
    expect(steps.prune).not.toHaveBeenCalled()
    expect(steps.smoke).not.toHaveBeenCalled()
    expect(steps.cutRelease).not.toHaveBeenCalled()
    expect(steps.recordDeployment).not.toHaveBeenCalled()
  })

  it('a failed pre-flight ships NOTHING', async () => {
    const { steps } = stubs({
      preflight: vi.fn(async () => {
        throw new Error('working tree is dirty')
      }),
    })
    await expect(runDeploy(steps)).rejects.toThrow(/dirty/)
    expect(steps.ship).not.toHaveBeenCalled()
    expect(steps.deployStack).not.toHaveBeenCalled()
  })

  it('passes the previously-deployed sha to the record, for the digest range', async () => {
    const { steps } = stubs()
    await runDeploy(steps)
    expect(steps.recordDeployment).toHaveBeenCalledWith(OTHER, SHA)
  })
})

describe('createStallWatchdog / formatStallMessage', () => {
  it('fires once past the budget, and the message routes to a box-reality check', () => {
    // A tripped watchdog proves the LOCAL channel went quiet — not that the
    // remote docker build failed. Telling the operator to verify before
    // re-running or rolling back is the whole point of the wording.
    vi.useFakeTimers()
    try {
      const seen: string[] = []
      const wd = createStallWatchdog({
        label: 'stack deploy',
        budgetMs: 1000,
        host: 'portal-prod-tw',
        onStall: (m: string) => seen.push(m),
      })
      vi.advanceTimersByTime(1500)
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatch(/STALLED: stack deploy/)
      expect(seen[0]).toMatch(/deploy:smoke/)
      // Never twice — one loud line, not a stream.
      wd.touch()
      vi.advanceTimersByTime(5000)
      expect(seen).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('output resets the timer — a slow but talking build is not a stall', () => {
    vi.useFakeTimers()
    try {
      const seen: string[] = []
      const wd = createStallWatchdog({
        label: 'stack deploy',
        budgetMs: 1000,
        host: 'h',
        onStall: (m: string) => seen.push(m),
      })
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(900)
        wd.touch()
      }
      expect(seen).toHaveLength(0)
      wd.stop()
      vi.advanceTimersByTime(10000)
      expect(seen).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('names the budget in minutes', () => {
    expect(formatStallMessage('x', 10 * 60 * 1000, 'h')).toContain('no output for 10m')
  })
})
