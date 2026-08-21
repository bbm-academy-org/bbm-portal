// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createPeriod,
  deletePeriod,
  mutateHoursDocument,
  readHoursDocument,
  saveAssessment,
  setPeriodStatus,
  updatePeriod,
  upsertParticipant,
} from '@/lib/hours'
import type { HoursDocument } from '@/lib/hours'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import {
  assessmentOf,
  fixtureWrite,
  participantOf,
  seedMember,
  seedParticipant,
  seedPeriod,
  truncateHoursTables,
} from './hours-core-helpers'

/**
 * Кто пишет в этих сюитах (спека 201 EARS-7, EARS-25). `portal` + непустой
 * actor — ровно то, что приходит из Server Action после гейта сессии; без
 * контекста запись отклонит `core.audit_row_change()` на помеченном пуле.
 */
const TEST_ACTOR = { actorEmail: 'anton@bbm.academy', source: 'portal' } as const

/**
 * The hours module against the REAL `core` tables (spec 124: EARS-1, EARS-3,
 * EARS-4, EARS-5, EARS-9, EARS-11, EARS-20, EARS-21, EARS-22).
 *
 * This tier exists because the storage swap moved half of the module's contract
 * into the database: the column TYPES are a digit-for-digit contract (an
 * unrounded `hourly_rate` must round-trip byte-identically), «at most one open
 * period» is now a partial unique index, the participant list order is an
 * explicit `ORDER BY sort_key`, and a member is created through the member
 * module's API inside the same transaction. A mock would assert this module's
 * OPINION of all four.
 *
 * Needs `PLATFORM_DATABASE_URL` (this worktree's branch DB — see
 * `.claude/rules/parallel-sessions.md`, "Platform database"), loaded from `.env`
 * by `vitest.setup.ts`. Run: `pnpm exec vitest run tests/int/platform`.
 */

const db = getPlatformDb()

beforeEach(async () => {
  await truncateHoursTables(db)
})

afterAll(async () => {
  await closePlatformDb()
})

