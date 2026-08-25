import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

/**
 * `infra/dev-stand/idp/provision.sh` — the seeded project roles (spec 311 §B).
 *
 * EARS-414: the workspace is gated by exactly TWO starting Zitadel project
 * roles. The gate in `src/lib/platform/authGate.ts` and the roles the IdP
 * actually carries are two ends of one contract, and the failure mode when they
 * drift is silent: a role the app checks but the IdP never issues locks every
 * member out with a bare 403 that looks exactly like a correct refusal. The
 * spelling is therefore imported from the gate, not retyped here.
 *
 * The script is driven through its own `--print-seed-roles` path — the set is
 * generated with no IdP, no PAT and no mutation, the same seam #93 built for
 * the redirect URIs (`tests/unit/idp-provision-redirect-uris.spec.ts`).
 */

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../infra/dev-stand/idp/provision.sh',
)

const hasBash = spawnSync('bash', ['-c', 'exit 0']).error === undefined

const AMBIENT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('IDP_')),
) as NodeJS.ProcessEnv

function printSeedRoles(env: Record<string, string> = {}): string[] {
  const res = spawnSync('bash', [SCRIPT, '--print-seed-roles'], {
    encoding: 'utf8',
    env: { ...AMBIENT_ENV, ...env },
  })
  expect(res.status, res.stderr).toBe(0)
  return res.stdout.trim().split('\n')
}

describe.skipIf(!hasBash)('provision.sh — seeded project roles (EARS-414)', () => {
  it('seeds exactly the two starting roles the gate checks', () => {
    expect(printSeedRoles()).toEqual([PLATFORM_USER_ROLE, PLATFORM_ADMIN_ROLE])
  })

  it('no longer seeds the retired `portal_admin` placeholder', () => {
    expect(printSeedRoles()).not.toContain('portal_admin')
  })

  it('still honours an explicit IDP_SEED_ROLE override', () => {
    expect(printSeedRoles({ IDP_SEED_ROLE: 'cms-editor' })).toEqual(['cms-editor'])
  })

  it('rejects a second print flag rather than silently answering one of them', () => {
    const res = spawnSync('bash', [SCRIPT, '--print-seed-roles', '--print-redirect-uris'], {
      encoding: 'utf8',
      env: AMBIENT_ENV,
    })
    expect(res.status).toBe(2)
  })
})

/**
 * The seeded USERS and the roles each of them holds (spec 311 EARS-417/418).
 *
 * A freshly provisioned stand used to contain exactly one human account, and
 * step 8 granted it BOTH roles — so the stand had no account holding
 * `platform-user` alone, and the EARS-418 refusal could not be exercised on it
 * by construction. The member-only account is therefore part of the seed, not
 * an operator's console click: the refusal path is the half of the gate that
 * fails silently, and a stand that cannot reproduce it cannot prove it.
 *
 * Printed as `<username><TAB><role,role>` through the same no-IdP seam as the
 * roles and the URI sets.
 */
function printSeedUsers(env: Record<string, string> = {}): string[] {
  const res = spawnSync('bash', [SCRIPT, '--print-seed-users'], {
    encoding: 'utf8',
    env: { ...AMBIENT_ENV, ...env },
  })
  expect(res.status, res.stderr).toBe(0)
  return res.stdout.trim().split('\n').filter(Boolean)
}

describe.skipIf(!hasBash)('provision.sh — seeded users (EARS-417, EARS-418)', () => {
  it('seeds an admin account holding both roles and a member-only account', () => {
    expect(printSeedUsers()).toEqual([
      `bbm-test\t${PLATFORM_USER_ROLE},${PLATFORM_ADMIN_ROLE}`,
      `bbm-member\t${PLATFORM_USER_ROLE}`,
    ])
  })

  it('never grants `platform-admin` to the member account — that is its whole point', () => {
    const memberRow = printSeedUsers().find((row) => row.startsWith('bbm-member\t'))
    expect(memberRow).toBeDefined()
    expect(memberRow).not.toContain(PLATFORM_ADMIN_ROLE)
  })

  it('honours explicit usernames for both accounts', () => {
    expect(
      printSeedUsers({ IDP_TEST_USERNAME: 'adm', IDP_MEMBER_USERNAME: 'mbr' }).map(
        (row) => row.split('\t')[0],
      ),
    ).toEqual(['adm', 'mbr'])
  })

  it('drops the member account when the seeded set does not carry its role', () => {
    expect(printSeedUsers({ IDP_SEED_ROLE: 'cms-editor' })).toEqual(['bbm-test\tcms-editor'])
  })

  it('rejects a second print flag rather than silently answering one of them', () => {
    const res = spawnSync('bash', [SCRIPT, '--print-seed-users', '--print-seed-roles'], {
      encoding: 'utf8',
      env: AMBIENT_ENV,
    })
    expect(res.status).toBe(2)
  })
})
