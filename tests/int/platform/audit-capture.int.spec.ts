// @vitest-environment node
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { requirePlatformDatabaseUrl } from '@/lib/platform/db/config'
import { platformTransaction } from '@/lib/platform/db/transaction'

import { auditEventsFor, auditEventsSince, auditWatermark, refusedWith } from './audit-helpers'
import { seedMember, seedPeriod, truncateHoursTables } from './hours-core-helpers'

/**
 * Capture: the diff, the primary key, the value whitelist and the two ways an
 * unattributed write is answered (spec 201, issue #273 — acceptance scenarios
 * 2, 6, 7, 8, 12).
 *
 * Everything here runs against real Postgres, because everything here IS
 * Postgres: a mock would assert our opinion of what a PL/pgSQL trigger does.
 *
 * Two connections are used deliberately and they are not interchangeable:
 * `getPlatformDb()` is the app-MARKED pool (`-c app.connection=app`, EARS-26),
 * and `unmarked()` opens a bare `pg` client — the shape a `psql` session, the
 * drizzle-kit migration runner and a restore all have. The whole fail-closed
 * rule of EARS-26 is the difference between those two.
 */

const db = getPlatformDb()

const ACTOR = { actorEmail: 'anton@bbm.academy', source: 'portal' } as const

/** A connection WITHOUT the application's mark — the owner's `psql` escape hatch. */
async function unmarked<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: requirePlatformDatabaseUrl(process.env) })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

beforeEach(async () => {
  await truncateHoursTables(db)
})

afterAll(async () => {
  await closePlatformDb()
})

describe('core.audit_row_change — the diff', () => {
  it('EARS-2: an UPDATE records only the fields that actually changed, each with old and new', async () => {
    const id = await seedMember({ email: 'anna@bbm.academy', name: 'Анна', role: 'QA' })
    const mark = await auditWatermark(db)

    await platformTransaction(ACTOR, (tx) =>
      tx.execute(sql`update core.member set name = 'Анна Б' where id = ${id}`),
    )

    const [event] = await auditEventsFor(db, mark, 'member')
    expect(event.event_type).toBe('data.member.update')
    expect(event.diff).toEqual({ name: { old: 'Анна', new: 'Анна Б' } })
  })

  it('EARS-2: `updated_at` is dropped from the diff entirely — bookkeeping is not a change', async () => {
    const id = await seedMember({ email: 'anna@bbm.academy', name: 'Анна' })
    const mark = await auditWatermark(db)

    await platformTransaction(ACTOR, (tx) =>
      tx.execute(
        sql`update core.member set name = 'Анна Б', updated_at = now() + interval '1 hour'
            where id = ${id}`,
      ),
    )

    const [event] = await auditEventsFor(db, mark, 'member')
    expect(Object.keys(event.diff)).toEqual(['name'])
  })

  it('EARS-2: an INSERT records the whole new row and a DELETE the whole old row', async () => {
    const mark = await auditWatermark(db)
    await seedPeriod({ id: 'p-july', label: 'Июль', from: '2026-07-01', to: '2026-07-31' })

    const [inserted] = await auditEventsFor(db, mark, 'hours_period')
    expect(inserted.event_type).toBe('data.hours_period.insert')
    expect(inserted.diff).toEqual({
      id: { new: 'p-july' },
      label: { new: 'Июль' },
      date_from: { new: '2026-07-01' },
      date_to: { new: '2026-07-31' },
      status: { new: 'closed' },
      sort_key: { new: 0 },
    })
  })

  it('EARS-3: scenario 6 — an UPDATE that changes nothing writes no ledger row at all', async () => {
    const id = await seedMember({ email: 'anna@bbm.academy', name: 'Анна' })
    const mark = await auditWatermark(db)

    await platformTransaction(ACTOR, (tx) =>
      tx.execute(sql`update core.member set name = 'Анна' where id = ${id}`),
    )

    expect(await auditEventsSince(db, mark)).toEqual([])
  })

  it('EARS-4: scenario 7 — a DELETE keeps every whitelisted column under `old`, with its PK read from the catalog', async () => {
    await seedPeriod({ id: 'p-august', label: 'Август', from: '2026-08-01', to: '2026-08-31' })
    const mark = await auditWatermark(db)

    await platformTransaction(ACTOR, (tx) =>
      tx.execute(sql`delete from core.hours_period where id = 'p-august'`),
    )

    const [event] = await auditEventsFor(db, mark, 'hours_period')
    expect(event.event_type).toBe('data.hours_period.delete')
    // The primary key comes from `pg_index`/`pg_attribute` on TG_RELID, not from
    // a per-table list — which is what makes a composite PK cost no code.
    expect(event.pk).toEqual({ id: 'p-august' })
    expect(event.diff).toEqual({
      id: { old: 'p-august' },
      label: { old: 'Август' },
      date_from: { old: '2026-08-01' },
      date_to: { old: '2026-08-31' },
      status: { old: 'closed' },
      sort_key: { old: 0 },
    })
  })

  it('EARS-5: the event type is `data.<table>.<operation>`, matching the donor taxonomy', async () => {
    const mark = await auditWatermark(db)
    const id = await seedMember({ email: 'anna@bbm.academy', name: 'Анна' })
    await platformTransaction(ACTOR, async (tx) => {
      await tx.execute(sql`update core.member set name = 'Анна Б' where id = ${id}`)
      await tx.execute(sql`delete from core.member where id = ${id}`)
    })

    expect((await auditEventsSince(db, mark)).map((row) => row.event_type)).toEqual([
      'data.member.insert',
      'data.member.update',
      'data.member.delete',
    ])
  })

  it('EARS-11: every row of one save shares one txid, so a save is recoverable as a unit', async () => {
    const mark = await auditWatermark(db)
    await platformTransaction(ACTOR, async (tx) => {
      await tx.execute(
        sql`insert into core.member (slug, email, name) values ('a', 'a@bbm.academy', 'A')`,
      )
      await tx.execute(
        sql`insert into core.member (slug, email, name) values ('b', 'b@bbm.academy', 'B')`,
      )
    })

    const rows = await auditEventsSince(db, mark)
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.txid)).size).toBe(1)
  })
})