describe('the hours tables on core (EARS-1)', () => {
  it('EARS-1: the four hours tables carry exactly the spec column types', async () => {
    const rows = (
      await db.execute(sql`
        select table_name, column_name, data_type, is_nullable
        from information_schema.columns
        where table_schema = 'core' and table_name like 'hours_%'
        order by table_name, column_name
      `)
    ).rows as Array<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: string
    }>

    const typeOf = (table: string, column: string) =>
      rows.find((row) => row.table_name === table && row.column_name === column)
    const shape = (table: string, column: string) => {
      const row = typeOf(table, column)
      return row ? `${row.data_type}${row.is_nullable === 'YES' ? ' null' : ''}` : 'MISSING'
    }

    // hours_period — text ids and TEXT ISO dates (081 §1: never a `date` column).
    expect(shape('hours_period', 'id')).toBe('text')
    expect(shape('hours_period', 'label')).toBe('text')
    expect(shape('hours_period', 'date_from')).toBe('text')
    expect(shape('hours_period', 'date_to')).toBe('text')
    expect(shape('hours_period', 'status')).toBe('text')
    expect(shape('hours_period', 'sort_key')).toBe('integer')

    // hours_participant — the money attributes, nullable integers.
    expect(shape('hours_participant', 'member_id')).toBe('integer')
    expect(shape('hours_participant', 'fork_min')).toBe('integer null')
    expect(shape('hours_participant', 'fork_max')).toBe('integer null')
    expect(shape('hours_participant', 'grade')).toBe('text null')
    expect(shape('hours_participant', 'sort_key')).toBe('integer')

    // hours_assessment — the digit-for-digit snapshot domains.
    expect(shape('hours_assessment', 'id')).toBe('integer')
    expect(shape('hours_assessment', 'period_id')).toBe('text')
    expect(shape('hours_assessment', 'member_id')).toBe('integer')
    expect(shape('hours_assessment', 'hours')).toBe('double precision')
    expect(shape('hours_assessment', 'weekend_hours')).toBe('double precision')
    expect(shape('hours_assessment', 'method')).toBe('text')
    expect(shape('hours_assessment', 'split_percent')).toBe('double precision')
    expect(shape('hours_assessment', 'monthly_rate')).toBe('integer null')
    expect(shape('hours_assessment', 'hourly_rate')).toBe('double precision null')
    expect(shape('hours_assessment', 'accrual')).toBe('integer')
    expect(shape('hours_assessment', 'cash_amount')).toBe('integer')
    expect(shape('hours_assessment', 'invest_amount')).toBe('integer')
    expect(shape('hours_assessment', 'weekday_count')).toBe('integer')
    expect(shape('hours_assessment', 'saved_at')).toBe('text')

    // hours_publication — the batch's own row (EARS-6). Its messages are rows of
    // `core.hours_publication_message` since #274, and the `jsonb` array they
    // replaced is gone since the contract release #281 (spec 201 EARS-31 step 4)
    // — stated as `MISSING` rather than left unmentioned, so a column resurrected
    // by a stray migration would be caught by the same list that describes the
    // table.
    expect(shape('hours_publication', 'period_id')).toBe('text')
    expect(shape('hours_publication', 'status')).toBe('text')
    expect(shape('hours_publication', 'started_at')).toBe('text')
    expect(shape('hours_publication', 'published_at')).toBe('text null')
    expect(shape('hours_publication', 'preview_fingerprint')).toBe('text')
    expect(shape('hours_publication', 'messages')).toBe('MISSING')
  })

  it('EARS-1: hours_participant and hours_assessment reference core.member, RESTRICT on the participant', async () => {
    const constraints = (
      // `pg_catalog`, not `information_schema`: the SQL-standard views
      // `referential_constraints` and `constraint_column_usage` show only rows
      // whose table is OWNED by a currently enabled role, so since #278 — where
      // `core` is owned by `platform_migrator` and the application connects as
      // `platform_app` — they answer this question with an empty set. The catalog
      // is not privilege-filtered and describes the same constraints.
      await db.execute(sql`
        select con.conname as constraint_name,
               rel.relname as table_name,
               att.attname as column_name,
               case con.confdeltype
                 when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                 when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT'
               end as delete_rule,
               ref.relname as foreign_table
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_class ref on ref.oid = con.confrelid
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
        where con.contype = 'f'
          and rel.relnamespace = 'core'::regnamespace
          and rel.relname like 'hours_%'
          and ref.relname = 'member'
        order by rel.relname
      `)
    ).rows as Array<{
      table_name: string
      column_name: string
      delete_rule: string
      foreign_table: string
    }>

    // Declared as SQL in the migration rather than in drizzle, so that the hours
    // table directory never imports the member one (ADR-004 §6). Which is exactly
    // why it is ASSERTED here instead of trusted to a comment.
    expect(
      constraints.map((row) => `${row.table_name}.${row.column_name} → ${row.delete_rule}`),
    ).toEqual(['hours_assessment.member_id → RESTRICT', 'hours_participant.member_id → RESTRICT'])
  })
})

