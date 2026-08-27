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
  fixtureWrite,
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

describe("The model row's own invariants (spec 339 §Data model)", () => {
  it('personal_funds names the member it is owed to, in both planes', async () => {
    // «`member` FK (nullable — … required for `personal_funds` and liability
    // transfers)». A personal-funds item without it is a reimbursement debt owed
    // to nobody, and EARS-513's «who does BBM owe and how much» cannot be
    // expressed over it. Unlike the per-kind nullability of `product_id` and
    // `counterparty_id`, this one depends on no other row: `personal_funds` is a
    // boolean here, so the payer is known at creation time.
    const refs = await seedIntakeReferences()
    const payerId = await seedMember('payer@bbm.academy', 'Payer Person')
    const personal = {
      source: 'manual' as const,
      kind: 'expense' as const,
      occurredOn: '2026-08-20',
      accountId: null,
      amount: 37_000n,
      currency: 'RUB',
      purposeId: refs.purposeId,
      projectId: refs.projectId,
      counterpartyId: refs.counterpartyId,
      alreadyPaid: true,
      personalFunds: true,
    }

    await expect(createIntakeItem(ENTRY, personal)).rejects.toBeInstanceOf(FinanceRefusal)

    const item = await createIntakeItem(ENTRY, { ...personal, memberId: payerId })
    expect(item.memberId).toBe(payerId)

    const rejection = await db
      .execute(sql`update core.finance_intake_item set member_id = null where id = ${item.id}`)
      .then(
        () => null,
        (error: unknown) => error as { cause?: { constraint?: string } },
      )
    expect(rejection?.cause?.constraint).toBe('finance_intake_item_personal_funds_member')
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

  it('EARS-524: two transitions racing on one item — exactly one is refused', async () => {
    // The status a decision was made on has to be re-asserted AT WRITE TIME, or
    // the machine is enforced only in memory: two callers both read `submitted`,
    // both write, and the item lands in a state no listed transition produced —
    // `cancelled` carrying an approval's decider, or a plain `cancelled →
    // approved`. F1's `reverseOperation` reads inside its own transaction for
    // exactly this reason.
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    await transitionIntakeItem(MEMBER, item.id, 'submit')

    // The interleave is STAGED rather than hoped for: a fixture transaction
    // cancels the item and is held open, so the racing approval reads the row
    // while `submitted` is still the committed truth. Racing two handlers with
    // `Promise.all` would prove nothing — the pool serializes them and the
    // second one's read happens to see fresh data.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const holder = fixtureWrite(async (tx) => {
      await tx.execute(
        sql`update core.finance_intake_item set status = 'cancelled' where id = ${item.id}`,
      )
      await held
    })

    const racing = transitionIntakeItem(APPROVER, item.id, 'approve').then(
      (value) => value,
      (error: unknown) => error,
    )
    await new Promise((resolve) => setTimeout(resolve, 250))
    release()
    await holder

    expect(await racing).toBeInstanceOf(FinanceRefusal)
    const final = await getIntakeItem(APPROVER, item.id)
    // `cancelled → approved` is in no row of FINANCE_INTAKE_TRANSITIONS, and a
    // cancelled item never carries the decision of an approval that lost.
    expect(final?.status).toBe('cancelled')
    expect(final?.decidedAt).toBeNull()
  })

  it('EARS-524: an edit racing a refusal cannot overwrite the terminal status it never read', async () => {
    // `editIntakeItem` writes `status` UNCONDITIONALLY on every edit, so an edit
    // that read `submitted` and committed after a refusal silently resurrects the
    // item — and once #385 lands, the same shape overwrites `posted`.
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    await transitionIntakeItem(MEMBER, item.id, 'submit')

    await Promise.allSettled([
      transitionIntakeItem(APPROVER, item.id, 'refuse', { reason: 'дубль' }),
      editIntakeItem(ENTRY, item.id, { amount: 130_000n }),
    ])

    const final = await getIntakeItem(APPROVER, item.id)
    expect(final?.status).toBe('refused')
    expect(final?.refusalReason).toBe('дубль')
  })

  it('EARS-524: an edit that changes nothing does not bounce an approved item', async () => {
    // The bounce means «the approval no longer covers the data». Re-saving the
    // same amount changes no data, so it is not that.
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    await transitionIntakeItem(MEMBER, item.id, 'submit')
    const approved = await transitionIntakeItem(APPROVER, item.id, 'approve')

    const edited = await editIntakeItem(ENTRY, item.id, { amount: item.amount })
    expect(edited.status).toBe('approved')
    expect(edited.decidedAt?.getTime()).toBe(approved?.decidedAt?.getTime())
  })

  it("EARS-524: a stranger's refusal names no status — the machine answer is not an oracle", async () => {
    // Checking the machine before the role is right (a submitter who tried to
    // delete a `submitted` request needs «отзовите», not «недостаточно прав») —
    // but it must not read a stranger someone else's status out loud on the way.
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))
    await transitionIntakeItem(MEMBER, item.id, 'submit')
    await transitionIntakeItem(APPROVER, item.id, 'approve')

    const stranger = { email: 'oracle@bbm.academy', roles: ['platform-user'] }
    await seedMember(stranger.email, 'Oracle Probe')
    const refusal: unknown = await transitionIntakeItem(stranger, item.id, 'cancel').then(
      () => null,
      (error: unknown) => error,
    )
    expect(refusal).toBeInstanceOf(FinanceAccessRefusal)
    expect((refusal as Error).message).not.toContain('approved')
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

  it('EARS-524: deletion exists in draft only — the creator or the entry role does it', async () => {
    const refs = await seedIntakeReferences()
    const item = await createIntakeItem(MEMBER, requestLine(refs))

    // A platform member who is neither the author nor inside the flow is refused.
    const stranger = { email: 'passerby@bbm.academy', roles: ['platform-user'] }
    await seedMember(stranger.email, 'Passer By')
    await expect(transitionIntakeItem(stranger, item.id, 'delete')).rejects.toBeInstanceOf(
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

  it('EARS-524: an entry-role holder deletes an abandoned draft that is not theirs', async () => {
    // Owner ruling, Антон, 2026-08-27: a draft is deleted by its CREATOR or by
    // any `finance-entry` holder. Creator-only left `draft` with no exit at all
    // when its author had left — a bad import row nobody could delete, cancel or
    // refuse, because `cancel` starts at `submitted` and refusal is the approve
    // role's act on a submitted item.
    const refs = await seedIntakeReferences()
    const abandoned = await createIntakeItem(MEMBER, requestLine(refs))

    expect(await transitionIntakeItem(ENTRY, abandoned.id, 'delete')).toBeNull()
    expect(await getIntakeItem(ENTRY, abandoned.id)).toBeNull()

    // The widening reaches `draft` and stops there: a submitted item is still
    // withdrawn by its submitter, never deleted by a clerk.
    const live = await createIntakeItem(MEMBER, requestLine(refs, { amount: 7_000n }))
    await transitionIntakeItem(MEMBER, live.id, 'submit')
    await expect(transitionIntakeItem(ENTRY, live.id, 'delete')).rejects.toBeInstanceOf(
      FinanceRefusal,
    )
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
