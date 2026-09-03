// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  LOOPBACK_HOSTS,
  DevDatabaseRefusal,
  assertDevPlatformDatabase,
  classifyDevDatabase,
} from '../../tools/platform/dev-database-guard.mjs'

/**
 * The predicate that decides whether `pnpm dev:seed` is allowed to write (#436).
 *
 * The seed writes dozens of synthetic rows into whatever `PLATFORM_DATABASE_URL`
 * names. Getting that wrong once means synthetic people and synthetic ledger
 * operations in a real book, so the predicate is **fail-closed**: only a URL that
 * is positively recognised as a dev platform database passes. Everything the
 * guard cannot classify — an unparseable string, an unknown host, a database name
 * outside the `platform` / `platform_<N>` family — is a refusal, not a warning.
 *
 * Two independent locks, in this order: the environment must not be marked
 * production (the `finance-acceptance-seed` precedent), and the URL itself must
 * look like a dev platform database.
 */

const DEV_URL = 'postgres://payload:pw@localhost:5444/platform_436'

describe('classifyDevDatabase', () => {
  it('accepts the shared dev database and every branch database', () => {
    for (const database of ['platform', 'platform_1', 'platform_436']) {
      const verdict = classifyDevDatabase(`postgres://u:p@localhost:5444/${database}`, {})
      expect(verdict.ok, database).toBe(true)
      if (verdict.ok) expect(verdict.database).toBe(database)
    }
  })

  it('accepts every loopback spelling the dev stand is reached by', () => {
    for (const host of LOOPBACK_HOSTS) {
      const authority = host.includes(':') ? `[${host}]` : host
      const verdict = classifyDevDatabase(`postgres://u:p@${authority}:5444/platform`, {})
      expect(verdict.ok, host).toBe(true)
    }
  })

  it('accepts the LAN address this box reaches its own dev stand at', () => {
    // The dev stand here is not on loopback: `pnpm dev:db:branch` writes
    // `…@192.168.1.115:5444/platform_<N>`. A private address literal cannot be
    // a routable production endpoint, so the whole private space is dev.
    for (const host of ['192.168.1.115', '10.0.3.7', '172.20.4.9', '169.254.7.7', '100.80.1.2']) {
      const verdict = classifyDevDatabase(`postgres://u:p@${host}:5444/platform_436`, {})
      expect(verdict.ok, host).toBe(true)
    }
  })

  it('refuses the compose service name production reaches Postgres by', () => {
    // `deploy/.env.prod.example`: postgres://bbm_platform_app:…@postgres:5432/platform
    const verdict = classifyDevDatabase('postgres://u:p@postgres:5432/platform', {})
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('postgres')
  })

  it('refuses a public address literal, however the name is spelled', () => {
    for (const host of ['203.0.113.10', '8.8.8.8']) {
      const verdict = classifyDevDatabase(`postgres://u:p@${host}:5432/platform`, {})
      expect(verdict.ok, host).toBe(false)
    }
  })

  it('refuses a production environment marker even on a dev-looking URL', () => {
    for (const marker of ['NODE_ENV', 'VERCEL_ENV', 'APP_ENV', 'DEPLOY_ENV']) {
      const verdict = classifyDevDatabase(DEV_URL, { [marker]: 'production' })
      expect(verdict.ok, marker).toBe(false)
      if (!verdict.ok) expect(verdict.reason).toContain(marker)
    }
  })

  it('refuses a host that is not a known dev host', () => {
    const verdict = classifyDevDatabase('postgres://u:p@db.bbm.academy:5432/platform', {})
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('db.bbm.academy')
  })

  it('refuses a database name outside the platform family', () => {
    const verdict = classifyDevDatabase('postgres://u:p@localhost:5444/cms', {})
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('cms')
  })

  it('refuses a name that only looks like a branch database', () => {
    for (const database of ['platform_prod', 'platform_0', 'platformx', 'PLATFORM']) {
      const verdict = classifyDevDatabase(`postgres://u:p@localhost:5444/${database}`, {})
      expect(verdict.ok, database).toBe(false)
    }
  })

  it('refuses an unparseable, empty or non-postgres URL rather than guessing', () => {
    for (const url of ['', '   ', undefined, 'not a url', 'mysql://u:p@localhost/platform']) {
      const verdict = classifyDevDatabase(url, {})
      expect(verdict.ok, String(url)).toBe(false)
    }
  })
})

describe('assertDevPlatformDatabase', () => {
  it('returns the classified target for a dev URL', () => {
    const target = assertDevPlatformDatabase(DEV_URL, {})
    expect(target.database).toBe('platform_436')
    expect(target.host).toBe('localhost')
  })

  it('throws a named refusal carrying the reason, and never the URL itself', () => {
    let thrown: unknown
    try {
      assertDevPlatformDatabase('postgres://u:secret@db.bbm.academy:5432/platform', {})
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(DevDatabaseRefusal)
    expect((thrown as Error).message).toContain('db.bbm.academy')
    expect((thrown as Error).message).not.toContain('secret')
  })
})