describe('reading the document (EARS-11, EARS-21)', () => {
  it('EARS-11: an empty database reads as the empty document, keys in the legacy order', async () => {
    const doc = await readHoursDocument()
    expect(Object.keys(doc)).toEqual(['participants', 'periods', 'assessments', 'publications'])
    expect(doc).toEqual({ participants: [], periods: [], assessments: [], publications: [] })
  })

  it('EARS-11: a participant carries exactly the legacy fields — no member-only columns, no monthly_rate', async () => {
    const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон', role: 'Продукт' })
    await seedParticipant(id, { forkMin: 150_000, forkMax: 250_000, grade: 'II', sortKey: 0 })

    const [participant] = (await readHoursDocument()).participants
    expect(Object.keys(participant)).toEqual([
      'email',
      'name',
      'role',
      'fork_min',
      'fork_max',
      'grade',
    ])
    expect(participant).toEqual({
      email: 'anton@bbm.academy',
      name: 'Антон',
      role: 'Продукт',
      fork_min: 150_000,
      fork_max: 250_000,
      grade: 'II',
    })
  })

  it('EARS-11: a member without a hours_participant row is not in the document', async () => {
    await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
    const onlyHours = await seedMember({ email: 'eduard@bbm.academy', name: 'Эдуард' })
    await seedParticipant(onlyHours, { sortKey: 0 })

    const doc = await readHoursDocument()
    expect(doc.participants.map((p) => p.email)).toEqual(['eduard@bbm.academy'])
  })

  it('EARS-11: the export serialization is the legacy document byte-for-byte in key order', async () => {
    const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон', role: null })
    await seedParticipant(id, { sortKey: 0 })
    await seedPeriod({ id: 'p-july', label: 'Июль 2026', from: '2026-07-01', to: '2026-07-31' })

    const serialized = JSON.stringify(await readHoursDocument(), null, 2)
    expect(serialized).toContain('"participants"')
    expect(serialized.indexOf('"participants"')).toBeLessThan(serialized.indexOf('"periods"'))
    expect(serialized.indexOf('"periods"')).toBeLessThan(serialized.indexOf('"assessments"'))
    expect(serialized.indexOf('"assessments"')).toBeLessThan(serialized.indexOf('"publications"'))
    expect(serialized).not.toContain('monthly_rate')
    expect(serialized).not.toContain('timezone')
    expect(serialized).not.toContain('"status": "active"')
  })

  it('EARS-21: participants come in sort_key order, periods in sort_key order, assessments by identity PK', async () => {
    const anton = await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
    const eduard = await seedMember({ email: 'eduard@bbm.academy', name: 'Эдуард' })
    // Deliberately inverted: the member ids ascend while the hours order does not.
    await seedParticipant(eduard, { sortKey: 0 })
    await seedParticipant(anton, { sortKey: 1 })
    await seedPeriod({
      id: 'p-august',
      label: 'Август',
      from: '2026-08-01',
      to: '2026-08-31',
      sortKey: 1,
    })
    await seedPeriod({
      id: 'p-july',
      label: 'Июль',
      from: '2026-07-01',
      to: '2026-07-31',
      sortKey: 0,
    })

    const doc = await readHoursDocument()
    expect(doc.participants.map((p) => p.email)).toEqual([
      'eduard@bbm.academy',
      'anton@bbm.academy',
    ])
    expect(doc.periods.map((p) => p.id)).toEqual(['p-july', 'p-august'])
  })

  it('EARS-21: a new participant and a new period append after the current maximum', async () => {
    const anton = await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
    await seedParticipant(anton, { sortKey: 7 })
    await seedPeriod({
      id: 'p-july',
      label: 'Июль',
      from: '2026-07-01',
      to: '2026-07-31',
      sortKey: 4,
    })

    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      upsertParticipant(doc, {
        email: 'eduard@bbm.academy',
        name: 'Эдуард',
        role: null,
        forkMin: null,
        forkMax: null,
        grade: null,
      }),
    )
    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      createPeriod(doc, { label: 'Август', dateFrom: '2026-08-01', dateTo: '2026-08-31' }, 'p-aug'),
    )

    const doc = await readHoursDocument()
    expect(doc.participants.map((p) => p.email)).toEqual([
      'anton@bbm.academy',
      'eduard@bbm.academy',
    ])
    expect(doc.periods.map((p) => p.id)).toEqual(['p-july', 'p-aug'])
  })
})

