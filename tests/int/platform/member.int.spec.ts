// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import * as memberModule from '@/lib/member'
import {
  ensureMemberByEmail,
  findMemberByEmail,
  findMemberOwningAliasValue,
  getMembersByIds,
  listAliases,
  listMembers,
  MemberConflictError,
  resolveMember,
  updateMemberProfile,
} from '@/lib/member'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { platformTransaction } from '@/lib/platform/db/transaction'

/**
 * The member module against a REAL `core` schema (spec 124 EARS-2, EARS-17,
 * EARS-18, EARS-19).
 *
 * This tier exists because half of the contract is the DATABASE's: the
 * `CHECK (email = lower(btrim(email)))` on `core.member` and the unique index on
 * the expression (`kind`, `lower(btrim(value))`) on `core.member_alias` are the
 * reason the SQL escape hatch of EARS-19 cannot detach a person from their rate.
 * A mock would assert the module's opinion of those constraints, not the
 * constraints themselves.
 *
 * Needs `PLATFORM_DATABASE_URL` (this worktree's branch DB — see
 * `.claude/rules/parallel-sessions.md`, "Platform database"), loaded from `.env`
 * by `vitest.setup.ts`. Run: `pnpm exec vitest run tests/int/platform`.
 */

const db = getPlatformDb()

/**
 * Кто пишет (спека 201 EARS-7, EARS-25). `getPlatformDb()` — помеченный пул
 * приложения (EARS-26), поэтому ЛЮБАЯ запись в аудируемую таблицу отсюда обязана
 * ехать в транзакции с аудит-контекстом; без него её отклонит
 * `core.audit_row_change()`. Реестр правит владелец через админку часов, так что
 * дверь тут та же, что у Server Action: `portal` + его email.
 */
const TEST_ACTOR = { actorEmail: 'anton@bbm.academy', source: 'portal' } as const

/** Одна запись в реестр = одна транзакция под аудит-контекстом. */
function asOwner<T>(
  fn: (tx: Parameters<Parameters<typeof platformTransaction>[1]>[0]) => Promise<T>,
) {
  return platformTransaction(TEST_ACTOR, fn)
}

/** `ensureMemberByEmail` через свою транзакцию — форма, которой пишет продукт. */
function ensureMember(input: { email: string; name: string; role?: string | null }) {
  return asOwner((tx) => ensureMemberByEmail(input, { db: tx }))
}

/**
 * The SQLSTATE of a failed query. drizzle wraps a pg error in its own
 * `DrizzleQueryError` and puts the original on `cause`, so reading `.code` off the
 * thrown object alone finds `undefined` on every real constraint violation —
 * i.e. the assertion would pass for the wrong reason. Unwrapped here, and in the
 * module itself (`src/lib/member/repository.ts`, `pgErrorCode`).
 */
function sqlState(err: unknown): string | undefined {
  const node = err as { code?: string; cause?: unknown } | undefined
  if (typeof node?.code === 'string') return node.code
  return node?.cause ? sqlState(node.cause) : undefined
}

async function seedAlias(memberId: number, kind: string, value: string, note?: string) {
  await asOwner((tx) =>
    tx.execute(
      sql`insert into core.member_alias (member_id, kind, value, note)
          values (${memberId}, ${kind}, ${value}, ${note ?? null})`,
    ),
  )
}

beforeEach(async () => {
  await db.execute(sql`truncate table core.member_alias, core.member restart identity cascade`)
})

afterAll(async () => {
  await closePlatformDb()
})

