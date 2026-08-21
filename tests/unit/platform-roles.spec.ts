// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  APP_ROLE_GROUP,
  LEAST_PRIVILEGE_MIGRATION,
  MIGRATOR_ROLE_GROUP,
  assertDistinctRoles,
  buildRoleProvisioningStatements,
  ensureRoles,
  formatRolesOutcome,
  parseRoleCredentials,
  quoteLiteral,
  readLeastPrivilegeSql,
} from '../../tools/platform/ensure-roles.mjs'

/**
 * The role split, asserted where it can be asserted offline (#278, EARS-30).
 *
 * The live half — that Postgres really refuses the application role — is
 * `tests/int/platform/audit-privileges.int.spec.ts` against a real cluster; a
 * mock would only assert our opinion of an ACL check. What belongs HERE is
 * everything that decides WHICH statements that cluster is asked to run: the
 * refusals that keep a "split" from being one role wearing two names, the
 * quoting that puts a credential into DDL, and the fact that the grant contract
 * is read from the migration file rather than restated in JavaScript.
 */

const APP = { role: 'bbm_platform_app', password: 'a-pw' }
const MIGRATOR = { role: 'bbm_platform_migrate', password: 'm-pw' }

describe('parseRoleCredentials', () => {
  it('reads the role and password out of the connection string itself', () => {
    expect(parseRoleCredentials('postgres://who:secret@db:5432/platform', 'X')).toEqual({
      role: 'who',
      password: 'secret',
    })
  })

  it('decodes a percent-encoded password rather than creating the wrong one', () => {
    expect(parseRoleCredentials('postgres://who:a%40b@db:5432/platform', 'X').password).toBe('a@b')
  })

  it.each([
    ['not a url at all', 'nonsense', /is not a URL/],
    ['no user', 'postgres://db:5432/platform', /carries no user name/],
    ['no password', 'postgres://who@db:5432/platform', /carries no password/],
    [
      'a role name that is not an identifier',
      'postgres://we ird:pw@db:5432/p',
      /refusing to put it into DDL/,
    ],
  ])('refuses %s', (_name, url, pattern) => {
    expect(() => parseRoleCredentials(url, 'X')).toThrow(pattern)
  })
})

describe('assertDistinctRoles', () => {
  it('accepts two different login roles', () => {
    expect(assertDistinctRoles(APP, MIGRATOR)).toBe(true)
  })

  it('refuses one role named twice — a split that is one role is not a split', () => {
    expect(() => assertDistinctRoles(APP, { ...APP })).toThrow(/the SAME role/)
  })

  it.each([APP_ROLE_GROUP, MIGRATOR_ROLE_GROUP])(
    'refuses a LOGIN role named after the privilege group %s',
    (name) => {
      expect(() => assertDistinctRoles({ role: name, password: 'x' }, MIGRATOR)).toThrow(
        /privilege GROUP name/,
      )
    },
  )
})

describe('buildRoleProvisioningStatements', () => {
  const statements = buildRoleProvisioningStatements({
    app: APP,
    migrator: MIGRATOR,
    database: 'platform',
  })
  const all = statements.join('\n')

  it('creates both groups NOLOGIN — owning a group must not hand out a login', () => {
    for (const group of [APP_ROLE_GROUP, MIGRATOR_ROLE_GROUP]) {
      expect(all).toContain(`CREATE ROLE "${group}" NOLOGIN`)
    }
  })

  it('grants each login role its own group and nothing else', () => {
    expect(all).toContain(`GRANT "${APP_ROLE_GROUP}" TO "${APP.role}"`)
    expect(all).toContain(`GRANT "${MIGRATOR_ROLE_GROUP}" TO "${MIGRATOR.role}"`)
    expect(all).not.toContain(`GRANT "${MIGRATOR_ROLE_GROUP}" TO "${APP.role}"`)
  })

  it('actively REVOKES the owner group from the application role', () => {
    // Not merely "does not grant": an application role that had been made a
    // member by hand would inherit ownership and bypass every REVOKE the ledger
    // migration writes, silently.
    expect(all).toContain(`REVOKE "${MIGRATOR_ROLE_GROUP}" FROM "${APP.role}"`)
  })

  it('leaves the application role unable to create databases or roles', () => {
    expect(all).toContain(`ALTER ROLE "${APP.role}" NOCREATEDB NOCREATEROLE NOSUPERUSER`)
    expect(all).not.toMatch(new RegExp(`ALTER ROLE "${APP.role}" CREATEDB`))
  })

  it('makes the migrating login act AS the group, so migrations own what they create', () => {
    expect(all).toContain(`ALTER ROLE "${MIGRATOR.role}" SET role = "${MIGRATOR_ROLE_GROUP}"`)
  })

  it('hands the database to the owner group and lets the app group connect', () => {
    expect(all).toContain(`ALTER DATABASE "platform" OWNER TO "${MIGRATOR_ROLE_GROUP}"`)
    expect(all).toContain(`GRANT CONNECT ON DATABASE "platform" TO "${APP_ROLE_GROUP}"`)
  })

  it('says nothing about a database that does not exist yet', () => {
    const fresh = buildRoleProvisioningStatements({
      app: APP,
      migrator: MIGRATOR,
      database: null,
    }).join('\n')
    expect(fresh).not.toContain('ALTER DATABASE')
    expect(fresh).not.toContain('GRANT CONNECT ON DATABASE')
  })

  it('quotes a password with a quote in it instead of producing broken DDL', () => {
    const tricky = buildRoleProvisioningStatements({
      app: { role: 'a_role', password: "o'brien" },
      migrator: MIGRATOR,
      database: null,
    }).join('\n')
    expect(tricky).toContain(`ALTER ROLE "a_role" LOGIN PASSWORD 'o''brien'`)
  })
})

