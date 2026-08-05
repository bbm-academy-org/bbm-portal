import { describe, expect, it } from 'vitest'

import {
  buildChecks,
  evaluateCheck,
  formatResultLine,
  parseSmokeArgs,
  planSettle,
  runSmoke,
  summarize,
} from '../../tools/deploy/smoke-prod.mjs'

/**
 * `pnpm deploy:smoke --expect-sha <sha>` — the truthful-success gate of the
 * deploy pipeline (task 7.6, #137).
 *
 * Its whole reason to exist is that "the commands exited 0" is not a deploy.
 * The checks are written so that each one can only pass if the box really is
 * serving the code we shipped, on the vhost being asked:
 *
 *   • both public vhosts must report the EXPECTED sha from /api/health — a
 *     skipped rebuild, a failed build, or a container that was never recreated
 *     all show up here as the OLD sha;
 *   • the CMS REST + admin surfaces must answer, so a green sha on a app that
 *     boots and then 500s is not called success;
 *   • the ADR-003 host allowlist must still hold — `/p/*` on the CMS host must
 *     404. A deploy that silently widened the surface is a failed deploy.
 *
 * Everything is decided by pure functions over `{ status, body }` observations,
 * so the whole matrix is unit-testable with no network — including the failure
 * modes that must never be swallowed.
 */

const SHA = 'a'.repeat(40)

describe('parseSmokeArgs', () => {
  it('reads --expect-sha and --dry-run', () => {
    expect(parseSmokeArgs(['--expect-sha', SHA])).toMatchObject({ expectSha: SHA, dryRun: false })
    expect(parseSmokeArgs(['--dry-run']).dryRun).toBe(true)
  })

  it('rejects a non-sha value rather than smoke-testing against garbage', () => {
    expect(parseSmokeArgs(['--expect-sha', 'origin/main']).error).toMatch(/sha/i)
    expect(parseSmokeArgs(['--expect-sha']).error).toMatch(/sha/i)
  })

  it('allows no --expect-sha at all: a plain liveness smoke', () => {
    const parsed = parseSmokeArgs([])
    expect(parsed.error).toBeUndefined()
    expect(parsed.expectSha).toBeNull()
  })

  it('reads --settle-ms, and defaults to a single pass', () => {
    expect(parseSmokeArgs([]).settleMs).toBe(0)
    expect(parseSmokeArgs(['--settle-ms', '90000']).settleMs).toBe(90000)
    expect(parseSmokeArgs(['--settle-ms', 'soon']).error).toMatch(/settle/i)
    expect(parseSmokeArgs(['--settle-ms', '-1']).error).toMatch(/settle/i)
  })
})

describe('planSettle', () => {
  it('turns a settle budget into attempts + a fixed delay', () => {
    expect(planSettle(0)).toEqual({ attempts: 1, delayMs: 0 })
    expect(planSettle(90000)).toMatchObject({ attempts: 19 })
    expect(planSettle(90000).delayMs).toBe(5000)
  })

  it('never yields fewer than one attempt', () => {
    expect(planSettle(1).attempts).toBeGreaterThanOrEqual(1)
    expect(planSettle(-5).attempts).toBe(1)
  })
})

describe('buildChecks', () => {
  it('asks BOTH public vhosts for the build sha', () => {
    const health = buildChecks({ expectSha: SHA }).filter((c) => c.kind === 'health')
    expect(health.map((c) => c.url)).toEqual([
      'https://cms.bbm.academy/api/health',
      'https://portal.bbm.academy/api/health',
    ])
    expect(health.every((c) => c.expectSha === SHA)).toBe(true)
  })

  it('checks the ADR-003 allowlist invariant: /p/* must 404 on the CMS host', () => {
    const denied = buildChecks({ expectSha: SHA }).find((c) => c.expectStatus === 404)
    expect(denied?.url).toBe('https://cms.bbm.academy/p/hours')
  })

  it('drops the sha assertion when no sha is expected (liveness-only run)', () => {
    expect(buildChecks({ expectSha: null }).every((c) => !c.expectSha)).toBe(true)
  })
})