describe('core.audit_row_change — the value whitelist', () => {
  it('EARS-16: scenario 8 — a member_alias value is recorded as {changed:true} and the digits appear nowhere in the row', async () => {
    const memberId = await seedMember({ email: 'igor@bbm.academy', name: 'Игорь' })
    const mark = await auditWatermark(db)

    await platformTransaction(ACTOR, async (tx) => {
      await tx.execute(
        sql`insert into core.member_alias (member_id, kind, value, note)
            values (${memberId}, 'phone', '+79991234567', 'личный')`,
      )
      await tx.execute(sql`update core.member set name = 'Игорь Пирогов' where id = ${memberId}`)
    })

    const [alias] = await auditEventsFor(db, mark, 'member_alias')
    // The service half of the row is in the clear — `kind` says WHICH channel
    // changed. The contact itself, and the free text around it, are not.
    expect(alias.diff).toEqual({
      id: { new: expect.any(Number) },
      member_id: { new: memberId },
      kind: { new: 'phone' },
      value: { changed: true },
      note: { changed: true },
    })
    // No `old`, no `new`, no mask, no hash — checked by grepping the WHOLE row.
    expect(JSON.stringify(alias)).not.toContain('9991234567')
    expect(JSON.stringify(alias)).not.toContain('личный')

    // …while the corporate identity is recorded in the clear, same transaction.
    const [name] = await auditEventsFor(db, mark, 'member')
    expect(name.diff).toEqual({ name: { old: 'Игорь', new: 'Игорь Пирогов' } })
  })

  it('EARS-27: default-deny — a column the trigger arguments do not name records the fact, never the value', async () => {
    // `member_alias.value` and `.note` are the only columns of an audited table
    // the initial whitelist withholds (EARS-17, the owner's Q2 matrix draws the
    // line at a person's CONTACTS), so they are what default-deny is shown on.
    const memberId = await seedMember({ email: 'igor@bbm.academy', name: 'Игорь' })
    await platformTransaction(ACTOR, (tx) =>
      tx.execute(
        sql`insert into core.member_alias (member_id, kind, value, note)
            values (${memberId}, 'telegram', 'dobroyar', 'основной')`,
      ),
    )
    const mark = await auditWatermark(db)

    await platformTransaction(ACTOR, (tx) =>
      tx.execute(
        sql`update core.member_alias set value = 'dobroyar_new', note = 'сменил'
            where member_id = ${memberId}`,
      ),
    )

    const [event] = await auditEventsFor(db, mark, 'member_alias')
    expect(event.diff).toEqual({ value: { changed: true }, note: { changed: true } })
    expect(JSON.stringify(event)).not.toContain('dobroyar')
    expect(JSON.stringify(event)).not.toContain('сменил')
  })

  it('EARS-17: `member` service columns are recorded by value — they are not personal contacts', async () => {
    const id = await seedMember({ email: 'anna@bbm.academy', name: 'Анна', role: 'QA' })
    const mark = await auditWatermark(db)

    await platformTransaction(ACTOR, (tx) =>
      tx.execute(sql`update core.member set role = 'Dev', status = 'inactive' where id = ${id}`),
    )

    const [event] = await auditEventsFor(db, mark, 'member')
    expect(event.diff).toEqual({
      role: { old: 'QA', new: 'Dev' },
      status: { old: 'active', new: 'inactive' },
    })
  })
})

