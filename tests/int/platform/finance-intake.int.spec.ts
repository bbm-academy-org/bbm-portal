// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  createCurrency,
  createIntakeItem,
  createIntakeItems,
  createPurpose,
  editIntakeItem,
  FinanceAccessRefusal,
  FinanceIntakeDuplicate,
  FinanceRefusal,
  getIntakeItem,
  listIntakeItems,
  transitionIntakeItem,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import {
  ADMIN,
  APPROVER,
  ENTRY,
  fundProjectId,
  MEMBER,
  seedCounterparty,
  seedMember,
  truncateFinanceTables,
} from './finance-helpers'

/**
 * The intake spine against the REAL `core` tables (spec
 * `docs/specs/339-ledger-intake.md` §B/§H, issue #381).
 *
 * This tier exists for the same reason the F1a one does: half of what the spine
 * promises IS the database. EARS-504's «a duplicate cannot exist» is a partial
 * unique index, the `source_ref` policy of EARS-503 is a CHECK, and the role
 * gates of EARS-524 only mean something over rows a real actor created. A mock
 * would assert the module's opinion of all three.
 *
 * Needs `PLATFORM_DATABASE_URL` (this worktree's branch DB — see
 * `.claude/rules/parallel-sessions.md`, "Platform database").
 */
const db = getPlatformDb()

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

/** Everything an intake item needs to name: a currency, an account, a purpose, a payee. */
async function seedIntakeReferences() {
  const entryMemberId = await seedMember(ENTRY.email, 'Entry Clerk')
  await seedMember(APPROVER.email, 'Approver Person')
  await seedMember(MEMBER.email, 'Plain Member')
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  const account = await createAccount(ADMIN, {
    name: 'Тинькофф RUB',
    kind: 'bank',
    currency: 'RUB',
  })
  const purpose = await createPurpose(ADMIN, { name: 'Хостинг', productBinding: 'forbidden' })
  const projectId = await fundProjectId()
  const counterpartyId = await seedCounterparty('Anthropic', entryMemberId)
  return { accountId: account.id, purposeId: purpose.id, projectId, counterpartyId }
}

type Refs = Awaited<ReturnType<typeof seedIntakeReferences>>

/** A backfill line — the source that ALWAYS carries a ref (EARS-503). */
function backfillLine(refs: Refs, overrides: Record<string, unknown> = {}) {
  return {
    source: 'backfill' as const,
    kind: 'expense' as const,
    occurredOn: '2026-04-17',
    accountId: refs.accountId,
    amount: 875_000n,
    currency: 'RUB',
    purposeId: refs.purposeId,
    projectId: refs.projectId,
    counterpartyId: refs.counterpartyId,
    natural: {
      occurredOn: '2026-04-17',
      accountId: refs.accountId,
      amount: 875_000n,
      counterpartyId: refs.counterpartyId,
    },
    ...overrides,
  }
}

/** A member's own expense request — the EARS-502 carve-out path. */
function requestLine(refs: Refs, overrides: Record<string, unknown> = {}) {
  return {
    source: 'request' as const,
    kind: 'expense' as const,
    occurredOn: '2026-08-20',
    accountId: refs.accountId,
    amount: 120_000n,
    currency: 'RUB',
    purposeId: refs.purposeId,
    projectId: refs.projectId,
    counterpartyId: refs.counterpartyId,
    ...overrides,
  }
}

