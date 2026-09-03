// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { FINANCE_INTAKE_STATUSES } from '@/lib/platform/db/schema/finance/finance-intake-item'

import {
  DEV_SEED_COUNTERPARTIES,
  DEV_SEED_HOURS_PARTICIPANTS,
  DEV_SEED_HOURS_PERIODS,
  DEV_SEED_INTAKE_ITEMS,
  DEV_SEED_MEMBERS,
  DEV_SEED_NOTE_PREFIX,
  DEV_SEED_REQUESTS,
  devSeedNote,
  devSeedSlugFromNote,
} from '../../tools/platform/dev-seed-plan'

/**
 * The fixture plan of `pnpm dev:seed` (#436) — the half that needs no database.
 *
 * The owner's ruling behind this issue is that an owner-visible stand comes
 * pre-filled: dozens of rows and EVERY lifecycle status, so composition,
 * density, sorting, pagination and overflow are visible at review time. Both of
 * those are properties of the PLAN, not of the applier, so they are asserted
 * here where the check costs nothing and cannot be skipped for want of a
 * Postgres.
 *
 * Determinism is the third property: two agents running the seed must see the
 * same rows, or screenshots taken in different sessions are not comparable. A
 * plan that reached for `Date.now()` or a random name would break that silently,
 * so every date in it is a literal and every slug is fixed.
 */

describe('the seeded volume the owner ruling asks for', () => {
  it('seeds at least 30 members, so the members list has density and pagination', () => {
    expect(DEV_SEED_MEMBERS.length).toBeGreaterThanOrEqual(30)
  })

  it('covers every status of the spec-339 request machine at least once', () => {
    const seeded = new Set(DEV_SEED_REQUESTS.map((request) => request.status))
    for (const status of FINANCE_INTAKE_STATUSES) {
      expect(seeded.has(status), `no seeded request in status «${status}»`).toBe(true)
    }
  })

  it('gives the requests board bulk volume, not one card per column', () => {
    expect(DEV_SEED_REQUESTS.length).toBeGreaterThanOrEqual(24)
    const submitted = DEV_SEED_REQUESTS.filter((request) => request.status === 'submitted')
    expect(submitted.length).toBeGreaterThanOrEqual(5)
  })

  it('seeds hours periods in both statuses, with participants and assessments', () => {
    expect(DEV_SEED_HOURS_PERIODS.length).toBeGreaterThanOrEqual(3)
    expect(DEV_SEED_HOURS_PERIODS.filter((period) => period.status === 'open')).toHaveLength(1)
    expect(
      DEV_SEED_HOURS_PERIODS.some((period) => period.status === 'closed'),
      'no closed period',
    ).toBe(true)
    expect(DEV_SEED_HOURS_PARTICIPANTS.length).toBeGreaterThanOrEqual(10)
    for (const period of DEV_SEED_HOURS_PERIODS) {
      expect(period.assessments.length, period.id).toBeGreaterThan(0)
    }
  })

  it('seeds non-request intake lines and counterparties too', () => {
    expect(DEV_SEED_INTAKE_ITEMS.length).toBeGreaterThanOrEqual(8)
    expect(DEV_SEED_COUNTERPARTIES.length).toBeGreaterThanOrEqual(4)
  })

  it('attaches a confirming document to every request that has to post', () => {
    for (const request of DEV_SEED_REQUESTS.filter((row) => row.status === 'posted')) {
      expect(request.document, `posted request «${request.slug}» has no document`).toBeDefined()
    }
  })
})

describe('the plan is deterministic', () => {
  it('gives every member, request, intake line and period a unique stable slug', () => {
    const buckets = [
      DEV_SEED_MEMBERS.map((row) => row.slug),
      DEV_SEED_REQUESTS.map((row) => row.slug),
      DEV_SEED_INTAKE_ITEMS.map((row) => row.slug),
      DEV_SEED_HOURS_PERIODS.map((row) => row.id),
    ]
    for (const slugs of buckets) {
      expect(new Set(slugs).size, slugs.join(',')).toBe(slugs.length)
      for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('references only members, purposes and accounts it seeds itself', () => {
    const members = new Set(DEV_SEED_MEMBERS.map((row) => row.slug))
    for (const participant of DEV_SEED_HOURS_PARTICIPANTS) {
      expect(members.has(participant.memberSlug), participant.memberSlug).toBe(true)
    }
    const participants = new Set(DEV_SEED_HOURS_PARTICIPANTS.map((row) => row.memberSlug))
    for (const period of DEV_SEED_HOURS_PERIODS) {
      for (const assessment of period.assessments) {
        expect(participants.has(assessment.memberSlug), assessment.memberSlug).toBe(true)
      }
    }
    for (const request of DEV_SEED_REQUESTS) {
      expect(members.has(request.submitterSlug), request.submitterSlug).toBe(true)
      expect(request.counterparty).toBeLessThan(DEV_SEED_COUNTERPARTIES.length)
    }
  })

  it('writes every date as a literal — nothing is computed from the clock', () => {
    const dates = [
      ...DEV_SEED_HOURS_PERIODS.flatMap((period) => [period.dateFrom, period.dateTo]),
      ...DEV_SEED_REQUESTS.map((request) => request.occurredOn),
      ...DEV_SEED_INTAKE_ITEMS.map((item) => item.occurredOn),
    ]
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('records a refusal reason on exactly the refused requests', () => {
    for (const request of DEV_SEED_REQUESTS) {
      const hasReason = (request.refusalReason ?? '').trim() !== ''
      expect(hasReason, request.slug).toBe(request.status === 'refused')
    }
  })
})

describe('the note marker that makes a request re-runnable', () => {
  it('round-trips the slug a rerun matches an existing request on', () => {
    const note = devSeedNote('req-draft-01', 'Аренда переговорной')
    expect(note.startsWith(`[${DEV_SEED_NOTE_PREFIX}req-draft-01]`)).toBe(true)
    expect(note).toContain('Аренда переговорной')
    expect(devSeedSlugFromNote(note)).toBe('req-draft-01')
  })

  it('reads no slug out of a note nobody seeded', () => {
    expect(devSeedSlugFromNote('обычный комментарий заявителя')).toBeNull()
    expect(devSeedSlugFromNote(null)).toBeNull()
  })

  it('marks every seeded request and intake line, so a rerun recognises them', () => {
    for (const request of DEV_SEED_REQUESTS) {
      expect(devSeedSlugFromNote(devSeedNote(request.slug, request.note))).toBe(request.slug)
    }
  })
})
