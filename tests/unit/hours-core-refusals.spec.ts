import { describe, expect, it } from 'vitest'

import { refusalFor } from '@/lib/hours/core/refusals'
import type { HoursDocument } from '@/lib/hours'

/**
 * The constraint → sentence table of spec 124 EARS-20, asserted directly.
 *
 * «The constraint→message mapping is part of the implementation's test surface.»
 * Most of these constraints are unreachable through the product: the pure domain
 * validation refuses first, and the (period, member) key is enforced as an UPSERT.
 * That is exactly why the mapping needs a test of its own — a branch that only
 * fires for the SQL escape hatch, a genuine race, or a caller handing the store an
 * impossible document would otherwise be dead code nobody notices going stale.
 *
 * The failure shape matters as much as the string: drizzle wraps the pg error in a
 * `DrizzleQueryError` and hangs the original off `cause`, so every case here is
 * built in that WRAPPED shape. Read `.constraint` off the outer object and the
 * whole table would look alive while never matching (the same trap
 * `src/lib/member/repository.ts` documents).
 */

/** A pg unique/check/FK violation as drizzle actually delivers it. */
function wrapped(constraint: string, code = '23505'): unknown {
  return {
    name: 'DrizzleQueryError',
    message: 'Failed query',
    cause: { code, constraint, message: `violates constraint "${constraint}"` },
  }
}

const doc: HoursDocument = {
  participants: [],
  periods: [
    {
      id: 'p-july',
      label: 'Июль 2026',
      date_from: '2026-07-01',
      date_to: '2026-07-31',
      status: 'open',
    },
  ],
  assessments: [],
  publications: [],
}

const empty: HoursDocument = { participants: [], periods: [], assessments: [], publications: [] }

describe('refusalFor (EARS-20)', () => {
  it('EARS-20: the open-period index yields today’s sentence, naming the period that holds the slot', () => {
    expect(refusalFor(wrapped('hours_period_single_open'), doc, doc)).toBe(
      'Уже открыт период «Июль 2026» — сначала закрой его.',
    )
  })

  it('EARS-20: with no open period to name, the sentence still explains the rule', () => {
    const refusal = refusalFor(wrapped('hours_period_single_open'), empty, empty)
    expect(refusal).toBe('Открытым может быть только один период — сначала закрой текущий.')
  })

  it('EARS-20: every constraint of the hours and member tables maps to a sentence', () => {
    const constraints = [
      'hours_assessment_period_member_unique',
      'hours_publication_pkey',
      'hours_period_pkey',
      'hours_participant_pkey',
      'hours_assessment_period_id_hours_period_id_fk',
      'hours_publication_period_id_hours_period_id_fk',
      'hours_assessment_member_id_member_id_fk',
      'hours_participant_member_id_member_id_fk',
      'hours_participant_grade_allowed',
      'hours_assessment_method_allowed',
      'hours_period_status_allowed',
      'hours_publication_status_allowed',
      'member_email_unique',
      'member_email_normalized',
      'member_slug_unique',
      'member_alias_kind_value_unique',
      'member_status_allowed',
    ]

    for (const constraint of constraints) {
      const refusal = refusalFor(wrapped(constraint, '23514'), doc, doc)
      expect(refusal, `${constraint} must map to a sentence`).toBeTruthy()
      // A refusal is something a person reads: a Russian sentence, not a SQLSTATE
      // and not the constraint name leaking through.
      expect(refusal).toMatch(/^[А-ЯЁ]/)
      expect(refusal).toMatch(/[.!]$/)
      expect(refusal).not.toContain(constraint)
    }
  })

  it('EARS-20: an unrecognized failure is NOT dressed up as a refusal', () => {
    // It becomes `HoursDataError` upstream instead. Inventing a reassuring
    // sentence for an unknown database error is how a broken write would look
    // like a validation message.
    expect(refusalFor(wrapped('some_future_constraint'), doc, doc)).toBeNull()
    expect(refusalFor(new Error('boom'), doc, doc)).toBeNull()
    expect(refusalFor(undefined, doc, doc)).toBeNull()
  })
})
