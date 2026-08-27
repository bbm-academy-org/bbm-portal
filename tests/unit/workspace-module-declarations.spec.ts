import { describe, expect, it, vi } from 'vitest'

/**
 * What the two live modules declare, and what their pulses actually say
 * (spec 311 EARS-401, EARS-406).
 *
 * The providers are mocked at the module's own data door — `readHoursDocument`
 * and `getOkrTree` — because what is under test is the SENTENCE the module
 * publishes, not the storage behind it.
 */

vi.mock('@/lib/hours/store-core', () => ({
  readHoursDocument: async () => ({
    participants: [],
    periods: [
      {
        id: 'p1',
        label: 'июль 2026',
        date_from: '2026-07-01',
        date_to: '2026-07-31',
        status: 'closed',
      },
      {
        id: 'p2',
        label: 'август 2026',
        date_from: '2026-08-01',
        date_to: '2026-08-31',
        status: 'open',
      },
    ],
    assessments: [],
  }),
}))

const okrTree = {
  goalTitle: 'Цель',
  period: { start: '2026-07-01', end: '2026-09-01' },
  asOf: '2026-08-26T00:00:00.000Z',
  stale: false,
  pct: 0.5,
  objectives: [
    { id: 'o1', q4: false, pct: 0.4 },
    { id: 'o2', q4: false, pct: null },
    { id: 'o3', q4: true, pct: null },
  ],
  offTreeNotes: [],
  warnings: [],
}

vi.mock('@/lib/okr/cache', () => ({
  getOkrTree: async () => okrTree,
  OkrUnavailableError: class extends Error {},
}))

describe('the hours declaration (spec 311 EARS-401, EARS-406)', () => {
  it('EARS-406: names the open period and the day it is open until', async () => {
    const { hoursStatusLine, hoursWorkspaceEntry, openUntilLabel } =
      await import('@/lib/hours/workspace')
    // An INCLUSIVE last day of 31 August means «открыт до 1 сентября» — which is
    // also the sentence `design-source/p-launcher.html` draws.
    expect(openUntilLabel('2026-08-31')).toBe('1 сентября')
    expect(openUntilLabel('2026-12-31')).toBe('1 января')
    expect(await hoursStatusLine()).toBe('Период «август 2026» открыт до 1 сентября')
    expect(hoursWorkspaceEntry).toMatchObject({ kind: 'internal', slug: 'hours', href: '/p/hours' })
  })
})

describe('the OKR declaration (spec 311 EARS-401, EARS-406)', () => {
  it('EARS-406: counts the in-period objectives that actually have an assessment', async () => {
    const { okrStatusLine, okrWorkspaceEntry } = await import('@/lib/okr/workspace')
    // o3 is a Q4 goal — outside the period rollup — and o2 has no number behind
    // it, which the OKR module calls «честная пустота» rather than 0%.
    expect(await okrStatusLine()).toBe('Цели квартала: 1 из 2 с оценкой')
    expect(okrWorkspaceEntry).toMatchObject({ kind: 'internal', slug: 'okr', href: '/p/okr' })
  })
})
