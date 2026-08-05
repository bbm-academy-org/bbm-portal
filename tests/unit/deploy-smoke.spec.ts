import { describe, expect, it } from 'vitest'

import {
  buildChecks,
  evaluateCheck,
  formatResultLine,
  parseSmokeArgs,
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