describe('participants and the shared registry (EARS-3, EARS-9)', () => {
  it('EARS-9: an unknown email creates a member with a slug derived from the local part', async () => {
    const result = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      upsertParticipant(doc, {
        email: ' Anton@BBM.Academy ',
        name: 'Антон',
        role: 'Продукт',
        forkMin: null,
        forkMax: null,
        grade: null,
      }),
    )
    expect(result.ok).toBe(true)

    const members = (
      await db.execute(sql`select slug, email, name, role, status, timezone
                                         from core.member order by id`)
    ).rows
    expect(members).toEqual([
      {
        slug: 'anton',
        email: 'anton@bbm.academy',
        name: 'Антон',
        role: 'Продукт',
        status: 'active',
        timezone: 'Europe/Moscow',
      },
    ])
  })

  it('EARS-9: an existing email updates name and role on the shared registry instead of creating a second member', async () => {
    const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон', role: 'Продукт' })
    await seedParticipant(id, { sortKey: 0 })

    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      upsertParticipant(doc, {
        email: 'anton@bbm.academy',
        name: 'Антон Сидоров',
        role: 'Технологии',
        forkMin: null,
        forkMax: null,
        grade: null,
      }),
    )

    const members = (await db.execute(sql`select id, name, role from core.member order by id`)).rows
    expect(members).toEqual([{ id, name: 'Антон Сидоров', role: 'Технологии' }])
  })

  it('EARS-9: an email that is another member’s alias is refused by name, and nothing is written', async () => {
    const igor = await seedMember({ email: 'igor@bbm.academy', name: 'Игорь Пирогов' })
    await fixtureWrite((tx) =>
      tx.execute(
        sql`insert into core.member_alias (member_id, kind, value)
            values (${igor}, 'email_personal', 'dobroyar@gmail.com')`,
      ),
    )

    const result = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      upsertParticipant(doc, {
        email: 'dobroyar@gmail.com',
        name: 'Кто-то',
        role: null,
        forkMin: null,
        forkMax: null,
        grade: null,
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toContain('Игорь Пирогов')
    expect(result.error).toContain('dobroyar@gmail.com')
    const count = (await db.execute(sql`select count(*)::int as n from core.member`)).rows[0]
    expect(count).toEqual({ n: 1 })
  })

  it('EARS-3: fork, grade and the «только часы» nulls live on hours_participant, never on member', async () => {
    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      upsertParticipant(doc, {
        email: 'anton@bbm.academy',
        name: 'Антон',
        role: null,
        forkMin: 150_000,
        forkMax: 250_000,
        grade: 'II',
      }),
    )
    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      upsertParticipant(doc, {
        email: 'eduard@bbm.academy',
        name: 'Эдуард',
        role: null,
        forkMin: null,
        forkMax: null,
        grade: null,
      }),
    )

    const rows = (
      await db.execute(sql`select m.email, p.fork_min, p.fork_max, p.grade
                           from core.hours_participant p join core.member m on m.id = p.member_id
                           order by p.sort_key`)
    ).rows
    expect(rows).toEqual([
      { email: 'anton@bbm.academy', fork_min: 150_000, fork_max: 250_000, grade: 'II' },
      { email: 'eduard@bbm.academy', fork_min: null, fork_max: null, grade: null },
    ])

    const memberColumns = (
      await db.execute(sql`select column_name from information_schema.columns
                           where table_schema = 'core' and table_name = 'member'`)
    ).rows.map((row) => (row as { column_name: string }).column_name)
    expect(memberColumns).not.toContain('fork_min')
    expect(memberColumns).not.toContain('grade')
  })
})

