// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createMember,
  createMemberAlias,
  deleteMemberAlias,
  getMemberById,
  listAliases,
  MemberConflictError,
  updateMemberAlias,
  updateMemberProfile,
} from '@/lib/member'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { platformTransaction } from '@/lib/platform/db/transaction'

import { truncateAsFixture } from './privilege-helpers'

const ACTOR = { actorEmail: 'admin@bbm.academy', source: 'portal' } as const
const db = getPlatformDb()

function write<T>(
  fn: (tx: Parameters<Parameters<typeof platformTransaction>[1]>[0]) => Promise<T>,
) {
  return platformTransaction(ACTOR, fn)
}

beforeEach(async () => {
  await truncateAsFixture('truncate table core.member_alias, core.member restart identity cascade')
})

afterAll(async () => {
  await closePlatformDb()
})

describe('member cabinet public API (spec 311 EARS-441..445)', () => {
  it('EARS-441: creates and reads a normalized member through the public API', async () => {
    const created = await write((tx) =>
      createMember(
        {
          name: 'Анна Ковалёва',
          email: ' Anna@BBM.Academy ',
          role: 'Продюсер',
          timezone: 'Asia/Bangkok',
        },
        { db: tx },
      ),
    )

    expect(created).toMatchObject({
      email: 'anna@bbm.academy',
      slug: 'anna',
      status: 'active',
      timezone: 'Asia/Bangkok',
    })
    expect(await getMemberById(created.id)).toMatchObject({ id: created.id, name: 'Анна Ковалёва' })
  })

  it('EARS-442/445: deactivation changes status only and the module exposes no member delete', async () => {
    const created = await write((tx) =>
      createMember({ name: 'Анна', email: 'anna@bbm.academy' }, { db: tx }),
    )
    const before = await getMemberById(created.id)
    const updated = await write((tx) =>
      updateMemberProfile(created.id, { status: 'inactive' }, { db: tx }),
    )

    expect(updated).toMatchObject({
      id: before?.id,
      slug: before?.slug,
      email: before?.email,
      name: before?.name,
      role: before?.role,
      timezone: before?.timezone,
      createdAt: before?.createdAt,
      status: 'inactive',
    })
    const publicApi = await import('@/lib/member')
    expect('deleteMember' in publicApi).toBe(false)
  })

  it('EARS-444: creates, updates and deletes a nested alias', async () => {
    const member = await write((tx) =>
      createMember({ name: 'Анна', email: 'anna@bbm.academy' }, { db: tx }),
    )
    const alias = await write((tx) =>
      createMemberAlias(
        member.id,
        { kind: 'mattermost_id', value: ' AnnaK ', note: 'старый логин' },
        { db: tx },
      ),
    )
    expect(alias).toMatchObject({ memberId: member.id, value: 'annak' })

    const updated = await write((tx) =>
      updateMemberAlias(
        member.id,
        alias.id,
        { kind: 'mattermost_id', value: 'anna-new', note: null },
        { db: tx },
      ),
    )
    expect(updated).toMatchObject({ id: alias.id, value: 'anna-new', note: null })

    await expect(
      write((tx) => deleteMemberAlias(member.id, alias.id, { db: tx })),
    ).resolves.toMatchObject({
      id: alias.id,
    })
    expect(await listAliases(member.id)).toEqual([])
  })

  it('EARS-444/473: a normalized duplicate alias is refused naming its owner', async () => {
    const anna = await write((tx) =>
      createMember({ name: 'Анна Ковалёва', email: 'anna@bbm.academy' }, { db: tx }),
    )
    const petr = await write((tx) =>
      createMember({ name: 'Пётр Ильин', email: 'petr@bbm.academy' }, { db: tx }),
    )
    await write((tx) =>
      createMemberAlias(anna.id, { kind: 'mattermost_id', value: 'annak' }, { db: tx }),
    )

    const duplicate = write((tx) =>
      createMemberAlias(petr.id, { kind: 'mattermost_id', value: ' ANNAK ' }, { db: tx }),
    )
    await expect(duplicate).rejects.toBeInstanceOf(MemberConflictError)
    await expect(
      write((tx) =>
        createMemberAlias(petr.id, { kind: 'mattermost_id', value: ' ANNAK ' }, { db: tx }),
      ),
    ).rejects.toThrow(/Анна Ковалёва/)
  })

  it('EARS-439: writes are attributed and alias contact values stay out of the ledger (spec 201)', async () => {
    const member = await write((tx) =>
      createMember({ name: 'Анна', email: 'anna@bbm.academy' }, { db: tx }),
    )
    const phone = '+79991234567'
    await write((tx) =>
      createMemberAlias(member.id, { kind: 'phone', value: phone, note: 'личный' }, { db: tx }),
    )

    const events = await db.execute(sql`
      select table_name, event_type, actor_email, source, diff::text as diff
      from core.audit_event
      where actor_email = ${ACTOR.actorEmail}
        and table_name in ('member', 'member_alias')
      order by id desc
      limit 2
    `)
    expect(events.rows).toHaveLength(2)
    expect(events.rows.every((row) => row.actor_email === ACTOR.actorEmail)).toBe(true)
    expect(events.rows.every((row) => row.source === 'portal')).toBe(true)
    const aliasEvent = events.rows.find((row) => row.table_name === 'member_alias')
    expect(aliasEvent?.diff).toContain('"changed": true')
    expect(aliasEvent?.diff).not.toContain(phone)
    expect(aliasEvent?.diff).not.toContain('личный')
  })
})