describe('core.member', () => {
  it('EARS-2: the DB refuses a non-normalized email — a hand-typed Anton@BBM.Academy cannot be stored', async () => {
    const insert = db.execute(
      sql`insert into core.member (slug, email, name) values ('anton', 'Anton@BBM.Academy', 'Антон')`,
    )
    await expect(insert).rejects.toSatisfy((err: unknown) => sqlState(err) === '23514')
    expect(await listMembers()).toHaveLength(0)
  })

  it('EARS-2: a member row carries slug/email uniqueness, a checked status, active + Europe/Moscow by default', async () => {
    const created = await ensureMember({ email: ' Anton@BBM.Academy ', name: 'Антон' })
    expect(created).toMatchObject({
      slug: 'anton',
      email: 'anton@bbm.academy',
      name: 'Антон',
      role: null,
      status: 'active',
      timezone: 'Europe/Moscow',
    })
    expect(created.id).toBeGreaterThan(0)

    await expect(
      db.execute(
        sql`insert into core.member (slug, email, name) values ('anton-again', 'anton@bbm.academy', 'Антон')`,
      ),
    ).rejects.toSatisfy((err: unknown) => sqlState(err) === '23505')

    await expect(
      db.execute(
        sql`insert into core.member (slug, email, name) values ('anton', 'other@bbm.academy', 'Другой')`,
      ),
    ).rejects.toSatisfy((err: unknown) => sqlState(err) === '23505')

    await expect(
      db.execute(
        sql`insert into core.member (slug, email, name, status) values ('x', 'x@bbm.academy', 'X', 'archived')`,
      ),
    ).rejects.toSatisfy((err: unknown) => sqlState(err) === '23514')
  })

  it('EARS-2: money attributes do NOT live on member', async () => {
    const { rows } = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_schema = 'core' and table_name = 'member'`,
    )
    const columns = rows.map((r) => r.column_name)
    expect(columns.sort()).toEqual([
      'created_at',
      'email',
      'id',
      'name',
      'role',
      'slug',
      'status',
      'timezone',
      'updated_at',
    ])
  })

  it('EARS-2: ensureMemberByEmail appends a numeric suffix on slug collision instead of surfacing a constraint error', async () => {
    const first = await ensureMember({ email: 'anton@bbm.academy', name: 'Антон' })
    const second = await ensureMember({ email: 'anton@doctor.school', name: 'Антон Второй' })
    const third = await ensureMember({ email: 'Anton@zoom.us', name: 'Антон Третий' })

    expect([first.slug, second.slug, third.slug]).toEqual(['anton', 'anton-2', 'anton-3'])
  })

  it('EARS-2: ensureMemberByEmail is idempotent on a known email and never renames it', async () => {
    const created = await ensureMember({ email: 'anton@bbm.academy', name: 'Антон' })
    const again = await ensureMember({ email: ' ANTON@bbm.academy ', name: 'Antoshka' })

    expect(again.id).toBe(created.id)
    expect(again.slug).toBe('anton')
    expect(await listMembers()).toHaveLength(1)
  })

  it('updateMemberProfile writes both name and role on the shared registry', async () => {
    const created = await ensureMember({ email: 'igor@bbm.academy', name: 'Игорь' })
    const updated = await asOwner((tx) =>
      updateMemberProfile(created.id, { name: 'Игорь Пирогов', role: 'CTO' }, { db: tx }),
    )

    expect(updated).toMatchObject({ id: created.id, name: 'Игорь Пирогов', role: 'CTO' })
    expect(await findMemberByEmail('IGOR@bbm.academy ')).toMatchObject({ name: 'Игорь Пирогов' })
  })

  it('EARS-2: a member created inside a caller transaction rolls back with it', async () => {
    // The executor argument is the whole reason the signatures carry `{ db }`
    // (EARS-10): an hours mutation runs as ONE transaction under the module
    // advisory lock, and a member created by that save must not survive its
    // rollback. Asserted here rather than reasoned about, because it is also the
    // compile-time claim that a `tx` handle satisfies `MemberDb`.
    await expect(
      platformTransaction(TEST_ACTOR, async (tx) => {
        await ensureMemberByEmail({ email: 'ghost@bbm.academy', name: 'Призрак' }, { db: tx })
        expect(await findMemberByEmail('ghost@bbm.academy', { db: tx })).not.toBeNull()
        throw new Error('the hours save failed after the member was created')
      }),
    ).rejects.toThrow('the hours save failed')

    expect(await findMemberByEmail('ghost@bbm.academy')).toBeNull()
    expect(await listMembers()).toHaveLength(0)
  })

  it('listMembers and getMembersByIds return rows in a stable id order', async () => {
    const a = await ensureMember({ email: 'a@bbm.academy', name: 'A' })
    const b = await ensureMember({ email: 'b@bbm.academy', name: 'B' })
    const c = await ensureMember({ email: 'c@bbm.academy', name: 'C' })

    expect((await listMembers()).map((m) => m.email)).toEqual([
      'a@bbm.academy',
      'b@bbm.academy',
      'c@bbm.academy',
    ])
    expect((await getMembersByIds([c.id, a.id])).map((m) => m.id)).toEqual([a.id, c.id])
    expect(await getMembersByIds([])).toEqual([])
    expect(await getMembersByIds([b.id, 999999])).toHaveLength(1)
  })
})

describe('core.member_alias', () => {
  it('EARS-17: the normalized expression is unique per kind — Dobroyar cannot join dobroyar', async () => {
    const igor = await ensureMember({ email: 'igor@bbm.academy', name: 'Игорь Пирогов' })
    await seedAlias(igor.id, 'mattermost_id', 'dobroyar')

    const anton = await ensureMember({ email: 'anton@bbm.academy', name: 'Антон' })
    await expect(seedAlias(anton.id, 'mattermost_id', ' Dobroyar ')).rejects.toSatisfy(
      (err: unknown) => sqlState(err) === '23505',
    )
  })

  it('EARS-17: one member may hold several aliases of the same kind, and the same value under another kind is free', async () => {
    const igor = await ensureMember({ email: 'igor@bbm.academy', name: 'Игорь Пирогов' })
    await seedAlias(igor.id, 'phone', '+79990000001')
    await seedAlias(igor.id, 'phone', '+79990000002', 'рабочий')
    await seedAlias(igor.id, 'telegram', 'dobroyar')
    await seedAlias(igor.id, 'mattermost_id', 'dobroyar')

    const aliases = await listAliases(igor.id)
    expect(aliases.map((a) => `${a.kind}:${a.value}`)).toEqual([
      'phone:+79990000001',
      'phone:+79990000002',
      'telegram:dobroyar',
      'mattermost_id:dobroyar',
    ])
    expect(aliases[1]?.note).toBe('рабочий')
  })

  it('EARS-17: deleting a member cascades to its aliases', async () => {
    const igor = await ensureMember({ email: 'igor@bbm.academy', name: 'Игорь' })
    await seedAlias(igor.id, 'zoom_id', 'zoom-igor')
    await asOwner((tx) => tx.execute(sql`delete from core.member where id = ${igor.id}`))

    expect(await listAliases(igor.id)).toEqual([])
  })

  it('EARS-18: resolveMember finds a member by alias with normalized input (DoBroYar finds dobroyar)', async () => {
    const igor = await ensureMember({ email: 'igor@bbm.academy', name: 'Игорь Пирогов' })
    await seedAlias(igor.id, 'mattermost_id', 'dobroyar')

    expect(await resolveMember({ kind: 'mattermost_id', value: '  DoBroYar ' })).toMatchObject({
      id: igor.id,
      name: 'Игорь Пирогов',
    })
    expect(await resolveMember({ kind: 'telegram', value: 'dobroyar' })).toBeNull()
    expect(await resolveMember({ kind: 'mattermost_id', value: 'nobody' })).toBeNull()
  })

  it('EARS-18: resolveMember answers the virtual kind email off the canonical member email', async () => {
    const anton = await ensureMember({ email: 'anton@bbm.academy', name: 'Антон' })
    await ensureMember({ email: 'igor@bbm.academy', name: 'Игорь' })

    expect(await resolveMember({ kind: 'email', value: ' Anton@BBM.Academy ' })).toMatchObject({
      id: anton.id,
    })
    expect(await resolveMember({ kind: 'email', value: 'ghost@bbm.academy' })).toBeNull()
  })

  it('EARS-18: findMemberOwningAliasValue answers kind-agnostically — the email-vs-alias conflict lookup', async () => {
    const igor = await ensureMember({ email: 'igor@bbm.academy', name: 'Игорь Пирогов' })
    await seedAlias(igor.id, 'email_personal', 'dobroyar@gmail.com')

    const owner = await findMemberOwningAliasValue(' DobroYar@Gmail.com ')
    expect(owner?.member).toMatchObject({ id: igor.id, name: 'Игорь Пирогов' })
    expect(owner?.alias.kind).toBe('email_personal')
    expect(await findMemberOwningAliasValue('nobody@gmail.com')).toBeNull()

    await expect(
      ensureMember({ email: 'dobroyar@gmail.com', name: 'Кто-то' }),
    ).rejects.toBeInstanceOf(MemberConflictError)
    await expect(ensureMember({ email: 'dobroyar@gmail.com', name: 'Кто-то' })).rejects.toThrow(
      /Игорь Пирогов/,
    )
    expect(await listMembers()).toHaveLength(1)
  })

  it('EARS-19: aliases are seed/SQL-only this cycle — the only writer on the API is the cutover seed', () => {
    const aliasSurface = Object.keys(memberModule)
      .filter((name) => /alias/i.test(name))
      .sort()
    // Reads, plus ONE writer: `upsertMemberWithAliases`, the manual cutover seed
    // (EARS-14) — which is precisely the «seed» half of EARS-19's «seed and the
    // owner's SQL escape hatch». No per-alias `addAlias`/`removeAlias` on the API,
    // because that is the shape an admin UI would need and the UI arrives with
    // `/p/admin` (epic #112), not here.
    expect(aliasSurface).toEqual([
      'findMemberOwningAliasValue',
      'listAliases',
      'normalizeAliasValue',
      'upsertMemberWithAliases',
    ])
  })
})