describe('evaluateCheck', () => {
  const healthCheck = buildChecks({ expectSha: SHA }).find((c) => c.kind === 'health')!

  it('passes when the reported sha is the expected one', () => {
    expect(
      evaluateCheck(healthCheck, { status: 200, body: JSON.stringify({ status: 'ok', sha: SHA }) }),
    ).toMatchObject({ ok: true })
  })

  it('FAILS on the previous sha — the exact "skipped rebuild" trap', () => {
    const res = evaluateCheck(healthCheck, {
      status: 200,
      body: JSON.stringify({ status: 'ok', sha: 'b'.repeat(40) }),
    })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain('bbbbbbbbbbbb')
  })

  it('FAILS on sha: null — an image built without DEPLOY_SHA is not a success', () => {
    const res = evaluateCheck(healthCheck, {
      status: 200,
      body: JSON.stringify({ status: 'ok', sha: null }),
    })
    expect(res.ok).toBe(false)
    expect(res.detail).toMatch(/null|no sha/i)
  })

  it('accepts a short-sha prefix of the expected sha (git’s own abbreviation)', () => {
    expect(
      evaluateCheck(healthCheck, {
        status: 200,
        body: JSON.stringify({ sha: SHA.slice(0, 12) }),
      }).ok,
    ).toBe(true)
  })

  it('FAILS on a prefix that is NOT this sha', () => {
    expect(
      evaluateCheck(healthCheck, { status: 200, body: JSON.stringify({ sha: 'abcdef1' }) }).ok,
    ).toBe(false)
  })

  it('FAILS on unparseable JSON instead of treating 200 as good enough', () => {
    const res = evaluateCheck(healthCheck, { status: 200, body: '<html>502 Bad Gateway</html>' })
    expect(res.ok).toBe(false)
    expect(res.detail).toMatch(/json/i)
  })

  it('FAILS on a transport error — an unreachable box is never green', () => {
    const res = evaluateCheck(healthCheck, { error: 'ENOTFOUND cms.bbm.academy' })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain('ENOTFOUND')
  })

  it('enforces an exact expected status where one is declared (the 404 invariant)', () => {
    const denied = buildChecks({ expectSha: SHA }).find((c) => c.expectStatus === 404)!
    expect(evaluateCheck(denied, { status: 404, body: '' }).ok).toBe(true)
    // A 200 here means the CMS host started serving the platform surface.
    expect(evaluateCheck(denied, { status: 200, body: '' }).ok).toBe(false)
  })

  it('accepts a redirect where the check allows one (the OIDC gate on /p/*)', () => {
    const gated = buildChecks({ expectSha: SHA }).find((c) => c.allowRedirect)!
    expect(evaluateCheck(gated, { status: 200, body: '' }).ok).toBe(true)
    expect(evaluateCheck(gated, { status: 302, body: '' }).ok).toBe(true)
    expect(evaluateCheck(gated, { status: 500, body: '' }).ok).toBe(false)
    expect(evaluateCheck(gated, { status: 404, body: '' }).ok).toBe(false)
  })
})

describe('summarize', () => {
  it('is green only when every check is green', () => {
    expect(summarize([{ ok: true }, { ok: true }])).toMatchObject({ ok: true, failed: 0 })
    expect(summarize([{ ok: true }, { ok: false }])).toMatchObject({ ok: false, failed: 1 })
  })

  it('is RED on an empty check list — "nothing ran" is never a pass', () => {
    expect(summarize([]).ok).toBe(false)
  })
})