describe('Every intake path carries its source and its ref semantics (EARS-503)', () => {
  it('EARS-503: a backfill item persists the composed natural key as its source_ref', async () => {
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(ENTRY, backfillLine(refs))
    expect(item.source).toBe('backfill')
    expect(item.sourceRef).toContain('2026-04-17')
    expect(item.status).toBe('draft')
  })

  it('EARS-503: a request carries no ref, and the database refuses one that slipped past', async () => {
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    expect(item.source).toBe('request')
    expect(item.sourceRef).toBeNull()

    // The CHECK is the accident guard behind the module refusal: a writer that
    // bypassed the module entirely still cannot store a human-source ref.
    const rejection = await db
      .execute(sql`update core.finance_intake_item set source_ref = 'MM-1' where id = ${item.id}`)
      .then(
        () => null,
        (error: unknown) => error as { cause?: { constraint?: string } },
      )
    // Drizzle wraps the driver error, so the constraint name lives on the cause —
    // asserting the wrapper's text would pass for any failed query at all.
    expect(rejection?.cause?.constraint).toBe('finance_intake_item_source_ref_policy')
  })

  it('EARS-503: a machine source without its identity is refused, not stored ref-less', async () => {
    const refs = await seedIntakeReferences()
    await expect(
      createIntakeItem(ENTRY, { ...backfillLine(refs), natural: undefined }),
    ).rejects.toBeInstanceOf(FinanceRefusal)
  })
})

describe('A duplicate arrival is refused and answers with the existing item (EARS-504)', () => {
  it('EARS-504: the second arrival of one (source, source_ref) is refused and carries the original', async () => {
    const refs = await seedIntakeReferences()
    const original = await createIntakeItem(ENTRY, backfillLine(refs))

    const refusal = await createIntakeItem(ENTRY, backfillLine(refs)).catch(
      (error: unknown) => error,
    )
    expect(refusal).toBeInstanceOf(FinanceIntakeDuplicate)
    const duplicate = refusal as FinanceIntakeDuplicate
    // «Answers with the existing one» is the clause: the caller must be able to
    // point at the original, not merely be told «уже есть».
    expect(duplicate.existing.id).toBe(original.id)
    expect(duplicate.existing.sourceRef).toBe(original.sourceRef)

    const stored = await listIntakeItems(ENTRY)
    expect(stored).toHaveLength(1)
  })

  it('EARS-504: in a bulk arrival the refusal is per line — duplicates skipped, the rest proceed', async () => {
    const refs = await seedIntakeReferences()
    const first = await createIntakeItem(ENTRY, backfillLine(refs))

    const outcome = await createIntakeItems(ENTRY, [
      backfillLine(refs), // the duplicate of `first`
      backfillLine(refs, {
        occurredOn: '2026-05-02',
        amount: 45_000n,
        natural: {
          occurredOn: '2026-05-02',
          accountId: refs.accountId,
          amount: 45_000n,
          counterpartyId: refs.counterpartyId,
        },
      }),
      backfillLine(refs, { documentNumber: 'INV-42' }),
    ])

    expect(outcome.created).toHaveLength(2)
    expect(outcome.duplicates).toHaveLength(1)
    expect(outcome.duplicates[0]).toMatchObject({ index: 0, existing: { id: first.id } })
    // The batch was not rolled back by its bad line — that is the whole clause.
    expect(await listIntakeItems(ENTRY)).toHaveLength(3)
  })

  it('EARS-504: two identical lines INSIDE one batch deduplicate against each other', async () => {
    const refs = await seedIntakeReferences()
    const outcome = await createIntakeItems(ENTRY, [backfillLine(refs), backfillLine(refs)])
    expect(outcome.created).toHaveLength(1)
    expect(outcome.duplicates).toHaveLength(1)
    expect(outcome.duplicates[0].index).toBe(1)
  })
})