describe('core.audit_row_change — attribution', () => {
  it('EARS-6: an application write records the session actor and `source = portal`', async () => {
    const mark = await auditWatermark(db)
    await platformTransaction(ACTOR, (tx) =>
      tx.execute(
        sql`insert into core.member (slug, email, name) values ('a', 'a@bbm.academy', 'A')`,
      ),
    )

    const [event] = await auditEventsSince(db, mark)
    expect(event.source).toBe('portal')
    expect(event.actor_email).toBe('anton@bbm.academy')
  })

  it('EARS-7: an actor-less source is legal, and a source outside the closed set is refused', async () => {
    const mark = await auditWatermark(db)
    await platformTransaction({ actorEmail: null, source: 'cli:member-seed' }, (tx) =>
      tx.execute(
        sql`insert into core.member (slug, email, name) values ('a', 'a@bbm.academy', 'A')`,
      ),
    )
    const [event] = await auditEventsSince(db, mark)
    expect(event).toMatchObject({ source: 'cli:member-seed', actor_email: null })

    // `db-direct` is the trigger's OWN fallback and no caller may claim it: an
    // app write borrowing it would make the ledger lie about the door.
    await expect(
      platformTransaction({ actorEmail: null, source: 'db-direct' as never }, (tx) =>
        tx.execute(sql`update core.member set name = 'X' where slug = 'a'`),
      ),
    ).rejects.toSatisfy(refusedWith(/is not in the closed set/))
  })

  it('EARS-8: scenario 2 — a direct psql write is not blocked; it lands as db-direct with a NULL actor', async () => {
    const id = await seedMember({ email: 'anna@bbm.academy', name: 'Анна', role: 'QA' })
    const mark = await auditWatermark(db)

    await unmarked((client) =>
      client.query('update core.member set name = $1 where id = $2', ['Анна Прямая', id]),
    )

    const [event] = await auditEventsFor(db, mark, 'member')
    expect(event).toMatchObject({ source: 'db-direct', actor_email: null })
    expect(event.diff).toEqual({ name: { old: 'Анна', new: 'Анна Прямая' } })
  })

  it('EARS-8: an announced operator session may name itself `manual-dba` even though it is unmarked', async () => {
    const id = await seedMember({ email: 'anna@bbm.academy', name: 'Анна' })
    const mark = await auditWatermark(db)

    await unmarked(async (client) => {
      await client.query('begin')
      // The ONE legitimate hand-written `app.*` GUC write in the repo, and the
      // reason it is legitimate is the whole clause: this is an UNMARKED
      // connection standing in for an announced operator `psql` session, which
      // by construction cannot reach `platformTransaction()`. The eslint rule of
      // EARS-24 flags it exactly as it should — that it had to be disabled here,
      // by name, with a reason, is the rule working.
      // eslint-disable-next-line no-restricted-syntax -- EARS-7 `manual-dba`: an operator session sets the context by hand
      await client.query("select set_config('app.source', 'manual-dba', true)")
      await client.query('update core.member set name = $1 where id = $2', ['Анна Р', id])
      await client.query('commit')
    })

    const [event] = await auditEventsFor(db, mark, 'member')
    expect(event).toMatchObject({ source: 'manual-dba', actor_email: null })
  })

  it('EARS-26: scenario 12 — an app write that skips the helper fails and writes no db-direct row', async () => {
    // The throwaway-bypass shape, exactly: a statement on the app-marked pool
    // that never opened `platformTransaction`, i.e. never set the context.
    const id = await seedMember({ email: 'anna@bbm.academy', name: 'Анна' })
    const mark = await auditWatermark(db)

    await expect(
      db.execute(sql`update core.member set name = 'Обход' where id = ${id}`),
    ).rejects.toSatisfy(refusedWith(/audit: actor context not set for core\.member/))

    expect(await auditEventsSince(db, mark)).toEqual([])
    const { rows } = await db.execute<{ name: string }>(
      sql`select name from core.member where id = ${id}`,
    )
    expect(rows[0].name).toBe('Анна')
  })

  it('EARS-9: `portal` with no actor is a defect, refused before it reaches the database', async () => {
    await expect(
      platformTransaction({ actorEmail: null, source: 'portal' }, async () => undefined),
    ).rejects.toThrowError(/actorEmail is required/)
  })

  it('EARS-10: a failure inside the transaction takes the domain write back with the ledger row', async () => {
    const mark = await auditWatermark(db)

    await expect(
      platformTransaction(ACTOR, async (tx) => {
        await tx.execute(
          sql`insert into core.member (slug, email, name) values ('a', 'a@bbm.academy', 'A')`,
        )
        throw new Error('the save failed after the row was written')
      }),
    ).rejects.toThrow('the save failed')

    expect(await auditEventsSince(db, mark)).toEqual([])
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from core.member`,
    )
    expect(rows[0].n).toBe(0)
  })
})