describe('assessments (EARS-4, EARS-28)', () => {
  async function seedOpenPeriod(): Promise<number> {
    const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
    await fixtureWrite((tx) =>
      tx.execute(
        sql`insert into core.hours_participant (member_id, fork_min, fork_max, grade, sort_key)
            values (${id}, 300000, 400000, 'III', 0)`,
      ),
    )
    await seedPeriod({
      id: 'p-july',
      label: 'Июль 2026',
      from: '2026-07-01',
      to: '2026-07-31',
      status: 'open',
    })
    return id
  }

  it('EARS-4: a save round-trips the unrounded hourly_rate digit-for-digit', async () => {
    await seedOpenPeriod()
    const result = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      saveAssessment(
        doc,
        {
          periodId: 'p-july',
          email: 'anton@bbm.academy',
          hours: 100,
          method: 'period',
          weekendHours: 0,
          splitPercent: 30,
        },
        '2026-08-01T10:00:00.000Z',
      ),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    const stored = assessmentOf(await readHoursDocument(), 'p-july', 'anton@bbm.academy')
    // Every field, including the snapshots, comes back exactly as the domain
    // computed it — `toEqual` over the whole record is the round-trip assertion.
    expect(stored).toEqual(result.saved)
    // And the rate is genuinely UNROUNDED: the spec's column table names
    // `1163.0465116279069` as the reason it may not be `numeric`, which
    // re-serializes such a value differently.
    expect(String(stored?.hourly_rate).split('.')[1]?.length ?? 0).toBeGreaterThan(6)
    expect(String(stored?.hourly_rate)).toBe(String(result.saved.hourly_rate))
  })

  it('EARS-4: a re-save is an upsert on (period, member) — one row, snapshots re-frozen', async () => {
    await seedOpenPeriod()
    const save = (hours: number, at: string) =>
      mutateHoursDocument(TEST_ACTOR, (doc) =>
        saveAssessment(
          doc,
          {
            periodId: 'p-july',
            email: 'anton@bbm.academy',
            hours,
            method: 'period',
            weekendHours: 0,
            splitPercent: 30,
          },
          at,
        ),
      )

    await save(100, '2026-08-01T10:00:00.000Z')
    await save(120.5, '2026-08-02T10:00:00.000Z')

    const doc = await readHoursDocument()
    expect(doc.assessments).toHaveLength(1)
    expect(doc.assessments[0]).toMatchObject({
      hours: 120.5,
      saved_at: '2026-08-02T10:00:00.000Z',
    })
    const rows = (await db.execute(sql`select count(*)::int as n from core.hours_assessment`)).rows
    expect(rows[0]).toEqual({ n: 1 })
  })

  it('EARS-4: fractional hours, weekend hours and split percent survive the round-trip', async () => {
    await seedOpenPeriod()
    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      saveAssessment(
        doc,
        {
          periodId: 'p-july',
          email: 'anton@bbm.academy',
          hours: 96.5,
          method: 'week',
          weekendHours: 4.5,
          splitPercent: 33.5,
        },
        '2026-08-01T10:00:00.000Z',
      ),
    )
    const stored = assessmentOf(await readHoursDocument(), 'p-july', 'anton@bbm.academy')
    expect(stored).toMatchObject({
      hours: 96.5,
      weekend_hours: 4.5,
      split_percent: 33.5,
      method: 'week',
    })
  })

  it('EARS-28: a participant without fork and grade saves in «только часы» mode — null rate, zero money', async () => {
    const id = await seedMember({ email: 'eduard@bbm.academy', name: 'Эдуард' })
    await seedParticipant(id, { sortKey: 0 })
    await seedPeriod({
      id: 'p-july',
      label: 'Июль 2026',
      from: '2026-07-01',
      to: '2026-07-31',
      status: 'open',
    })

    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      saveAssessment(
        doc,
        {
          periodId: 'p-july',
          email: 'eduard@bbm.academy',
          hours: 40,
          method: 'period',
          weekendHours: 0,
          splitPercent: 50,
        },
        '2026-08-01T10:00:00.000Z',
      ),
    )

    expect(assessmentOf(await readHoursDocument(), 'p-july', 'eduard@bbm.academy')).toMatchObject({
      monthly_rate: null,
      hourly_rate: null,
      accrual: 0,
      cash_amount: 0,
      invest_amount: 0,
    })
  })

  it('EARS-28: a logged-in non-participant has no participant row at all', async () => {
    await seedMember({ email: 'guest@bbm.academy', name: 'Гость' })
    const doc = await readHoursDocument()
    expect(participantOf(doc, 'guest@bbm.academy')).toBeUndefined()
  })
})

