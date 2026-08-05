import { describe, expect, it } from 'vitest'
import { HEALTH_PATH, buildHealthBody, resolveBuildSha } from '@/lib/platform/health'

/**
 * `/api/health` is the truthful-success anchor of the deploy pipeline (#137,
 * task 7.6). It replaces the `DEPLOYED_SHA` marker file + container-`Created`
 * timestamp pair the old runbook compared by hand: the RUNNING app reports the
 * commit it was built from, so `pnpm deploy:smoke --expect-sha <sha>` cannot be
 * fooled by a skipped rebuild.
 *
 * The load-bearing property is fail-CLOSED: an app that does not know its SHA
 * reports `sha: null`, never a guess and never the string "unknown" that a
 * sloppy comparison might accept.
 */

describe('resolveBuildSha', () => {
  it('accepts a 40-char commit sha and lowercases it', () => {
    expect(resolveBuildSha('A'.repeat(40))).toBe('a'.repeat(40))
  })

  it('accepts a short sha (7 hex chars is git’s own floor)', () => {
    expect(resolveBuildSha('0badc0f')).toBe('0badc0f')
  })

  it('trims surrounding whitespace a compose/env round-trip can leave behind', () => {
    expect(resolveBuildSha('  0badc0f\n')).toBe('0badc0f')
  })

  it('is null for anything that is not a sha — the app never guesses', () => {
    expect(resolveBuildSha(undefined)).toBeNull()
    expect(resolveBuildSha('')).toBeNull()
    expect(resolveBuildSha('   ')).toBeNull()
    expect(resolveBuildSha('unknown')).toBeNull()
    expect(resolveBuildSha('local')).toBeNull()
    expect(resolveBuildSha('0badc0')).toBeNull() // 6 chars — below git's floor
    expect(resolveBuildSha('z'.repeat(40))).toBeNull()
    expect(resolveBuildSha('0'.repeat(41))).toBeNull()
  })
})

describe('buildHealthBody', () => {
  it('reports the build sha and the caller-injected timestamp', () => {
    expect(buildHealthBody({ sha: 'abc1234', nowIso: '2026-08-05T10:00:00.000Z' })).toEqual({
      status: 'ok',
      sha: 'abc1234',
      time: '2026-08-05T10:00:00.000Z',
    })
  })

  it('still answers ok with sha=null when the image carries no DEPLOY_SHA', () => {
    // The endpoint's job is liveness + identity. Liveness is real even for a
    // locally-built image; identity is simply unknown, and `--expect-sha` then
    // fails closed because null never equals a requested sha.
    expect(buildHealthBody({ sha: undefined, nowIso: '2026-08-05T10:00:00.000Z' })).toEqual({
      status: 'ok',
      sha: null,
      time: '2026-08-05T10:00:00.000Z',
    })
  })
})

describe('HEALTH_PATH', () => {
  it('is the one constant both the route and the smoke checks name', () => {
    expect(HEALTH_PATH).toBe('/api/health')
  })
})
