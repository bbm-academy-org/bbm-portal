// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PLATFORM_DATABASE_URL_VAR } from '../../src/lib/platform/db/config'

/**
 * The platform drizzle client (#125). A unit test cannot prove it talks to
 * Postgres — that is the live-pipeline check in the PR — but it CAN prove the
 * two things that must never depend on a running database: the client refuses to
 * exist without its own connection string (no silent fall-back onto the `cms`
 * one), and it opens exactly one pool per process rather than one per import.
 *
 * `pg` builds its pool lazily, so constructing the client here connects to
 * nothing.
 */

const PLATFORM_URL = 'postgres://payload:pw@127.0.0.1:5432/platform'

async function loadClient() {
  vi.resetModules()
  return import('../../src/lib/platform/db/client')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getPlatformDb', () => {
  it('fails closed when the platform connection string is missing', async () => {
    vi.stubEnv(PLATFORM_DATABASE_URL_VAR, '')
    vi.stubEnv('DATABASE_URL', 'postgres://payload:pw@127.0.0.1:5432/cms')
    const { getPlatformDb } = await loadClient()
    expect(() => getPlatformDb()).toThrow(PLATFORM_DATABASE_URL_VAR)
  })

  it('reuses one pool across calls', async () => {
    vi.stubEnv(PLATFORM_DATABASE_URL_VAR, PLATFORM_URL)
    const { getPlatformDb, closePlatformDb } = await loadClient()
    expect(getPlatformDb()).toBe(getPlatformDb())
    await closePlatformDb()
  })
})
