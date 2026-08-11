// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  MAINTENANCE_DATABASE,
  deriveMaintenanceTarget,
  formatEnsureOutcome,
  quoteIdentifier,
} from '../../tools/platform/ensure-database.mjs'

/**
 * `pnpm platform:db:ensure` — the idempotent bootstrap of the `platform`
 * database (#125).
 *
 * The step exists so dev and prod bootstrap identically: neither compose file
 * creates the second database, exactly as the dev Zitadel creates its own
 * `zitadel` database inside the same Postgres instance. What is tested here is
 * the pure half — deriving the maintenance connection from the platform one, and
 * refusing every input where "create a database" could mean something we did not
 * intend. The CREATE itself needs a live server and is the live-pipeline check.
 */

const PLATFORM_URL = 'postgres://payload:pw@postgres:5432/platform'

describe('deriveMaintenanceTarget', () => {
  it('names the database to create and the maintenance DB to connect to', () => {
    const target = deriveMaintenanceTarget(PLATFORM_URL)
    expect(target.ok).toBe(true)
    expect(target.database).toBe('platform')
    expect(target.maintenanceUrl).toBe(
      `postgres://payload:pw@postgres:5432/${MAINTENANCE_DATABASE}`,
    )
  })

  it('keeps credentials, port and query parameters of the original string', () => {
    const target = deriveMaintenanceTarget(
      'postgresql://user%40corp:p%2Fw@db.internal:6543/platform?sslmode=require',
    )
    expect(target.ok).toBe(true)
    expect(target.maintenanceUrl).toBe(
      `postgresql://user%40corp:p%2Fw@db.internal:6543/${MAINTENANCE_DATABASE}?sslmode=require`,
    )
  })

  it('refuses a connection string with no database in it', () => {
    expect(deriveMaintenanceTarget('postgres://payload:pw@postgres:5432/').ok).toBe(false)
    expect(deriveMaintenanceTarget('postgres://payload:pw@postgres:5432').ok).toBe(false)
  })

  it('refuses a non-postgres scheme rather than guessing', () => {
    const target = deriveMaintenanceTarget('mysql://payload:pw@host:3306/platform')
    expect(target.ok).toBe(false)
    expect(target.error).toMatch(/postgres/i)
  })

  it('refuses when the target IS the maintenance database — nothing to create', () => {
    const target = deriveMaintenanceTarget(
      `postgres://payload:pw@postgres:5432/${MAINTENANCE_DATABASE}`,
    )
    expect(target.ok).toBe(false)
  })

  it('refuses the `cms` database outright — this step never touches Payload’s', () => {
    const target = deriveMaintenanceTarget('postgres://payload:pw@postgres:5432/cms')
    expect(target.ok).toBe(false)
    expect(target.error).toMatch(/cms/)
  })

  it('refuses a database name that is not a plain identifier', () => {
    expect(deriveMaintenanceTarget('postgres://u:p@h:5432/plat form').ok).toBe(false)
    expect(deriveMaintenanceTarget('postgres://u:p@h:5432/plat%22form').ok).toBe(false)
    expect(deriveMaintenanceTarget('postgres://u:p@h:5432/1platform').ok).toBe(false)
  })

  it('refuses garbage instead of throwing', () => {
    expect(deriveMaintenanceTarget('').ok).toBe(false)
    expect(deriveMaintenanceTarget(undefined).ok).toBe(false)
    expect(deriveMaintenanceTarget('not a url').ok).toBe(false)
  })
})

describe('quoteIdentifier', () => {
  it('double-quotes the name so it reaches Postgres verbatim', () => {
    expect(quoteIdentifier('platform')).toBe('"platform"')
  })
})

describe('formatEnsureOutcome', () => {
  it('says what it did — created', () => {
    const line = formatEnsureOutcome({ database: 'platform', created: true, host: 'postgres:5432' })
    expect(line).toContain('platform')
    expect(line).toContain('postgres:5432')
    expect(line).toMatch(/created/i)
  })

  it('says what it did — already present (the idempotent path)', () => {
    const line = formatEnsureOutcome({
      database: 'platform',
      created: false,
      host: 'postgres:5432',
    })
    expect(line).toMatch(/already exists/i)
  })
})
