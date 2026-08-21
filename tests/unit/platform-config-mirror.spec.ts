// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  PLATFORM_APP_ROLE_GROUP,
  PLATFORM_DATABASE_URL_VAR,
  PLATFORM_MIGRATE_DATABASE_URL_VAR,
  PLATFORM_MIGRATOR_ROLE_GROUP,
  buildPlatformDrizzleConfig,
  resolvePlatformMigrateDatabaseUrl,
} from '@/lib/platform/db/config'

import * as toolConfig from '../../tools/platform/platform-config.mjs'

/**
 * The `.mjs` mirror cannot drift from `config.ts` (#278).
 *
 * The `pnpm platform:*` tools run as plain `node` and cannot import a `.ts`
 * module, so `tools/platform/platform-config.mjs` restates four values and one
 * rule. A restatement that nothing checks is a second source of truth waiting to
 * disagree with the first, so this file runs both implementations over the same
 * table of environments and compares the answers — including the fallback
 * warning's text, because that warning is what makes an un-split environment's
 * fallback loud rather than silent.
 */

const APP = 'postgres://app:pw@db:5432/platform'
const MIGRATE = 'postgres://mig:pw@db:5432/platform'

describe('platform-config.mjs mirrors src/lib/platform/db/config.ts', () => {
  it('restates the same variable and group names', () => {
    expect(toolConfig.PLATFORM_DATABASE_URL_VAR).toBe(PLATFORM_DATABASE_URL_VAR)
    expect(toolConfig.PLATFORM_MIGRATE_DATABASE_URL_VAR).toBe(PLATFORM_MIGRATE_DATABASE_URL_VAR)
    expect(toolConfig.APP_ROLE_GROUP).toBe(PLATFORM_APP_ROLE_GROUP)
    expect(toolConfig.MIGRATOR_ROLE_GROUP).toBe(PLATFORM_MIGRATOR_ROLE_GROUP)
  })

  it.each([
    ['split: both set', { PLATFORM_DATABASE_URL: APP, PLATFORM_MIGRATE_DATABASE_URL: MIGRATE }],
    ['split: only the migrating one set', { PLATFORM_MIGRATE_DATABASE_URL: MIGRATE }],
    ['un-split: only the application one set', { PLATFORM_DATABASE_URL: APP }],
    ['whitespace is trimmed away to nothing', { PLATFORM_MIGRATE_DATABASE_URL: '   ', PLATFORM_DATABASE_URL: APP }],
  ])('resolves identically — %s', (_name, env) => {
    expect(toolConfig.resolveMigrateDatabaseUrl(env)).toEqual(
      resolvePlatformMigrateDatabaseUrl(env),
    )
  })

  it('both throw, with the same message, when neither variable is set', () => {
    const ts = (() => {
      try {
        resolvePlatformMigrateDatabaseUrl({})
        return null
      } catch (err) {
        return (err as Error).message
      }
    })()
    expect(ts).toContain(PLATFORM_MIGRATE_DATABASE_URL_VAR)
    expect(() => toolConfig.resolveMigrateDatabaseUrl({})).toThrow(ts!)
  })
})

describe('the split, stated as behaviour', () => {
  it('the MIGRATING string is what drizzle-kit is handed', () => {
    const config = buildPlatformDrizzleConfig({
      PLATFORM_DATABASE_URL: APP,
      PLATFORM_MIGRATE_DATABASE_URL: MIGRATE,
    })
    expect(config.dbCredentials.url).toBe(MIGRATE)
  })

  it('an un-split environment still migrates, and the fallback is not silent', () => {
    const resolution = resolvePlatformMigrateDatabaseUrl({ PLATFORM_DATABASE_URL: APP })
    expect(resolution).toMatchObject({ url: APP, split: false })
    expect(resolution.warning).toContain(PLATFORM_MIGRATE_DATABASE_URL_VAR)
    expect(resolution.warning).toContain('platform:roles:ensure')
  })

  it('a split environment carries no warning at all', () => {
    expect(
      resolvePlatformMigrateDatabaseUrl({
        PLATFORM_DATABASE_URL: APP,
        PLATFORM_MIGRATE_DATABASE_URL: MIGRATE,
      }),
    ).toEqual({ url: MIGRATE, split: true })
  })

  it('there is still no fallback onto Payload’s DATABASE_URL', () => {
    expect(() =>
      resolvePlatformMigrateDatabaseUrl({ DATABASE_URL: 'postgres://payload:pw@db:5432/cms' }),
    ).toThrow(/no\s+fallback onto DATABASE_URL/)
  })
})
