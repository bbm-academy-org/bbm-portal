// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { listAliases, listMembers, MemberConflictError } from '@/lib/member'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { parseMemberDataset, seedMembers } from '../../../tools/platform/member-seed'
import { truncateAsFixture } from './privilege-helpers'

/**
 * The member seed of the cutover (spec 124 EARS-14), against the REAL `core`
 * schema.
 *
 * EARS-14 says the registry is seeded ONCE, by hand, from a consolidated dataset
 * that is deliberately never committed (personal data next to salary data). What
 * IS committed is the mechanics — an idempotent upsert by normalized email plus
 * insert-if-missing aliases — and that is what this spec pins, on obviously fake
 * people under `./fixtures/`. The dataset the owner applies at cutover has the
 * same shape and lives only on the box (`docs/runbooks/hours-core-cutover.md`).
 *
 * Integration tier because every guarantee here is the DATABASE's: the
 * `lower(btrim(email))` CHECK, the unique index on (`kind`, normalized value)
 * that makes «one handle, one person» true, and the single transaction that makes
 * a refused seed write nothing at all.
 *
 * Needs `PLATFORM_DATABASE_URL` (this worktree's branch DB — see
 * `.claude/rules/parallel-sessions.md`, "Platform database"), loaded from `.env`
 * by `vitest.setup.ts`. Run: `pnpm exec vitest run tests/int/platform`.
 */

const db = getPlatformDb()

function dataset(name: string) {
  return parseMemberDataset(
    JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as unknown,
  )
}

beforeEach(async () => {
  await truncateAsFixture(`truncate table core.member_alias, core.member restart identity cascade`)
})

afterAll(async () => {
  await closePlatformDb()
})

describe('the manual member seed (EARS-14)', () => {
  it('EARS-14: seeds the consolidated dataset — normalized emails, derived slugs, aliases', async () => {
    const summary = await seedMembers(dataset('member-seed.json'))

    expect(summary.members).toEqual({ created: 4, updated: 0, unchanged: 0 })
    expect(summary.aliases).toEqual({ inserted: 4, present: 0 })
    expect(summary.dryRun).toBe(false)

    const members = await listMembers()
    expect(members.map((member) => member.email)).toEqual([
      'vasya.pupkin@bbm.academy',
      'lena.testova@bbm.academy',
      'petr.fakov@bbm.academy',
      'nina.nevchasah@bbm.academy',
    ])
    // Defaults come from the column defaults; an explicit value in the dataset wins.
    expect(members[0]).toMatchObject({
      slug: 'vasya-pupkin',
      name: 'Вася Пупкин',
      role: 'Разработчик',
      status: 'active',
      timezone: 'Europe/Moscow',
    })
    expect(members[1]).toMatchObject({ timezone: 'Asia/Novosibirsk' })
    expect(members[3]).toMatchObject({ slug: 'nina-registry', status: 'inactive' })

    // Aliases are stored NORMALIZED, so the unique index and the lookup agree.
    const aliases = await listAliases(members[0].id)
    expect(aliases.map((alias) => [alias.kind, alias.value, alias.note])).toEqual([
      ['mattermost_id', 'vasyap', null],
      ['telegram', 'vasya_p', 'личный'],
    ])
  })

  it('EARS-14: a second run of the same dataset is a no-op — ids and aliases stay put', async () => {
    await seedMembers(dataset('member-seed.json'))
    const before = await listMembers()

    const summary = await seedMembers(dataset('member-seed.json'))

    expect(summary.members).toEqual({ created: 0, updated: 0, unchanged: 4 })
    expect(summary.aliases).toEqual({ inserted: 0, present: 4 })
    const after = await listMembers()
    expect(after.map((member) => member.id)).toEqual(before.map((member) => member.id))
    expect(after.map((member) => member.email)).toEqual(before.map((member) => member.email))
    expect(await listAliases(after[0].id)).toHaveLength(2)
  })

  it('EARS-14: a corrected dataset updates name, role, status and timezone and adds only the new alias', async () => {
    await seedMembers(dataset('member-seed.json'))
    const [vasyaBefore] = await listMembers()

    const summary = await seedMembers(dataset('member-seed-updated.json'))

    expect(summary.members).toEqual({ created: 0, updated: 1, unchanged: 1 })
    expect(summary.aliases).toEqual({ inserted: 1, present: 2 })

    const members = await listMembers()
    expect(members).toHaveLength(4) // nothing is deleted by a narrower dataset
    const vasya = members.find((member) => member.email === 'vasya.pupkin@bbm.academy')!
    expect(vasya.id).toBe(vasyaBefore.id)
    expect(vasya).toMatchObject({
      name: 'Вася Пупкин-Второй',
      role: 'Тимлид',
      status: 'inactive',
      timezone: 'Asia/Novosibirsk',
    })
    // `VASYAP` normalizes onto the alias that is already there; `zoom_id` is new.
    expect((await listAliases(vasya.id)).map((alias) => alias.kind)).toEqual([
      'mattermost_id',
      'telegram',
      'zoom_id',
    ])
  })

  it('EARS-14: refuses one normalized alias claimed by two people, naming them, and writes nothing', async () => {
    const run = seedMembers(dataset('member-seed-duplicate-alias.json'))

    await expect(run).rejects.toBeInstanceOf(MemberConflictError)
    await expect(run).rejects.toThrow(/Вася Пупкин/)
    // ONE transaction: the first member of the dataset does not survive the refusal.
    expect(await listMembers()).toHaveLength(0)
  })

  it('EARS-14: --dry-run reports the whole plan and leaves the registry empty', async () => {
    const summary = await seedMembers(dataset('member-seed.json'), { dryRun: true })

    expect(summary.dryRun).toBe(true)
    expect(summary.members).toEqual({ created: 4, updated: 0, unchanged: 0 })
    expect(summary.aliases).toEqual({ inserted: 4, present: 0 })
    expect(await listMembers()).toHaveLength(0)
    expect(
      (
        (await db.execute(sql`select count(*)::int as n from core.member_alias`)).rows as Array<{
          n: number
        }>
      )[0].n,
    ).toBe(0)
  })
})

describe('the seed dataset parser', () => {
  it('refuses a dataset that is not { members: [...] }', () => {
    expect(() => parseMemberDataset({})).toThrow(/members/)
    expect(() => parseMemberDataset({ members: {} })).toThrow(/members/)
  })

  it('names the offending entry when a member has no email or no name', () => {
    expect(() => parseMemberDataset({ members: [{ name: 'Без почты' }] })).toThrow(/members\[0\]/)
    expect(() => parseMemberDataset({ members: [{ email: 'a@bbm.academy' }] })).toThrow(
      /members\[0\].*name/s,
    )
  })

  it('refuses an alias with no kind or no value', () => {
    expect(() =>
      parseMemberDataset({
        members: [{ email: 'a@bbm.academy', name: 'А', aliases: [{ kind: 'telegram' }] }],
      }),
    ).toThrow(/aliases\[0\]/)
  })

  it('refuses a status outside the CHECK, rather than letting the database say it', () => {
    expect(() =>
      parseMemberDataset({ members: [{ email: 'a@bbm.academy', name: 'А', status: 'retired' }] }),
    ).toThrow(/status/)
  })
})
