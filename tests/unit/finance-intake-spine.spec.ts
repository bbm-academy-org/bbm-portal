import { describe, expect, it } from 'vitest'

import { FinanceRefusal } from '@/lib/finance'
import {
  assertIntakeTransition,
  backfillSourceRef,
  FINANCE_INTAKE_MONEY_FIELDS,
  FINANCE_INTAKE_TRANSITIONS,
  findIntakeTransition,
  isTerminalIntakeStatus,
  listIntakeProducers,
  planIntakeEdit,
  resolveIntakeProducer,
  resolveIntakeSourceRef,
} from '@/lib/finance'
// The registry MUTATOR is module-internal on purpose (see src/lib/finance/index.ts):
// this suite is the one caller that registers a producer, and it reaches for it
// where it lives rather than asking for a public hole to do it through.
import { registerIntakeProducer } from '@/lib/finance/intake/sources'
import {
  FINANCE_INTAKE_SOURCES,
  FINANCE_INTAKE_STATUSES,
} from '@/lib/platform/db/schema/finance/finance-intake-item'

/**
 * The intake spine as pure logic (spec `docs/specs/339-ledger-intake.md` §B/§H,
 * issue #381).
 *
 * What lives here and what lives in the integration tier is a real split, not a
 * duplication: the status machine and the per-source `source_ref` semantics are
 * DECISIONS the module makes before anything reaches Postgres (spec 338
 * EARS-326), so they are asserted here without a database. What the database
 * itself makes true — the partial unique index behind EARS-504, the role gates
 * on real rows — is `tests/int/platform/finance-intake.int.spec.ts`.
 */

describe('The intake status machine (EARS-524)', () => {
  it('EARS-524: lists exactly the transitions of the spec and refuses every other one', () => {
    // The spec's block, transcribed as (act, from, to). Written out rather than
    // derived from the table under test — a test that recomputes the thing it
    // checks asserts nothing.
    const expected = [
      ['submit', 'draft', 'submitted'],
      ['delete', 'draft', null],
      ['approve', 'submitted', 'approved'],
      ['refuse', 'submitted', 'refused'],
      ['cancel', 'submitted', 'cancelled'],
      ['post', 'approved', 'posted'],
      ['refuse', 'approved', 'refused'],
    ]
    expect(
      FINANCE_INTAKE_TRANSITIONS.map((transition) => [
        transition.act,
        transition.from,
        transition.to,
      ]).sort(),
    ).toEqual(expected.sort())

    // Every pair NOT in that list is refused — the clause's «every transition
    // not listed», checked as the full cross-product rather than by sampling.
    const acts = ['submit', 'approve', 'refuse', 'cancel', 'post', 'delete'] as const
    for (const act of acts) {
      for (const from of FINANCE_INTAKE_STATUSES) {
        const listed = expected.some(([a, f]) => a === act && f === from)
        expect(findIntakeTransition(act, from) !== undefined).toBe(listed)
      }
    }
  })

  it('EARS-524: refused, cancelled and posted are terminal — no act leaves them', () => {
    for (const status of ['refused', 'cancelled', 'posted'] as const) {
      expect(isTerminalIntakeStatus(status)).toBe(true)
      for (const act of ['submit', 'approve', 'refuse', 'cancel', 'post', 'delete'] as const) {
        expect(() => assertIntakeTransition({ act, from: status })).toThrow(FinanceRefusal)
      }
    }
    for (const status of ['draft', 'submitted', 'approved'] as const) {
      expect(isTerminalIntakeStatus(status)).toBe(false)
    }
  })

  it('EARS-524: a refusal demands a reason, from submitted and from approved alike', () => {
    for (const from of ['submitted', 'approved'] as const) {
      expect(() => assertIntakeTransition({ act: 'refuse', from })).toThrow(/причин/i)
      expect(() => assertIntakeTransition({ act: 'refuse', from, reason: '   ' })).toThrow(
        FinanceRefusal,
      )
      expect(assertIntakeTransition({ act: 'refuse', from, reason: 'не расход компании' }).to).toBe(
        'refused',
      )
    }
  })

  it('EARS-524: deletion exists in draft only — later it is refuse or cancel, never delete', () => {
    expect(assertIntakeTransition({ act: 'delete', from: 'draft' }).to).toBeNull()
    for (const from of ['submitted', 'approved', 'refused', 'cancelled', 'posted'] as const) {
      expect(() => assertIntakeTransition({ act: 'delete', from })).toThrow(FinanceRefusal)
    }
  })

  it('EARS-524: money and dimension fields are editable in draft and submitted', () => {
    // The editable set is the spec's own list, again transcribed rather than read
    // back from the module.
    expect([...FINANCE_INTAKE_MONEY_FIELDS].sort()).toEqual(
      [
        'kind',
        'accountId',
        'counterAccountId',
        'amount',
        'currency',
        'paidAmount',
        'paidCurrency',
        'feeAmount',
        'feeCurrency',
        'purposeId',
        'projectId',
        'productId',
        'occurredOn',
      ].sort(),
    )
    for (const status of ['draft', 'submitted'] as const) {
      const plan = planIntakeEdit(status, ['amount', 'purposeId'])
      expect(plan).toEqual({ nextStatus: status, bounced: false })
    }
  })

  it('EARS-524: editing a money field in approved bounces the item back to submitted', () => {
    expect(planIntakeEdit('approved', ['amount'])).toEqual({
      nextStatus: 'submitted',
      bounced: true,
    })
    // A non-money edit — a note — is not a re-approval trigger: the approval
    // covers the data it saw, and the note is not that data.
    expect(planIntakeEdit('approved', ['note'])).toEqual({
      nextStatus: 'approved',
      bounced: false,
    })
  })

  it('EARS-524: a terminal item accepts no edit at all', () => {
    for (const status of ['refused', 'cancelled', 'posted'] as const) {
      expect(() => planIntakeEdit(status, ['note'])).toThrow(FinanceRefusal)
      expect(() => planIntakeEdit(status, ['amount'])).toThrow(FinanceRefusal)
    }
  })
})

