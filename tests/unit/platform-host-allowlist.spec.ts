import { describe, expect, it } from 'vitest'
import {
  evaluatePlatformRequest,
  isPlatformPath,
  isPlatformSurfaceHost,
  normalizeHost,
} from '@/lib/platform/hostAllowlist'

// Host-allowlist matrix for the platform surface (ADR-003 §2, default-deny).
// Middleware governs ONLY the /p/* platform surface; CMS routes stay untouched
// on every host for now. These restore the coverage PR #67 removed with the
// reverted per-route guard (issue #59, spec 059 scenario 5).

describe('normalizeHost', () => {
  it('lowercases, strips port and a trailing FQDN dot', () => {
    expect(normalizeHost('CMS.BBM.ACADEMY')).toBe('cms.bbm.academy')
    expect(normalizeHost('cms.bbm.academy:443')).toBe('cms.bbm.academy')
    expect(normalizeHost('cms.bbm.academy.')).toBe('cms.bbm.academy')
    expect(normalizeHost('  localhost:3000 ')).toBe('localhost')
    expect(normalizeHost('portal.bbm.academy.:8080')).toBe('portal.bbm.academy')
  })

  it('returns null for missing/empty hosts', () => {
    expect(normalizeHost(null)).toBeNull()
    expect(normalizeHost(undefined)).toBeNull()
    expect(normalizeHost('')).toBeNull()
    expect(normalizeHost('   ')).toBeNull()
  })
})

describe('isPlatformPath', () => {
  it('matches /p and everything under /p/', () => {
    expect(isPlatformPath('/p')).toBe(true)
    expect(isPlatformPath('/p/')).toBe(true)
    expect(isPlatformPath('/p/okr')).toBe(true)
    expect(isPlatformPath('/p/okr/deep/child')).toBe(true)
  })

  it('does NOT match lookalike paths that merely start with /p', () => {
    expect(isPlatformPath('/players')).toBe(false)
    expect(isPlatformPath('/privacy')).toBe(false)
    expect(isPlatformPath('/')).toBe(false)
    expect(isPlatformPath('/admin')).toBe(false)
    expect(isPlatformPath('/api/graphql')).toBe(false)
  })
})

describe('isPlatformSurfaceHost', () => {
  it('is true for the dev origin and the future portal host', () => {
    expect(isPlatformSurfaceHost('localhost')).toBe(true)
    expect(isPlatformSurfaceHost('localhost:3000')).toBe(true)
    expect(isPlatformSurfaceHost('127.0.0.1')).toBe(true)
    expect(isPlatformSurfaceHost('portal.bbm.academy')).toBe(true)
    expect(isPlatformSurfaceHost('PORTAL.BBM.ACADEMY.')).toBe(true)
  })

  it('is false for the CMS host and unknown hosts (default-deny)', () => {
    expect(isPlatformSurfaceHost('cms.bbm.academy')).toBe(false)
    expect(isPlatformSurfaceHost('cms.bbm.academy:443')).toBe(false)
    expect(isPlatformSurfaceHost('unknown.example.com')).toBe(false)
    expect(isPlatformSurfaceHost(null)).toBe(false)
    expect(isPlatformSurfaceHost(undefined)).toBe(false)
  })
})

describe('evaluatePlatformRequest — host × path matrix', () => {
  const platformPaths = ['/p', '/p/', '/p/okr', '/p/okr/child']
  const cmsHostVariants = [
    'cms.bbm.academy',
    'CMS.BBM.ACADEMY',
    'cms.bbm.academy:443',
    'cms.bbm.academy.',
  ]
  const allowedHostVariants = ['localhost', 'localhost:3000', '127.0.0.1', 'portal.bbm.academy']

  it('404s every platform path on the CMS host (incl. case/port/trailing-dot)', () => {
    for (const host of cmsHostVariants) {
      for (const path of platformPaths) {
        expect(evaluatePlatformRequest(host, path)).toBe('not-found')
      }
    }
  })

  it('404s every platform path on unknown / missing hosts (default-deny)', () => {
    for (const host of ['unknown.example.com', null, undefined]) {
      for (const path of platformPaths) {
        expect(evaluatePlatformRequest(host, path)).toBe('not-found')
      }
    }
  })

  it('passes every platform path on the dev origin and portal host', () => {
    for (const host of allowedHostVariants) {
      for (const path of platformPaths) {
        expect(evaluatePlatformRequest(host, path)).toBe('pass')
      }
    }
  })

  it('passes non-platform (CMS) paths on EVERY host — CMS routes stay untouched', () => {
    const cmsPaths = ['/', '/admin', '/api/graphql', '/players', '/privacy']
    for (const host of [...cmsHostVariants, ...allowedHostVariants, 'unknown.example.com', null]) {
      for (const path of cmsPaths) {
        expect(evaluatePlatformRequest(host, path)).toBe('pass')
      }
    }
  })
})
