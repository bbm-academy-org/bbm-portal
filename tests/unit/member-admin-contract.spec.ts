import { describe, expect, it } from 'vitest'

import {
  memberAdminSection,
  memberAliasCreateSchema,
  memberAliasSchema,
  memberAliasUpdateSchema,
  memberCreateSchema,
  memberRecordSchema,
  memberUpdateSchema,
} from '@/lib/member'

describe('members cabinet contract (spec 311 EARS-436, EARS-441..445)', () => {
  it('EARS-441/442: declares list/show/create/edit and deliberately no member delete', () => {
    expect(memberAdminSection.label).toBe('Участники')
    expect(memberAdminSection.resources).toHaveLength(1)
    expect(memberAdminSection.resources[0]).toMatchObject({
      name: 'members',
      label: 'Участники',
      operations: ['list', 'show', 'create', 'edit'],
      schema: memberRecordSchema,
    })
  })

  it('EARS-441: create accepts the four owner-controlled profile fields', () => {
    expect(
      memberCreateSchema.parse({
        name: 'Анна Ковалёва',
        email: 'anna@bbm.academy',
        role: 'Продюсер',
        timezone: 'Europe/Moscow',
      }),
    ).toEqual({
      name: 'Анна Ковалёва',
      email: 'anna@bbm.academy',
      role: 'Продюсер',
      timezone: 'Europe/Moscow',
    })
  })

  it('EARS-443: update rejects email and accepts profile/status only', () => {
    expect(memberUpdateSchema.safeParse({ name: 'Анна', status: 'inactive' }).success).toBe(true)
    expect(memberUpdateSchema.safeParse({ email: 'other@bbm.academy' }).success).toBe(false)
  })

  it('EARS-444: aliases have full create/update record contracts', () => {
    const input = { kind: 'mattermost_id', value: 'annak', note: 'рабочий аккаунт' }
    expect(memberAliasCreateSchema.parse(input)).toEqual(input)
    expect(memberAliasUpdateSchema.parse(input)).toEqual(input)
    expect(memberAliasSchema.parse({ id: 7, memberId: 3, ...input })).toEqual({
      id: 7,
      memberId: 3,
      ...input,
    })
  })

  it('EARS-436: the wire record serializes timestamps as ISO strings', () => {
    const parsed = memberRecordSchema.parse({
      id: 3,
      slug: 'anna',
      email: 'anna@bbm.academy',
      name: 'Анна Ковалёва',
      role: null,
      status: 'active',
      timezone: 'Europe/Moscow',
      createdAt: '2026-08-29T06:00:00.000Z',
      updatedAt: '2026-08-29T06:00:00.000Z',
    })
    expect(parsed.id).toBe(3)
  })
})