describe('Per-source source_ref semantics (EARS-503)', () => {
  it('EARS-503: bank_import and backfill always carry a ref; manual and request never do', () => {
    expect(resolveIntakeProducer('bank_import').sourceRefPolicy).toBe('required')
    expect(resolveIntakeProducer('backfill').sourceRefPolicy).toBe('required')
    expect(resolveIntakeProducer('manual').sourceRefPolicy).toBe('none')
    expect(resolveIntakeProducer('request').sourceRefPolicy).toBe('none')
    // Every source of the enum has a producer — the spine has no gap.
    expect(
      listIntakeProducers()
        .map((producer) => producer.source)
        .sort(),
    ).toEqual([...FINANCE_INTAKE_SOURCES].sort())
  })

  it('EARS-503: a human source that supplies a ref is refused rather than quietly stored', () => {
    for (const source of ['manual', 'request'] as const) {
      expect(() => resolveIntakeSourceRef(source, { sourceRef: 'MM-1' })).toThrow(FinanceRefusal)
      expect(resolveIntakeSourceRef(source, {})).toBeNull()
    }
  })

  it('EARS-503: bank_import demands the statement line identity and cannot invent one', () => {
    expect(resolveIntakeSourceRef('bank_import', { sourceRef: 'stmt:2026-08-01:17' })).toBe(
      'stmt:2026-08-01:17',
    )
    expect(() => resolveIntakeSourceRef('bank_import', {})).toThrow(FinanceRefusal)
  })

  it('EARS-503: backfill prefers the document number, then the post id, then the natural key', () => {
    const natural = {
      occurredOn: '2026-04-17',
      accountId: 7,
      amount: 875_000n,
      counterpartyId: 3,
    }
    expect(
      backfillSourceRef({ ...natural, documentNumber: 'INV-42', mattermostPostId: 'p9' }),
    ).toBe('INV-42')
    expect(backfillSourceRef({ ...natural, mattermostPostId: 'p9' })).toBe('p9')
    // The fallback is DETERMINISTIC — that is the whole point: re-running the
    // same history composes the same key and EARS-504 refuses the second pass.
    expect(backfillSourceRef(natural)).toBe(backfillSourceRef({ ...natural }))
    expect(backfillSourceRef(natural)).toContain('2026-04-17')
    expect(backfillSourceRef({ ...natural, amount: 875_001n })).not.toBe(backfillSourceRef(natural))
    expect(resolveIntakeSourceRef('backfill', { natural })).toBe(backfillSourceRef(natural))
  })
})

describe('Producer isolation (EARS-525)', () => {
  it('EARS-525: a new source is a new producer and changes nothing in the shared spine', () => {
    const before = listIntakeProducers().map((producer) => ({ ...producer }))

    registerIntakeProducer({
      source: 'crm_import',
      sourceRefPolicy: 'required',
    })

    // The new source resolves through the SAME spine entry point every existing
    // source uses — no per-source branch was added anywhere for it to work.
    expect(resolveIntakeSourceRef('crm_import', { sourceRef: 'crm:88' })).toBe('crm:88')
    expect(() => resolveIntakeSourceRef('crm_import', {})).toThrow(FinanceRefusal)

    // And no existing producer moved: the isolation runs both ways.
    for (const producer of before) {
      expect(resolveIntakeProducer(producer.source).sourceRefPolicy).toBe(producer.sourceRefPolicy)
    }
    expect(resolveIntakeSourceRef('manual', {})).toBeNull()
  })

  it('EARS-525: an unknown source is refused by name — a producer is registered, never guessed', () => {
    expect(() => resolveIntakeProducer('telepathy')).toThrow(FinanceRefusal)
    expect(() => resolveIntakeProducer('telepathy')).toThrow(/telepathy/)
  })
})