describe('periods (EARS-5, EARS-29, EARS-30)', () => {
  it('EARS-5: text ISO dates round-trip with no timezone shift', async () => {
    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      createPeriod(
        doc,
        { label: 'Январь 2026', dateFrom: '2026-01-01', dateTo: '2026-01-31' },
        'p-jan',
      ),
    )
    const [period] = (await readHoursDocument()).periods
    expect(period).toEqual({
      id: 'p-jan',
      label: 'Январь 2026',
      date_from: '2026-01-01',
      date_to: '2026-01-31',
      status: 'closed',
    })
  })

  it('EARS-5: a second open period is refused with today’s message and the first stays open', async () => {
    await seedPeriod({
      id: 'p-july',
      label: 'Июль 2026',
      from: '2026-07-01',
      to: '2026-07-31',
      status: 'open',
      sortKey: 0,
    })
    await seedPeriod({
      id: 'p-august',
      label: 'Август 2026',
      from: '2026-08-01',
      to: '2026-08-31',
      sortKey: 1,
    })

    const result = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      setPeriodStatus(doc, 'p-august', 'open'),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('Уже открыт период «Июль 2026» — сначала закрой его.')

    const doc = await readHoursDocument()
    expect(doc.periods.map((p) => p.status)).toEqual(['open', 'closed'])
  })

  it('EARS-29: a save into a closed period is refused; reopening works while nothing else is open', async () => {
    const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
    await seedParticipant(id, { sortKey: 0 })
    await seedPeriod({ id: 'p-july', label: 'Июль 2026', from: '2026-07-01', to: '2026-07-31' })

    const refused = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      saveAssessment(
        doc,
        {
          periodId: 'p-july',
          email: 'anton@bbm.academy',
          hours: 10,
          method: 'period',
          weekendHours: 0,
          splitPercent: 0,
        },
        '2026-08-01T10:00:00.000Z',
      ),
    )
    expect(refused.ok).toBe(false)
    expect((await readHoursDocument()).assessments).toHaveLength(0)

    const reopened = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      setPeriodStatus(doc, 'p-july', 'open'),
    )
    expect(reopened.ok).toBe(true)
    expect((await readHoursDocument()).periods[0].status).toBe('open')
  })

  it('EARS-30: a date change recomputes every assessment of the period from its stored monthly_rate', async () => {
    const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
    await fixtureWrite((tx) =>
      tx.execute(
        sql`insert into core.hours_participant (member_id, fork_min, fork_max, grade, sort_key)
            values (${id}, 300000, 400000, 'III', 0)`,
      ),
    )
    await seedPeriod({
      id: 'p-july',
      label: 'Июль 2026',
      from: '2026-07-01',
      to: '2026-07-31',
      status: 'open',
    })
    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      saveAssessment(
        doc,
        {
          periodId: 'p-july',
          email: 'anton@bbm.academy',
          hours: 40,
          method: 'period',
          weekendHours: 0,
          splitPercent: 50,
        },
        '2026-08-01T10:00:00.000Z',
      ),
    )
    const before = assessmentOf(await readHoursDocument(), 'p-july', 'anton@bbm.academy')

    // The participant's fork is raised AFTER the save: the recompute must not see it.
    await fixtureWrite((tx) =>
      tx.execute(sql`update core.hours_participant set fork_min = 900000, fork_max = 900000`),
    )

    const result = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      updatePeriod(doc, {
        id: 'p-july',
        label: 'Июль 2026',
        dateFrom: '2026-07-01',
        dateTo: '2026-08-31',
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.warnings.join(' ')).toContain('Пересчитано по новым датам: 1')

    const after = assessmentOf(await readHoursDocument(), 'p-july', 'anton@bbm.academy')
    // The rate snapshot is the SOURCE of the recompute and is itself untouched —
    // the fork raised a moment ago (900 000) must be nowhere in these numbers.
    expect(after?.monthly_rate).toBe(before?.monthly_rate)
    expect(after?.monthly_rate).not.toBe(900_000)
    // Only the calendar-derived fields moved, in the 081 §6 rounding order.
    expect(after?.weekday_count).toBeGreaterThan(before!.weekday_count)
    expect(after?.hourly_rate).not.toBe(before?.hourly_rate)
    expect(after?.accrual).toBe(Math.round(after!.hours * after!.hourly_rate!))
    expect(after?.invest_amount).toBe(Math.round((after!.accrual * after!.split_percent) / 100))
    expect(after?.cash_amount).toBe(after!.accrual - after!.invest_amount)
  })

  it('EARS-21: deleting a period removes its row and leaves the rest of the order intact', async () => {
    await seedPeriod({
      id: 'p-july',
      label: 'Июль',
      from: '2026-07-01',
      to: '2026-07-31',
      sortKey: 0,
    })
    await seedPeriod({
      id: 'p-august',
      label: 'Август',
      from: '2026-08-01',
      to: '2026-08-31',
      sortKey: 1,
    })
    await seedPeriod({
      id: 'p-september',
      label: 'Сентябрь',
      from: '2026-09-01',
      to: '2026-09-30',
      sortKey: 2,
    })

    const result = await mutateHoursDocument(TEST_ACTOR, (doc) => deletePeriod(doc, 'p-august'))
    expect(result.ok).toBe(true)
    expect((await readHoursDocument()).periods.map((p) => p.id)).toEqual(['p-july', 'p-september'])
  })
})

