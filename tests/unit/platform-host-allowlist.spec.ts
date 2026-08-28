import { describe, expect, it } from 'vitest'
import {
  evaluateRequest,
  isCmsSurfaceHost,
  isModuleApiPath,
  isPlatformPath,
  isPlatformSurfaceHost,
  modeFromNodeEnv,
  normalizeHost,
} from '@/lib/platform/hostAllowlist'

// Full host→surface allowlist matrix (ADR-003 §1/§2 Layer 1, spec 060 req.3/5/6):
// default-deny on EVERY host, over ALL paths. P3 (#60) expands the P2b
// /p/*-only rule to the complete table — the middleware is now the sole,
// authoritative enforcement (Caddy stays coarse per spec 060 req.2), so this
// matrix is the load-bearing test ADR-003 Consequences call for.

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

describe('modeFromNodeEnv', () => {
  it('is production only for NODE_ENV=production', () => {
    expect(modeFromNodeEnv('production')).toBe('production')
  })

  it('is development for everything else (dev, test, unset)', () => {
    expect(modeFromNodeEnv('development')).toBe('development')
    expect(modeFromNodeEnv('test')).toBe('development')
    expect(modeFromNodeEnv(undefined)).toBe('development')
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
  it('production: ONLY the portal host — localhost is NOT a platform host in prod (spec 060 req.5)', () => {
    expect(isPlatformSurfaceHost('portal.bbm.academy', 'production')).toBe(true)
    expect(isPlatformSurfaceHost('PORTAL.BBM.ACADEMY.', 'production')).toBe(true)
    expect(isPlatformSurfaceHost('localhost', 'production')).toBe(false)
    expect(isPlatformSurfaceHost('localhost:3000', 'production')).toBe(false)
    expect(isPlatformSurfaceHost('127.0.0.1', 'production')).toBe(false)
    expect(isPlatformSurfaceHost('cms.bbm.academy', 'production')).toBe(false)
    expect(isPlatformSurfaceHost('app', 'production')).toBe(false)
  })

  it('development: the dev origin serves the platform surface too', () => {
    expect(isPlatformSurfaceHost('localhost', 'development')).toBe(true)
    expect(isPlatformSurfaceHost('localhost:3000', 'development')).toBe(true)
    expect(isPlatformSurfaceHost('127.0.0.1', 'development')).toBe(true)
    expect(isPlatformSurfaceHost('portal.bbm.academy', 'development')).toBe(true)
    expect(isPlatformSurfaceHost('cms.bbm.academy', 'development')).toBe(false)
  })

  it('default-deny for unknown/missing hosts in both modes', () => {
    for (const mode of ['production', 'development'] as const) {
      expect(isPlatformSurfaceHost('unknown.example.com', mode)).toBe(false)
      expect(isPlatformSurfaceHost(null, mode)).toBe(false)
      expect(isPlatformSurfaceHost(undefined, mode)).toBe(false)
    }
  })
})

describe('isCmsSurfaceHost', () => {
  it('production: the CMS host and the internal compose service host `app` (preview S2S)', () => {
    expect(isCmsSurfaceHost('cms.bbm.academy', 'production')).toBe(true)
    expect(isCmsSurfaceHost('CMS.BBM.ACADEMY:443', 'production')).toBe(true)
    // The preview container fetches drafts from http://app:3000 over the
    // compose network (deploy/docker-compose.prod.yml) — Host: app:3000.
    expect(isCmsSurfaceHost('app', 'production')).toBe(true)
    expect(isCmsSurfaceHost('app:3000', 'production')).toBe(true)
    expect(isCmsSurfaceHost('localhost', 'production')).toBe(false)
    expect(isCmsSurfaceHost('127.0.0.1', 'production')).toBe(false)
    expect(isCmsSurfaceHost('portal.bbm.academy', 'production')).toBe(false)
  })

  it('development: the dev origin serves the CMS surface too (admin on localhost)', () => {
    expect(isCmsSurfaceHost('localhost', 'development')).toBe(true)
    expect(isCmsSurfaceHost('localhost:3000', 'development')).toBe(true)
    expect(isCmsSurfaceHost('127.0.0.1', 'development')).toBe(true)
    expect(isCmsSurfaceHost('cms.bbm.academy', 'development')).toBe(true)
    expect(isCmsSurfaceHost('portal.bbm.academy', 'development')).toBe(false)
  })

  it('default-deny for unknown/missing hosts in both modes', () => {
    for (const mode of ['production', 'development'] as const) {
      expect(isCmsSurfaceHost('unknown.example.com', mode)).toBe(false)
      expect(isCmsSurfaceHost(null, mode)).toBe(false)
      expect(isCmsSurfaceHost(undefined, mode)).toBe(false)
    }
  })
})

describe('evaluateRequest — production host × path matrix (spec 060 req.3)', () => {
  const cmsHostVariants = [
    'cms.bbm.academy',
    'CMS.BBM.ACADEMY',
    'cms.bbm.academy:443',
    'cms.bbm.academy.',
  ]
  const portalHostVariants = [
    'portal.bbm.academy',
    'PORTAL.BBM.ACADEMY',
    'portal.bbm.academy:443',
    'portal.bbm.academy.',
  ]

  const cmsOnlyPaths = [
    '/', // (frontend) static-backend route — today the only one
    '/admin',
    '/admin/login',
    '/admin/collections/pages',
    '/api/pages',
    '/api/leads',
    '/api/globals/home',
    '/api/graphql',
    '/api/graphql-playground',
    '/api/media/file/logo.png',
  ]
  const platformOnlyPaths = [
    '/p',
    '/p/okr',
    '/p/okr/deep/child',
    '/api/auth/signin',
    '/api/auth/callback/zitadel',
    '/api/auth/session',
    // The modules' HTTP surface (spec 311 EARS-463…EARS-465, D-11). It is a
    // PLATFORM path on every row of this matrix — admitted on the portal,
    // refused on the CMS host and on the internal `app` host — exactly as
    // `/api/auth/*` is.
    '/api/p',
    '/api/p/hours/periods',
    '/api/p/hours/admin/periods',
    '/api/p/okr/admin/parameters',
  ]
  const frameworkPaths = ['/_next/static/chunks/main.js', '/_next/image', '/favicon.ico']
  const noSurfacePaths = ['/okr', '/players', '/example']

  it('CMS host: allows only the CMS surface + framework infra', () => {
    for (const host of cmsHostVariants) {
      for (const path of [...cmsOnlyPaths, ...frameworkPaths]) {
        expect(evaluateRequest(host, path, 'production'), `${host} ${path}`).toBe('pass')
      }
    }
  })

  it('CMS host: 404s the platform surface — /p/* AND /api/auth/* (Auth.js is platform plumbing)', () => {
    for (const host of cmsHostVariants) {
      for (const path of [...platformOnlyPaths, ...noSurfacePaths]) {
        expect(evaluateRequest(host, path, 'production'), `${host} ${path}`).toBe('not-found')
      }
    }
  })

  it('portal host: allows only the platform surface + framework infra', () => {
    for (const host of portalHostVariants) {
      for (const path of [...platformOnlyPaths, ...frameworkPaths]) {
        expect(evaluateRequest(host, path, 'production'), `${host} ${path}`).toBe('pass')
      }
    }
  })

  it('portal host: 404s the CMS surface — /admin, Payload REST/GraphQL, frontend root', () => {
    for (const host of portalHostVariants) {
      for (const path of [...cmsOnlyPaths, ...noSurfacePaths]) {
        expect(evaluateRequest(host, path, 'production'), `${host} ${path}`).toBe('not-found')
      }
    }
  })

  it('the /api/auth/* deny carve-out does not over-match sibling Payload slugs', () => {
    // /api/auth-lookalike is a legitimate /api/[...slug] catch-all path — it
    // belongs to Payload on the CMS host (Payload 404s unknown slugs itself)
    // and stays denied on the portal host (not Auth.js plumbing).
    expect(evaluateRequest('cms.bbm.academy', '/api/auth-lookalike', 'production')).toBe('pass')
    expect(evaluateRequest('portal.bbm.academy', '/api/auth-lookalike', 'production')).toBe(
      'not-found',
    )
    expect(evaluateRequest('cms.bbm.academy', '/api/auth', 'production')).toBe('not-found')
    expect(evaluateRequest('cms.bbm.academy', '/api/auth/', 'production')).toBe('not-found')
  })

  it('internal compose host `app`: CMS surface only (live preview S2S keeps working)', () => {
    expect(evaluateRequest('app:3000', '/api/globals/home', 'production')).toBe('pass')
    expect(evaluateRequest('app:3000', '/api/media/file/x.png', 'production')).toBe('pass')
    expect(evaluateRequest('app:3000', '/p/okr', 'production')).toBe('not-found')
    expect(evaluateRequest('app:3000', '/api/auth/signin', 'production')).toBe('not-found')
  })

  it('localhost/127.0.0.1 in production: 404 for EVERYTHING (spec 060 req.5)', () => {
    for (const host of ['localhost', 'localhost:3000', '127.0.0.1']) {
      for (const path of [...cmsOnlyPaths, ...platformOnlyPaths, ...frameworkPaths]) {
        expect(evaluateRequest(host, path, 'production'), `${host} ${path}`).toBe('not-found')
      }
    }
  })

  it('unknown/missing host: 404 for EVERYTHING (default-deny, incl. framework paths)', () => {
    for (const host of ['unknown.example.com', 'evil.test', null, undefined]) {
      for (const path of [
        '/',
        '/admin',
        '/api/pages',
        '/p/okr',
        '/api/auth/signin',
        ...frameworkPaths,
      ]) {
        expect(evaluateRequest(host, path, 'production'), `${host} ${path}`).toBe('not-found')
      }
    }
  })
})

describe('evaluateRequest — development mode (dev ergonomics, spec 060 req.5)', () => {
  it('localhost serves BOTH surfaces: admin + /p/okr, as today', () => {
    for (const host of ['localhost', 'localhost:3000', '127.0.0.1']) {
      for (const path of [
        '/',
        '/admin',
        '/api/pages',
        '/api/graphql',
        '/p/okr',
        '/api/auth/signin',
        '/api/auth/callback/zitadel',
        '/_next/static/chunks/main.js',
        '/favicon.ico',
      ]) {
        expect(evaluateRequest(host, path, 'development'), `${host} ${path}`).toBe('pass')
      }
    }
  })

  it('real hosts stay surface-scoped even in development', () => {
    expect(evaluateRequest('cms.bbm.academy', '/p/okr', 'development')).toBe('not-found')
    expect(evaluateRequest('cms.bbm.academy', '/api/auth/signin', 'development')).toBe('not-found')
    expect(evaluateRequest('cms.bbm.academy', '/admin', 'development')).toBe('pass')
    expect(evaluateRequest('portal.bbm.academy', '/admin', 'development')).toBe('not-found')
    expect(evaluateRequest('portal.bbm.academy', '/p/okr', 'development')).toBe('pass')
  })

  it('unknown/missing host: still default-deny in development', () => {
    for (const host of ['unknown.example.com', null]) {
      for (const path of ['/', '/admin', '/p/okr']) {
        expect(evaluateRequest(host, path, 'development'), `${host} ${path}`).toBe('not-found')
      }
    }
  })
})

describe('the modules HTTP surface /api/p/* (spec 311 EARS-463, EARS-464, EARS-465)', () => {
  // D-11: the module API keeps the `/api/p/<slug>/*` shape consolidation §5
  // fixes, and the allowlist changes to meet it. Before this pair of edits
  // EVERY module API in spec 311 was 404 on `portal.bbm.academy` while
  // `isCmsSurfacePath`'s generic `/api/*` clause served it on
  // `cms.bbm.academy` — both halves wrong, in opposite directions.

  it('EARS-463: `isModuleApiPath` matches /api/p and everything under /api/p/', () => {
    expect(isModuleApiPath('/api/p')).toBe(true)
    expect(isModuleApiPath('/api/p/')).toBe(true)
    expect(isModuleApiPath('/api/p/hours/periods')).toBe(true)
    expect(isModuleApiPath('/api/p/okr/admin/parameters')).toBe(true)
  })

  it('EARS-463: it does NOT over-match a sibling Payload slug that merely starts with /api/p', () => {
    // `/api/pages` and `/api/products` are legitimate Payload `/api/[...slug]`
    // paths on the CMS host. A `startsWith('/api/p')` written without the
    // separator would silently move them onto the portal and off the CMS —
    // the exact bypass class PR #64 recorded for the host header.
    expect(isModuleApiPath('/api/pages')).toBe(false)
    expect(isModuleApiPath('/api/products')).toBe(false)
    expect(isModuleApiPath('/api/posts')).toBe(false)
    expect(isModuleApiPath('/api')).toBe(false)
    expect(isModuleApiPath('/p/hours')).toBe(false)
  })

  it('EARS-463: the portal host serves the module API in production and in development', () => {
    for (const host of ['portal.bbm.academy', 'PORTAL.BBM.ACADEMY', 'portal.bbm.academy.']) {
      for (const path of ['/api/p', '/api/p/hours/periods', '/api/p/hours/admin/periods']) {
        expect(evaluateRequest(host, path, 'production'), `${host} ${path}`).toBe('pass')
        expect(evaluateRequest(host, path, 'development'), `${host} ${path}`).toBe('pass')
      }
    }
  })

  it('EARS-464: the CMS host refuses it — the carve-out beats the generic /api/* clause', () => {
    for (const host of ['cms.bbm.academy', 'CMS.BBM.ACADEMY', 'cms.bbm.academy:443']) {
      for (const path of ['/api/p', '/api/p/hours/periods', '/api/p/hours/admin/periods']) {
        expect(evaluateRequest(host, path, 'production'), `${host} ${path}`).toBe('not-found')
        expect(evaluateRequest(host, path, 'development'), `${host} ${path}`).toBe('not-found')
      }
    }
  })

  it('EARS-464: the carve-out leaves the Payload slugs it looks like alone', () => {
    expect(evaluateRequest('cms.bbm.academy', '/api/pages', 'production')).toBe('pass')
    expect(evaluateRequest('cms.bbm.academy', '/api/products', 'production')).toBe('pass')
    expect(evaluateRequest('portal.bbm.academy', '/api/pages', 'production')).toBe('not-found')
  })

  it('EARS-465: the internal `app` host refuses it — live preview is a CMS consumer', () => {
    expect(evaluateRequest('app:3000', '/api/p/hours/periods', 'production')).toBe('not-found')
    expect(evaluateRequest('app', '/api/p/okr/admin/parameters', 'production')).toBe('not-found')
  })

  it('EARS-465: the dev origin serves it in development and 404s it in production', () => {
    for (const host of ['localhost', 'localhost:3000', '127.0.0.1']) {
      expect(evaluateRequest(host, '/api/p/hours/periods', 'development'), host).toBe('pass')
      expect(evaluateRequest(host, '/api/p/hours/periods', 'production'), host).toBe('not-found')
    }
  })

  it('EARS-465: an unknown host still 404s it — default-deny is untouched', () => {
    expect(evaluateRequest('unknown.example.com', '/api/p/hours/periods', 'production')).toBe(
      'not-found',
    )
    expect(evaluateRequest(null, '/api/p/hours/periods', 'development')).toBe('not-found')
  })
})

describe('evaluateRequest — /api/health is infrastructure, not a surface (#137)', () => {
  // The deploy smoke (`pnpm deploy:smoke --expect-sha`) asks EVERY public vhost
  // for its build sha: that is what proves each vhost really routes into the
  // freshly deployed container, rather than trusting one host and assuming the
  // rest. So /api/health passes on any KNOWN host — like /_next/* and the
  // favicon — while default-deny on unknown hosts is untouched.
  it('passes on both public surfaces in production', () => {
    expect(evaluateRequest('cms.bbm.academy', '/api/health', 'production')).toBe('pass')
    expect(evaluateRequest('portal.bbm.academy', '/api/health', 'production')).toBe('pass')
    expect(evaluateRequest('app', '/api/health', 'production')).toBe('pass')
  })

  it('passes on the dev origin', () => {
    expect(evaluateRequest('localhost:3000', '/api/health', 'development')).toBe('pass')
  })

  it('is NOT a hole in default-deny — an unknown host still 404s', () => {
    expect(evaluateRequest('unknown.example.com', '/api/health', 'production')).toBe('not-found')
    expect(evaluateRequest(null, '/api/health', 'production')).toBe('not-found')
    expect(evaluateRequest('unknown.example.com', '/api/health', 'development')).toBe('not-found')
  })

  it('does not widen to lookalikes — only the exact path is infrastructure', () => {
    // `/api/healthz` on the portal host has no surface: the platform allowlist
    // is /p/* + /api/auth/*, and this is neither.
    expect(evaluateRequest('portal.bbm.academy', '/api/healthz', 'production')).toBe('not-found')
    expect(evaluateRequest('portal.bbm.academy', '/api/health/deep', 'production')).toBe(
      'not-found',
    )
  })
})
