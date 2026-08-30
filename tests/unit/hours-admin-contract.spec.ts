import { describe, expect, it } from 'vitest'

import {
  hoursAdminSection,
  hoursParticipantCreateSchema,
  hoursParticipantUpdateSchema,
  hoursPeriodCreateSchema,
  hoursPeriodRecordSchema,
} from '@/lib/hours/admin-contract'

describe('hours cabinet contract (spec 311 EARS-421, EARS-446..452)', () => {
  it('EARS-446: declares exactly the three owner-approved cabinet resources', () => {
    expect(hoursAdminSection.label).toBe('Часы')
    expect(
      hoursAdminSection.resources.map(({ name, label, operations }) => ({
        name,
        label,
        operations,
      })),
    ).toEqual([
      {
        name: 'periods',
        label: 'Периоды',
        operations: ['list', 'create', 'edit', 'delete'],
      },
      {
        name: 'participants',
        label: 'Ставки и грейды',
        operations: ['list', 'create', 'edit'],
      },
      { name: 'publication', label: 'Публикация в Mattermost', operations: ['list'] },
    ])
  })

  it('keeps assessments read-only inside a period record', () => {
    const record = hoursPeriodRecordSchema.parse({
      id: '2026-08',
      label: 'Август 2026',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      status: 'closed',
      locked: true,
      assessments: [],
      publicationStatus: 'published',
    })
    expect(record.assessments).toEqual([])
    expect(hoursAdminSection.resources.some((resource) => resource.name === 'assessments')).toBe(
      false,
    )
  })

  it('validates period dates and rejects fields outside the handwritten contract', () => {
    expect(
      hoursPeriodCreateSchema.safeParse({
        label: 'Август 2026',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
      }).success,
    ).toBe(true)
    expect(
      hoursPeriodCreateSchema.safeParse({
        label: 'Август 2026',
        dateFrom: '01.08.2026',
        dateTo: '2026-08-31',
        status: 'open',
      }).success,
    ).toBe(false)
  })

  it('makes participant email immutable after create', () => {
    const profile = {
      name: 'Анна',
      role: 'Продюсер',
      forkMin: 100_000,
      forkMax: 160_000,
      grade: 'II',
    }
    expect(
      hoursParticipantCreateSchema.safeParse({ email: 'anna@bbm.academy', ...profile }).success,
    ).toBe(true)
    expect(hoursParticipantUpdateSchema.safeParse(profile).success).toBe(true)
    expect(
      hoursParticipantUpdateSchema.safeParse({ email: 'other@bbm.academy', ...profile }).success,
    ).toBe(false)
  })
})