describe('constraints map to readable refusals (EARS-20)', () => {
  /**
   * The domain validation fires FIRST in every normal flow, so these cases write
   * AROUND it — a mutator that hands the store a document the pure validation
   * would never produce. That is the only way to reach the constraint that is the
   * structural backstop beneath the advisory lock (EARS-10), and the point of
   * EARS-20 is that reaching it still yields a sentence, never a 500.
   */
  function force(doc: HoursDocument, next: HoursDocument) {
    return { ok: true as const, doc: next, warnings: [], saved: null }
  }

  it('EARS-20: two open periods forced past the validation hit the partial unique index, not a 500', async () => {
    await seedPeriod({
      id: 'p-july',
      label: 'Июль 2026',
      from: '2026-07-01',
      to: '2026-07-31',
      status: 'open',
      sortKey: 0,
    })
    await seedPeriod({
      id: 'p-august',
      label: 'Август 2026',
      from: '2026-08-01',
      to: '2026-08-31',
      sortKey: 1,
    })

    const result = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      force(doc, {
        ...doc,
        periods: doc.periods.map((period) => ({ ...period, status: 'open' as const })),
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toContain('Уже открыт период')
    expect((await readHoursDocument()).periods.map((p) => p.status)).toEqual(['open', 'closed'])
  })

  it('EARS-20: a document carrying two assessments for one (period, member) cannot produce a second row', async () => {
    const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
    await seedParticipant(id, { sortKey: 0 })
    await seedPeriod({
      id: 'p-july',
      label: 'Июль 2026',
      from: '2026-07-01',
      to: '2026-07-31',
      status: 'open',
    })
    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      saveAssessment(
        doc,
        {
          periodId: 'p-july',
          email: 'anton@bbm.academy',
          hours: 10,
          method: 'period',
          weekendHours: 0,
          splitPercent: 0,
        },
        '2026-08-01T10:00:00.000Z',
      ),
    )

    // The (period, member) UNIQUE index of EARS-4 is enforced as an UPSERT, so a
    // duplicated record collapses onto the one row rather than raising — the
    // constraint stays the structural backstop, and the observable contract is
    // «one row per (period, member)», never a 500. The sentence each constraint
    // WOULD produce if it fired is covered by `tests/unit/hours-core-refusals.spec.ts`.
    const result = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      force(doc, {
        ...doc,
        assessments: [...doc.assessments, { ...doc.assessments[0], hours: 20 }],
      }),
    )
    expect(result.ok).toBe(true)
    const doc = await readHoursDocument()
    expect(doc.assessments).toHaveLength(1)
    expect(doc.assessments[0].hours).toBe(20)
  })

  it('EARS-20: an assessment for an unknown period gets a sentence, not a raw FK error', async () => {
    const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
    await seedParticipant(id, { sortKey: 0 })

    const result = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      force(doc, {
        ...doc,
        assessments: [
          {
            period_id: 'p-ghost',
            email: 'anton@bbm.academy',
            hours: 1,
            method: 'period',
            weekend_hours: 0,
            split_percent: 0,
            monthly_rate: null,
            hourly_rate: null,
            accrual: 0,
            cash_amount: 0,
            invest_amount: 0,
            weekday_count: 1,
            saved_at: '2026-08-01T10:00:00.000Z',
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toContain('Период')
    expect(result.error).not.toContain('violates foreign key')
  })

  it('EARS-20: an out-of-vocabulary grade forced past the validation gets a sentence', async () => {
    const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
    await seedParticipant(id, { sortKey: 0 })

    const result = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      force(doc, {
        ...doc,
        participants: doc.participants.map((participant) => ({
          ...participant,
          grade: 'IV' as never,
        })),
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).not.toContain('violates check constraint')
    expect(result.error.length).toBeGreaterThan(10)
  })
})