describe('The status machine over real rows (EARS-524)', () => {
  it('EARS-524: the submitter walks draft → submitted → cancelled without any flow role', async () => {
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    const submitted = await transitionIntakeItem(MEMBER, item.id, 'submit')
    expect(submitted?.status).toBe('submitted')
    const cancelled = await transitionIntakeItem(MEMBER, item.id, 'cancel')
    expect(cancelled?.status).toBe('cancelled')
  })

  it('EARS-524: approving and refusing demand finance-approve, and a refusal demands its reason', async () => {
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    await transitionIntakeItem(MEMBER, item.id, 'submit')

    await expect(transitionIntakeItem(ENTRY, item.id, 'approve')).rejects.toBeInstanceOf(
      FinanceAccessRefusal,
    )
    await expect(transitionIntakeItem(APPROVER, item.id, 'refuse')).rejects.toBeInstanceOf(
      FinanceRefusal,
    )

    const approved = await transitionIntakeItem(APPROVER, item.id, 'approve')
    expect(approved?.status).toBe('approved')
    expect(approved?.decidedAt).not.toBeNull()

    const refused = await transitionIntakeItem(APPROVER, item.id, 'refuse', {
      reason: 'не расход компании',
    })
    expect(refused?.status).toBe('refused')
    expect(refused?.refusalReason).toBe('не расход компании')
  })

  it('EARS-524: an amount edited in approved bounces the item back to submitted', async () => {
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    await transitionIntakeItem(MEMBER, item.id, 'submit')
    await transitionIntakeItem(APPROVER, item.id, 'approve')

    const edited = await editIntakeItem(ENTRY, item.id, { amount: 130_000n })
    expect(edited.status).toBe('submitted')
    expect(edited.amount).toBe(130_000n)

    // A note is not the data the approval covered, so it does not bounce.
    await transitionIntakeItem(APPROVER, item.id, 'approve')
    const noted = await editIntakeItem(ENTRY, item.id, { note: 'счёт пришёл повторно' })
    expect(noted.status).toBe('approved')
  })

  it('EARS-524: a terminal item refuses every edit and every further transition', async () => {
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    await transitionIntakeItem(MEMBER, item.id, 'submit')
    await transitionIntakeItem(APPROVER, item.id, 'refuse', { reason: 'дубль' })

    await expect(editIntakeItem(ENTRY, item.id, { amount: 1n })).rejects.toBeInstanceOf(
      FinanceRefusal,
    )
    await expect(transitionIntakeItem(APPROVER, item.id, 'approve')).rejects.toBeInstanceOf(
      FinanceRefusal,
    )
    // Refused stays visible with its reason and its data — the record of the decision.
    expect((await getIntakeItem(APPROVER, item.id))?.refusalReason).toBe('дубль')
  })

  it('EARS-524: deletion exists in draft only, and it is the creator who does it', async () => {
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    await expect(transitionIntakeItem(ENTRY, item.id, 'delete')).rejects.toBeInstanceOf(
      FinanceAccessRefusal,
    )

    const other = await createIntakeItem(MEMBER, requestLine(refs, { amount: 5_000n }))
    await transitionIntakeItem(MEMBER, other.id, 'submit')
    await expect(transitionIntakeItem(MEMBER, other.id, 'delete')).rejects.toBeInstanceOf(
      FinanceRefusal,
    )

    expect(await transitionIntakeItem(MEMBER, item.id, 'delete')).toBeNull()
    expect(await getIntakeItem(MEMBER, item.id)).toBeNull()
  })

  it('EARS-524: the posting ACT is not in this spine — approved → posted refuses and names #385', async () => {
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    await transitionIntakeItem(MEMBER, item.id, 'submit')
    await transitionIntakeItem(APPROVER, item.id, 'approve')
    await expect(transitionIntakeItem(APPROVER, item.id, 'post')).rejects.toThrow(/EARS-505/)
  })

  it('EARS-524: direct entry needs finance-entry — the carve-out covers own requests only', async () => {
    const refs = await seedIntakeReferences()
    await expect(createIntakeItem(MEMBER, backfillLine(refs))).rejects.toBeInstanceOf(
      FinanceAccessRefusal,
    )
    const foreign = await createIntakeItem(MEMBER, requestLine(refs))
    const stranger = { email: 'stranger@bbm.academy', roles: ['platform-user'] }
    await seedMember(stranger.email, 'Stranger')
    await expect(editIntakeItem(stranger, foreign.id, { amount: 1n })).rejects.toBeInstanceOf(
      FinanceAccessRefusal,
    )
  })
})