describe('runSmoke — the whole matrix over an injected fetcher', () => {
  /** Answer every URL from a table; anything unlisted is a transport error. */
  function fetcher(table: Record<string, { status: number; body?: string }>) {
    return async (url: string) => {
      const hit = table[url]
      if (!hit) return { error: `no route for ${url}` }
      return { status: hit.status, body: hit.body ?? '' }
    }
  }

  const healthBody = JSON.stringify({ status: 'ok', sha: SHA })
  const greenTable = {
    'https://cms.bbm.academy/api/health': { status: 200, body: healthBody },
    'https://portal.bbm.academy/api/health': { status: 200, body: healthBody },
    'https://cms.bbm.academy/api/access': { status: 200 },
    'https://cms.bbm.academy/admin': { status: 200 },
    'https://portal.bbm.academy/p/hours': { status: 302 },
    'https://cms.bbm.academy/p/hours': { status: 404 },
  }

  it('is green when every check holds', async () => {
    const res = await runSmoke({ expectSha: SHA, fetcher: fetcher(greenTable) })
    expect(res.ok).toBe(true)
    expect(res.results).toHaveLength(6)
  })

  it('is RED when only the portal vhost lags behind (a Caddy/route regression)', async () => {
    const res = await runSmoke({
      expectSha: SHA,
      fetcher: fetcher({
        ...greenTable,
        'https://portal.bbm.academy/api/health': {
          status: 200,
          body: JSON.stringify({ sha: 'c'.repeat(40) }),
        },
      }),
    })
    expect(res.ok).toBe(false)
    expect(res.results.filter((r) => !r.ok).map((r) => r.url)).toEqual([
      'https://portal.bbm.academy/api/health',
    ])
  })

  it('SETTLES: an app that has not swapped yet on the first probe still passes', async () => {
    // `app` has no compose healthcheck, so the pipeline can only prove
    // `State.Status == running` before smoking. Between that and the first
    // HTTP probe, Next.js may still be booting and Caddy may still hold the old
    // upstream — a single-shot smoke false-reds a deploy that is fine. The
    // owner's inaugural run is exactly when that would be least welcome.
    let call = 0
    const fetcher = async (url: string) => {
      if (url.endsWith('/api/health')) {
        call += 1
        // Both health URLs fail on the first sweep, then report the new sha.
        return call <= 2 ? { status: 502, body: 'Bad Gateway' } : { status: 200, body: healthBody }
      }
      const hit = (greenTable as Record<string, { status: number; body?: string }>)[url]
      return hit ? { status: hit.status, body: hit.body ?? '' } : { error: `no route for ${url}` }
    }
    const slept: number[] = []
    const res = await runSmoke({
      expectSha: SHA,
      fetcher,
      attempts: 3,
      delayMs: 5000,
      sleep: async (ms: number) => {
        slept.push(ms)
      },
    })
    expect(res.ok).toBe(true)
    expect(slept).toEqual([5000])
  })

  it('only RE-probes the checks that are still red', async () => {
    const seen: string[] = []
    let call = 0
    const fetcher = async (url: string) => {
      seen.push(url)
      if (url === 'https://cms.bbm.academy/api/health') {
        call += 1
        return call === 1
          ? { status: 200, body: JSON.stringify({ sha: 'c'.repeat(40) }) }
          : { status: 200, body: healthBody }
      }
      const hit = (greenTable as Record<string, { status: number; body?: string }>)[url]
      return hit ? { status: hit.status, body: hit.body ?? '' } : { error: `no route for ${url}` }
    }
    const res = await runSmoke({
      expectSha: SHA,
      fetcher,
      attempts: 2,
      delayMs: 1,
      sleep: async () => {},
    })
    expect(res.ok).toBe(true)
    // 6 on the first sweep, then ONLY the one that was red.
    expect(seen).toHaveLength(7)
    expect(seen[6]).toBe('https://cms.bbm.academy/api/health')
  })

  it('still gives up: a permanently red check exhausts the budget and reports RED', async () => {
    const slept: number[] = []
    const res = await runSmoke({
      expectSha: SHA,
      fetcher: fetcher({}),
      attempts: 3,
      delayMs: 10,
      sleep: async (ms: number) => {
        slept.push(ms)
      },
    })
    expect(res.ok).toBe(false)
    expect(slept).toHaveLength(2) // between the 3 attempts, not after the last
  })

  it('runs EVERY check even after one fails — the operator sees the whole picture', async () => {
    const res = await runSmoke({ expectSha: SHA, fetcher: fetcher({}) })
    expect(res.ok).toBe(false)
    expect(res.results).toHaveLength(6)
    expect(res.results.every((r) => !r.ok)).toBe(true)
  })
})

describe('formatResultLine', () => {
  it('renders a one-line verdict per check', () => {
    expect(formatResultLine({ ok: true, name: 'cms health', url: 'https://x/api/health' })).toMatch(
      /^ {2}✓ cms health/,
    )
    expect(
      formatResultLine({
        ok: false,
        name: 'cms health',
        url: 'https://x/api/health',
        detail: 'boom',
      }),
    ).toMatch(/✗ cms health .*boom/)
  })
})
