// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  PAYLOAD_MIGRATIONS_DIR,
  PLATFORM_DATABASE_URL_VAR,
  PLATFORM_MIGRATIONS_DIR,
  PLATFORM_SCHEMA,
  PLATFORM_SCHEMA_DIR,
  PLATFORM_SCHEMA_GLOB,
  buildPlatformDrizzleConfig,
  requirePlatformDatabaseUrl,
} from '../../src/lib/platform/db/config'

/**
 * The platform migration pipeline's separation contract (#125).
 *
 * What these tests pin down is not "drizzle works" but the boundary the task
 * exists to establish: our pipeline reads its OWN connection string, writes its
 * OWN migrations directory and touches ONLY the `core` schema. Every clause
 * below is a way the pipeline could silently start writing into the `cms`
 * database or into Payload's migration bookkeeping — the two failures that
 * would be discovered on prod, not here.
 */

const CMS_URL = 'postgres://payload:pw@postgres:5432/cms'
const PLATFORM_URL = 'postgres://payload:pw@postgres:5432/platform'

describe('requirePlatformDatabaseUrl', () => {
  it('returns the platform connection string', () => {
    expect(requirePlatformDatabaseUrl({ PLATFORM_DATABASE_URL: PLATFORM_URL })).toBe(PLATFORM_URL)
  })

  it('NEVER falls back to the Payload DATABASE_URL — a fallback would migrate `cms`', () => {
    expect(() => requirePlatformDatabaseUrl({ DATABASE_URL: CMS_URL })).toThrow(
      PLATFORM_DATABASE_URL_VAR,
    )
  })

  it('fails closed on an unset or blank value', () => {
    expect(() => requirePlatformDatabaseUrl({})).toThrow(PLATFORM_DATABASE_URL_VAR)
    expect(() => requirePlatformDatabaseUrl({ PLATFORM_DATABASE_URL: '   ' })).toThrow(
      PLATFORM_DATABASE_URL_VAR,
    )
  })
})

describe('buildPlatformDrizzleConfig', () => {
  const config = buildPlatformDrizzleConfig({
    PLATFORM_DATABASE_URL: PLATFORM_URL,
    DATABASE_URL: CMS_URL,
  })

  it('targets postgres through the PLATFORM connection string only', () => {
    expect(config.dialect).toBe('postgresql')
    expect(config.dbCredentials).toEqual({ url: PLATFORM_URL })
    expect(JSON.stringify(config)).not.toContain('/cms')
  })

  it('looks at the `core` schema and nothing else', () => {
    expect(PLATFORM_SCHEMA).toBe('core')
    expect(config.schemaFilter).toEqual([PLATFORM_SCHEMA])
  })

  it('keeps its own migration bookkeeping inside `core`, away from payload_migrations', () => {
    expect(config.migrations?.schema).toBe(PLATFORM_SCHEMA)
    expect(config.migrations?.table).toBe('__drizzle_migrations')
  })

  it('writes migrations to its own directory, never Payload’s src/migrations', () => {
    expect(config.out).toBe(PLATFORM_MIGRATIONS_DIR)
    expect(PLATFORM_MIGRATIONS_DIR.startsWith(PAYLOAD_MIGRATIONS_DIR)).toBe(false)
    expect(PLATFORM_MIGRATIONS_DIR).toContain('src/lib/platform/db/migrations')
  })

  it('reads the schema dir as a *.ts glob — a bare dir makes drizzle-kit require the README', () => {
    expect(config.schema).toBe(PLATFORM_SCHEMA_GLOB)
    expect(PLATFORM_SCHEMA_GLOB.startsWith(PLATFORM_SCHEMA_DIR)).toBe(true)
    expect(PLATFORM_SCHEMA_GLOB.endsWith('*.ts')).toBe(true)
  })

  it('fails closed when PLATFORM_DATABASE_URL is absent, even if DATABASE_URL is set', () => {
    expect(() => buildPlatformDrizzleConfig({ DATABASE_URL: CMS_URL })).toThrow(
      PLATFORM_DATABASE_URL_VAR,
    )
  })
})