describe('quoteLiteral', () => {
  it('doubles every single quote', () => {
    expect(quoteLiteral("a'b'c")).toBe("'a''b''c'")
  })
})

describe('the grant contract is read, not restated', () => {
  it('the statements come from the migration file itself', () => {
    const sql = readLeastPrivilegeSql().join('\n')
    expect(LEAST_PRIVILEGE_MIGRATION).toContain('0007_platform_least_privilege.sql')
    expect(sql).toContain('REVOKE ALL ON TABLE core.audit_event FROM platform_app')
    expect(sql).toContain('GRANT SELECT ON TABLE core.audit_event TO platform_app')
    expect(sql).toContain('ALTER SCHEMA core OWNER TO platform_migrator')
  })

  it('the migration no-ops rather than failing where the groups do not exist', () => {
    // What makes an un-split environment survive the merge commit.
    expect(readLeastPrivilegeSql().join('\n')).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'platform_migrator'\)/,
    )
  })
})

describe('ensureRoles (seams only — no cluster)', () => {
  function fakeClient(onQuery: (sql: string) => unknown = () => undefined) {
    const seen: string[] = []
    class Fake {
      connectionString: string
      constructor({ connectionString }: { connectionString: string }) {
        this.connectionString = connectionString
      }
      async connect() {}
      async query(sql: string) {
        seen.push(sql)
        return (onQuery(sql) as { rows: unknown[]; rowCount: number }) ?? { rows: [], rowCount: 0 }
      }
      async end() {}
    }
    return { Fake, seen }
  }

  it('refuses two connection strings that point at different databases', async () => {
    const { Fake } = fakeClient()
    await expect(
      ensureRoles(
        {
          superuserUrl: 'postgres://su:pw@db:5432/postgres',
          appUrl: 'postgres://app:pw@db:5432/platform',
          migrateUrl: 'postgres://mig:pw@db:5432/platform_9',
        },
        { Client: Fake },
      ),
    ).rejects.toThrow(/two ROLES on one database/)
  })

  it('connects phase 1 to the MAINTENANCE database, never to the target', async () => {
    // The failure this pins: pointed at `…/platform` on a fresh box, the tool
    // aborted with «database platform does not exist» — while its whole job is to
    // split the roles BEFORE that database is created.
    const opened: string[] = []
    class Fake {
      constructor({ connectionString }: { connectionString: string }) {
        opened.push(connectionString)
      }
      async connect() {}
      async query() {
        return { rows: [], rowCount: 0 }
      }
      async end() {}
    }
    await ensureRoles(
      {
        superuserUrl: 'postgres://su:pw@db:5432/platform',
        appUrl: 'postgres://app:pw@db:5432/platform',
        migrateUrl: 'postgres://mig:pw@db:5432/platform',
      },
      { Client: Fake },
    )
    expect(opened).toEqual(['postgres://su:pw@db:5432/postgres'])
  })

  it('skips the grant phase for a database that does not exist yet', async () => {
    const { Fake, seen } = fakeClient(() => ({ rows: [], rowCount: 0 }))
    const outcome = await ensureRoles(
      {
        superuserUrl: 'postgres://su:pw@db:5432/postgres',
        appUrl: 'postgres://app:pw@db:5432/platform',
        migrateUrl: 'postgres://mig:pw@db:5432/platform',
      },
      { Client: Fake },
    )
    expect(outcome).toMatchObject({ app: 'app', migrator: 'mig', grantsApplied: false })
    expect(seen.join('\n')).not.toContain('ALTER DATABASE')
    expect(formatRolesOutcome(outcome)).toContain('platform:migrate')
  })

  it('applies the grant file to a database that already carries `core`', async () => {
    const { Fake, seen } = fakeClient(() => ({ rows: [{}], rowCount: 1 }))
    const outcome = await ensureRoles(
      {
        superuserUrl: 'postgres://su:pw@db:5432/postgres',
        appUrl: 'postgres://app:pw@db:5432/platform',
        migrateUrl: 'postgres://mig:pw@db:5432/platform',
      },
      { Client: Fake, sqlStatements: ['-- the grant file'] },
    )
    expect(outcome.grantsApplied).toBe(true)
    expect(seen).toContain('-- the grant file')
    expect(formatRolesOutcome(outcome)).toContain(LEAST_PRIVILEGE_MIGRATION)
  })
})
