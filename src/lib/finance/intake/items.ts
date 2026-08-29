/**
 * The intake handlers — create, edit, transition, list (spec
 * `docs/specs/339-ledger-intake.md` §B/§H, issue #381).
 *
 * **Every source lands here.** A request, a manual entry, a backfill row and a
 * bank-statement line are the SAME write through the same validation, the same
 * duplicate check and the same status machine; what differs between them is one
 * producer row in `./sources.ts` (EARS-525). There is deliberately no
 * `createRequest` / `createBackfillRow` pair in this file: two entry points is
 * how «only intake items post» stops being true.
 *
 * **The gate lives here, not on the route** (EARS-501, spec 311 EARS-405): a
 * surface that forgets to check is a bug, not a hole. Which gate applies is a
 * property of the ACT, and the three are the ones #380 shipped —
 * `assertFinanceIntakeAccess` for filling the intake (with the EARS-502
 * own-request carve-out), `assertFinanceLedgerAccess` for the approve role's
 * decisions. No fourth guard is invented here.
 *
 * **What this file deliberately does not do.** Posting, including its document
 * gate, lives in `./posting.ts` (EARS-505/506); document lifecycle lives in
 * `../documents/` (#382), and request-flow acts belong to #386.
 * `approved → posted` is a transition the machine knows, but this generic
 * transition function refuses it by name so nobody can advance the status
 * without recording the operation atomically.
 */
import { and, eq, inArray } from 'drizzle-orm'

import { findMemberByEmail } from '@/lib/member'
import {
  financeIntakeItem,
  FINANCE_INTAKE_KINDS,
  FINANCE_INTAKE_SOURCES,
  type FinanceIntakeKind,
  type FinanceIntakeSource,
  type FinanceIntakeStatus,
} from '@/lib/platform/db/schema/finance/finance-intake-item'
import { getPlatformDb } from '@/lib/platform/db/client'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import { assertNoPendingPurposeProposal, assertRequestPurposeReady } from '../purpose-proposals'
import {
  assertFinanceIntakeAccess,
  assertFinanceLedgerAccess,
  financeAuditContext,
  holdsFinanceFlowRole,
  FINANCE_APPROVE_ROLE,
  FINANCE_ENTRY_ROLE,
  type FinanceActor,
} from '../core/actor'
import { FinanceAccessRefusal, FinanceRefusal } from '../core/errors'
import { resolveIntakeSourceRef, type FinanceIntakeNaturalKey } from './sources'
import {
  assertIntakeTransition,
  planIntakeEdit,
  type FinanceIntakeTransitionAct,
  type FinanceIntakeTransition,
} from './status'

/** An intake item as the module hands it out. Column names, not row internals. */
export type FinanceIntakeItemView = {
  id: number
  source: FinanceIntakeSource
  sourceRef: string | null
  kind: FinanceIntakeKind
  status: FinanceIntakeStatus
  occurredOn: string
  accountId: number | null
  counterAccountId: number | null
  amount: bigint
  currency: string
  paidAmount: bigint | null
  paidCurrency: string | null
  feeAmount: bigint | null
  feeCurrency: string | null
  purposeId: number | null
  projectId: number
  productId: number | null
  counterpartyId: number | null
  memberId: number | null
  note: string | null
  alreadyPaid: boolean
  personalFunds: boolean
  createdBy: number
  decidedBy: number | null
  decidedAt: Date | null
  refusalReason: string | null
  postedBy: number | null
  postedAt: Date | null
  operationId: number | null
}

/**
 * EARS-504's refusal, and the reason it is its own class: the clause is «refuse
 * that item and answer with the existing one». A bare message cannot be answered
 * with — a bulk caller has to POINT at the original to report the skipped line —
 * so the existing item rides on the error itself.
 */
export class FinanceIntakeDuplicate extends FinanceRefusal {
  readonly existing: FinanceIntakeItemView

  constructor(existing: FinanceIntakeItemView) {
    super(
      `Позиция с source = «${existing.source}» и source_ref = «${existing.sourceRef}» уже есть ` +
        `в приёмке — это заявка #${existing.id} в статусе «${existing.status}» (EARS-504). ` +
        'Повторный разбор той же истории ничего не проводит второй раз.',
    )
    this.name = 'FinanceIntakeDuplicate'
    this.existing = existing
  }
}

export type CreateIntakeItemInput = {
  source: FinanceIntakeSource
  kind: FinanceIntakeKind
  occurredOn: string
  amount: bigint
  currency: string
  projectId: number
  accountId?: number | null
  counterAccountId?: number | null
  paidAmount?: bigint | null
  paidCurrency?: string | null
  feeAmount?: bigint | null
  feeCurrency?: string | null
  purposeId?: number | null
  productId?: number | null
  counterpartyId?: number | null
  memberId?: number | null
  note?: string | null
  alreadyPaid?: boolean
  personalFunds?: boolean
  /** EARS-503 ref material — what the producer composes the ref from. */
  sourceRef?: string | null
  documentNumber?: string | null
  mattermostPostId?: string | null
  natural?: FinanceIntakeNaturalKey
}

/** The keys an intake line accepts — and the ONLY ones (the `operations.ts` habit). */
const CREATE_INPUT_KEYS = new Set([
  'source',
  'kind',
  'occurredOn',
  'amount',
  'currency',
  'projectId',
  'accountId',
  'counterAccountId',
  'paidAmount',
  'paidCurrency',
  'feeAmount',
  'feeCurrency',
  'purposeId',
  'productId',
  'counterpartyId',
  'memberId',
  'note',
  'alreadyPaid',
  'personalFunds',
  'sourceRef',
  'documentNumber',
  'mattermostPostId',
  'natural',
])

/** The fields an edit may name. Status is NOT one: a status moves by an act. */
export type EditIntakeItemPatch = Partial<
  Pick<
    CreateIntakeItemInput,
    | 'kind'
    | 'occurredOn'
    | 'accountId'
    | 'counterAccountId'
    | 'amount'
    | 'currency'
    | 'paidAmount'
    | 'paidCurrency'
    | 'feeAmount'
    | 'feeCurrency'
    | 'purposeId'
    | 'projectId'
    | 'productId'
    | 'counterpartyId'
    | 'memberId'
    | 'note'
    | 'alreadyPaid'
    | 'personalFunds'
  >
>

const EDIT_PATCH_KEYS = new Set([
  'kind',
  'occurredOn',
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
  'counterpartyId',
  'memberId',
  'note',
  'alreadyPaid',
  'personalFunds',
])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function intakeItemToView(
  row: typeof financeIntakeItem.$inferSelect,
): FinanceIntakeItemView {
  return {
    ...row,
    source: row.source as FinanceIntakeSource,
    kind: row.kind as FinanceIntakeKind,
    status: row.status as FinanceIntakeStatus,
  }
}

/**
 * The money/dimension shape every intake item must satisfy, whatever the source.
 *
 * Raised in the module BEFORE the write (spec 338 EARS-326); the CHECK
 * constraints behind each of these are the accident guard, not the message the
 * person reads.
 */
function assertItemShape(state: {
  kind: string
  occurredOn: string
  amount: bigint
  currency: string
  accountId: number | null
  memberId: number | null
  paidAmount: bigint | null
  paidCurrency: string | null
  feeAmount: bigint | null
  feeCurrency: string | null
  alreadyPaid: boolean
  personalFunds: boolean
}): void {
  if (!(FINANCE_INTAKE_KINDS as readonly string[]).includes(state.kind)) {
    throw new FinanceRefusal(
      `Вид позиции «${state.kind}» не из набора приёмки: ${FINANCE_INTAKE_KINDS.join(', ')}.`,
    )
  }
  if (typeof state.occurredOn !== 'string' || !ISO_DATE.test(state.occurredOn)) {
    throw new FinanceRefusal(
      `Дата «${String(state.occurredOn)}» записана не в формате ГГГГ-ММ-ДД. В приёмке это ` +
        'ВСЕГДА дата движения денег, а не дата документа (EARS-508).',
    )
  }
  if (typeof state.amount !== 'bigint') {
    throw new FinanceRefusal(
      'Сумма — целое число минимальных единиц валюты (bigint): у денег в этом леджере нет ' +
        'округления, которое можно потерять (спека 338, EARS-310).',
    )
  }
  if (state.amount <= 0n) {
    throw new FinanceRefusal(
      'Сумма позиции приёмки — положительная: направление задаёт вид позиции (kind), ' +
        'а знак появляется только у проводок при проведении.',
    )
  }
  if (typeof state.currency !== 'string' || state.currency.trim() === '') {
    throw new FinanceRefusal('Валюта документа обязательна.')
  }
  if ((state.paidAmount === null) !== (state.paidCurrency === null)) {
    throw new FinanceRefusal(
      'Вторая сумма записывается парой «сумма + валюта»: обе стороны кросс-валютного платежа — ' +
        'факты, и ни одна не вычисляется по курсу (спека 339, Cross-currency payments).',
    )
  }
  if ((state.feeAmount === null) !== (state.feeCurrency === null)) {
    throw new FinanceRefusal('Комиссия записывается парой «сумма + валюта».')
  }
  if (state.personalFunds && !state.alreadyPaid) {
    throw new FinanceRefusal(
      '«Оплачено своими средствами» принимается только вместе с «уже оплачено» (EARS-508): ' +
        'своими средствами платят по факту, а не заранее.',
    )
  }
  if (state.personalFunds && state.memberId === null) {
    throw new FinanceRefusal(
      'Позиция «оплачено своими средствами» обязана назвать участника, чьими средствами ' +
        'заплатили (спека 339, строка модели: «required for personal_funds»): без него долг ' +
        'компании записан никому, и обязательство перед человеком (EARS-513) не прочитать.',
    )
  }
  if (state.personalFunds !== (state.accountId === null)) {
    throw new FinanceRefusal(
      state.personalFunds
        ? 'Позиция с «оплачено своими средствами» не называет счёт компании: деньги ушли не с ' +
            'него, а встречной ногой станет системный счёт обязательства (EARS-513).'
        : 'Позиция обязана назвать счёт, с которого ушли деньги — пустым он бывает ровно у ' +
            '«оплачено своими средствами» (EARS-513).',
    )
  }
}

/** Who this actor is in `core.member` — every intake row names its author. */
async function requireMemberId(actor: FinanceActor): Promise<number> {
  const member = await findMemberByEmail(actor.email)
  if (member === null) {
    throw new FinanceAccessRefusal(
      `У ${actor.email} нет записи в общем реестре людей (core.member), а позиция приёмки ` +
        'обязана называть автора. Заведите участника — src/lib/member.',
    )
  }
  return member.id
}

function assertKnownSource(source: string): void {
  if (!(FINANCE_INTAKE_SOURCES as readonly string[]).includes(source)) {
    throw new FinanceRefusal(
      `Источник «${source}» не входит в набор, зафиксированный спекой 339 ` +
        `(${FINANCE_INTAKE_SOURCES.join(', ')}). Новый источник — это producer ПЛЮС миграция, ` +
        'расширяющая CHECK на колонке source (EARS-503/525).',
    )
  }
}

/**
 * Create one intake item (EARS-503/504).
 *
 * Order: the gate, then the shape, then the ref, then the duplicate check inside
 * the transaction that does the insert — so the check and the write cannot be
 * separated by a racing producer. The partial unique index is the backstop the
 * readable refusal sits in front of.
 */
export async function createIntakeItem(
  actor: FinanceActor,
  input: CreateIntakeItemInput,
): Promise<FinanceIntakeItemView> {
  for (const key of Object.keys(input)) {
    if (!CREATE_INPUT_KEYS.has(key)) {
      throw new FinanceRefusal(`Поле «${key}» позиция приёмки не принимает.`)
    }
  }
  assertKnownSource(input.source)
  // EARS-502: filing a request is the submitter's own act and needs no flow
  // role; every other source is direct entry and demands `finance-entry`.
  assertFinanceIntakeAccess(actor, { ownRequest: input.source === 'request' })

  const values = {
    source: input.source,
    kind: input.kind,
    occurredOn: input.occurredOn,
    accountId: input.accountId ?? null,
    counterAccountId: input.counterAccountId ?? null,
    amount: input.amount,
    currency: input.currency,
    paidAmount: input.paidAmount ?? null,
    paidCurrency: input.paidCurrency ?? null,
    feeAmount: input.feeAmount ?? null,
    feeCurrency: input.feeCurrency ?? null,
    purposeId: input.purposeId ?? null,
    projectId: input.projectId,
    productId: input.productId ?? null,
    counterpartyId: input.counterpartyId ?? null,
    memberId: input.memberId ?? null,
    note: input.note ?? null,
    alreadyPaid: input.alreadyPaid ?? false,
    personalFunds: input.personalFunds ?? false,
  }
  assertItemShape(values)

  const sourceRef = resolveIntakeSourceRef(input.source, {
    sourceRef: input.sourceRef,
    documentNumber: input.documentNumber,
    mattermostPostId: input.mattermostPostId,
    natural: input.natural,
  })
  const createdBy = await requireMemberId(actor)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    if (sourceRef !== null) {
      const existing = await findBySourceRef(tx, input.source, sourceRef)
      if (existing !== undefined) throw new FinanceIntakeDuplicate(intakeItemToView(existing))
    }
    const [row] = await tx
      .insert(financeIntakeItem)
      .values({ ...values, sourceRef, status: 'draft', createdBy })
      .returning()
    return intakeItemToView(row)
  })
}

async function findBySourceRef(tx: PlatformTx, source: string, sourceRef: string) {
  const [row] = await tx
    .select()
    .from(financeIntakeItem)
    .where(and(eq(financeIntakeItem.source, source), eq(financeIntakeItem.sourceRef, sourceRef)))
  return row
}

/** One line of a bulk arrival that was skipped, with the item it collided with. */
export type FinanceIntakeDuplicateLine = {
  index: number
  sourceRef: string | null
  existing: FinanceIntakeItemView
}

export type FinanceIntakeBulkOutcome = {
  created: FinanceIntakeItemView[]
  duplicates: FinanceIntakeDuplicateLine[]
}

/**
 * A bulk arrival — an import file, a backfill batch (EARS-504, US-8).
 *
 * **The refusal is per LINE, and that is the whole clause.** Lines run one at a
 * time in their own transactions, so a duplicate is skipped and reported while
 * every other row lands; one shared transaction would make a single duplicate
 * discard a whole statement, which is precisely the behaviour the spec rules
 * out. It also makes a batch deduplicate against ITSELF: line 2 sees line 1
 * committed.
 *
 * Only duplicates are collected. A malformed line is a refusal of the batch —
 * the caller fixes their file rather than discovering later that three rows they
 * believed in were dropped.
 */
export async function createIntakeItems(
  actor: FinanceActor,
  inputs: readonly CreateIntakeItemInput[],
): Promise<FinanceIntakeBulkOutcome> {
  const created: FinanceIntakeItemView[] = []
  const duplicates: FinanceIntakeDuplicateLine[] = []
  for (const [index, input] of inputs.entries()) {
    try {
      created.push(await createIntakeItem(actor, input))
    } catch (error) {
      if (error instanceof FinanceIntakeDuplicate) {
        duplicates.push({ index, sourceRef: error.existing.sourceRef, existing: error.existing })
        continue
      }
      throw error
    }
  }
  return { created, duplicates }
}

/**
 * The row, locked, INSIDE the caller's transaction (`select … for update`).
 *
 * This is the whole answer to «the status machine is guarded in memory but not
 * in the database». Reading in autocommit and then writing by `id` in a separate
 * transaction leaves the status a decision was made on un-asserted at write
 * time: two callers both read `submitted`, both write, and the row lands in a
 * state no listed transition produced — `cancelled` carrying an approval's
 * decider, or a plain `cancelled → approved`. There is no CHECK that can catch
 * that, unlike EARS-504's unique index.
 *
 * The lock, rather than a compare-and-swap, because the decision needs the row
 * anyway: the gate reads `created_by` and `source`, the edit plan reads the
 * status, and `assertItemShape` validates the MERGED row. F1's
 * `reverseOperation` reads inside its transaction for exactly this reason, and
 * `createIntakeItem` already argues the point in its own docstring.
 */
export async function lockIntakeItem(
  tx: PlatformTx,
  id: number,
): Promise<typeof financeIntakeItem.$inferSelect> {
  const [row] = await tx
    .select()
    .from(financeIntakeItem)
    .where(eq(financeIntakeItem.id, id))
    .for('update')
  if (row === undefined) {
    throw new FinanceRefusal(`Позиции приёмки #${id} не существует.`)
  }
  return row
}

/**
 * Can this actor see the item AT ALL (EARS-502)?
 *
 * Asked before the machine and before the act gate, and the order is the fix for
 * an oracle: checking the machine first is right for someone who may act on the
 * item — «отзовите» beats «недостаточно прав» — but a stranger must not read
 * another person's status out of the refusal text on the way to being refused.
 */
function assertItemVisible(
  actor: FinanceActor,
  row: typeof financeIntakeItem.$inferSelect,
  actorMemberId: number,
): void {
  if (holdsFinanceFlowRole(actor)) return
  if (row.createdBy === actorMemberId) return
  throw new FinanceAccessRefusal(
    `Позиция приёмки #${row.id} не ваша: чужие заявки видят роли ${FINANCE_ENTRY_ROLE} и ` +
      `${FINANCE_APPROVE_ROLE} (EARS-501/502).`,
  )
}

/** The fields this patch actually CHANGES — a re-save of the same value is not an edit. */
function changedFields(
  row: typeof financeIntakeItem.$inferSelect,
  patch: EditIntakeItemPatch,
): string[] {
  const current = row as unknown as Record<string, unknown>
  return Object.keys(patch).filter((key) => {
    const next = (patch as Record<string, unknown>)[key]
    return (next ?? null) !== (current[key] ?? null)
  })
}

/**
 * Edit an item (EARS-524).
 *
 * The status machine decides what the edit DOES to the status; this function
 * decides who may attempt it. A bounce clears the decision fields as well as the
 * status: an approval that no longer covers the data is not a decision worth
 * keeping a name on — and it fires on a real change only, because re-saving the
 * same amount is not data the approval has not seen.
 */
export async function editIntakeItem(
  actor: FinanceActor,
  id: number,
  patch: EditIntakeItemPatch,
): Promise<FinanceIntakeItemView> {
  for (const key of Object.keys(patch)) {
    if (!EDIT_PATCH_KEYS.has(key)) {
      throw new FinanceRefusal(`Поле «${key}» правкой позиции приёмки не меняется.`)
    }
  }
  const actorMemberId = await requireMemberId(actor)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const row = await lockIntakeItem(tx, id)
    assertItemVisible(actor, row, actorMemberId)

    const plan = planIntakeEdit(row.status as FinanceIntakeStatus, changedFields(row, patch))
    assertFinanceIntakeAccess(actor, { ownRequest: isOwnEditableRequest(row, actorMemberId) })

    const next = { ...row, ...patch }
    assertItemShape({
      kind: next.kind,
      occurredOn: next.occurredOn,
      amount: next.amount,
      currency: next.currency,
      accountId: next.accountId ?? null,
      memberId: next.memberId ?? null,
      paidAmount: next.paidAmount ?? null,
      paidCurrency: next.paidCurrency ?? null,
      feeAmount: next.feeAmount ?? null,
      feeCurrency: next.feeCurrency ?? null,
      alreadyPaid: next.alreadyPaid,
      personalFunds: next.personalFunds,
    })

    const [updated] = await tx
      .update(financeIntakeItem)
      .set({
        ...patch,
        status: plan.nextStatus,
        ...(plan.bounced ? { decidedBy: null, decidedAt: null } : {}),
      })
      .where(eq(financeIntakeItem.id, id))
      .returning()
    return intakeItemToView(updated)
  })
}

/** EARS-502: own request, still in a status the carve-out covers. */
function isOwnEditableRequest(
  row: typeof financeIntakeItem.$inferSelect,
  actorMemberId: number,
): boolean {
  return (
    row.source === 'request' &&
    row.createdBy === actorMemberId &&
    (row.status === 'draft' || row.status === 'submitted')
  )
}

/**
 * Move an item along the machine (EARS-524).
 *
 * **The transition is checked BEFORE the act's role gate**, and the order is
 * deliberate: a submitter asking to delete a `submitted` request has made a
 * machine mistake, not an authorization one, and «отзовите» is the answer they
 * need. Telling them «недостаточно прав» would send them looking for a grant
 * that would not help. VISIBILITY is asked before both, so that ordering does
 * not turn the refusal text into a status oracle for a stranger.
 *
 * The row is read and written inside ONE transaction, locked — see `lockIntakeItem`.
 *
 * Returns `null` for the one act that ends with no row — `delete` from `draft`.
 */
export async function transitionIntakeItem(
  actor: FinanceActor,
  id: number,
  act: FinanceIntakeTransitionAct,
  options: { reason?: string | null } = {},
): Promise<FinanceIntakeItemView | null> {
  const actorMemberId = await requireMemberId(actor)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const row = await lockIntakeItem(tx, id)
    assertItemVisible(actor, row, actorMemberId)

    const transition = assertIntakeTransition({
      act,
      from: row.status as FinanceIntakeStatus,
      reason: options.reason,
    })
    assertTransitionGate(actor, transition, row, actorMemberId)

    if (act === 'submit' || act === 'post') {
      await assertRequestPurposeReady(tx, row.id)
    }

    if (act === 'post') {
      throw new FinanceRefusal(
        'Статус posted нельзя поставить обычным переходом: используйте postIntakeItem — он в одной ' +
          'транзакции проверяет документ, записывает операцию и связывает её с позицией (EARS-505/506).',
      )
    }

    if (transition.to === null) {
      await assertNoPendingPurposeProposal(tx, row.id)
      await tx.delete(financeIntakeItem).where(eq(financeIntakeItem.id, id))
      return null
    }
    const decision =
      act === 'approve' || act === 'refuse'
        ? { decidedBy: actorMemberId, decidedAt: new Date() }
        : {}
    const [updated] = await tx
      .update(financeIntakeItem)
      .set({
        status: transition.to,
        ...decision,
        ...(act === 'refuse' ? { refusalReason: (options.reason ?? '').trim() } : {}),
      })
      .where(eq(financeIntakeItem.id, id))
      .returning()
    return intakeItemToView(updated)
  })
}

function assertTransitionGate(
  actor: FinanceActor,
  transition: FinanceIntakeTransition,
  row: typeof financeIntakeItem.$inferSelect,
  actorMemberId: number,
): void {
  if (transition.gate === 'approve') {
    assertFinanceLedgerAccess(actor)
    return
  }
  if (transition.gate === 'submitter') {
    if (row.createdBy !== actorMemberId) {
      throw new FinanceAccessRefusal(
        `Отзыв позиции приёмки #${row.id} принадлежит её автору: это заявление о ` +
          'собственном намерении, а не роль (EARS-524). Удаление черновика — шире: ' +
          `автор или роль «${FINANCE_ENTRY_ROLE}» (решение владельца, Антон, 2026-08-27).`,
      )
    }
    return
  }
  assertFinanceIntakeAccess(actor, {
    ownRequest: row.source === 'request' && row.createdBy === actorMemberId,
  })
}

export type ListIntakeItemsFilter = {
  status?: readonly FinanceIntakeStatus[]
  source?: readonly FinanceIntakeSource[]
}

/**
 * The intake list (spec 339's CRUD table).
 *
 * Two audiences, one query: a flow-role holder reads every item (the queue and
 * the intake list are theirs), and a role-less member reads their OWN requests
 * and nothing else — EARS-502's «see their own requests with statuses». The open
 * member-wide read of EARS-530 is about `/p/finance` figures, not about other
 * people's requests.
 */
export async function listIntakeItems(
  actor: FinanceActor,
  filter: ListIntakeItemsFilter = {},
): Promise<FinanceIntakeItemView[]> {
  const conditions = []
  if (!holdsFinanceFlowRole(actor)) {
    conditions.push(eq(financeIntakeItem.createdBy, await requireMemberId(actor)))
  }
  if (filter.status !== undefined && filter.status.length > 0) {
    conditions.push(inArray(financeIntakeItem.status, [...filter.status]))
  }
  if (filter.source !== undefined && filter.source.length > 0) {
    conditions.push(inArray(financeIntakeItem.source, [...filter.source]))
  }
  // Ordered in SQL, not in JS. There is deliberately no LIMIT: paging is the
  // consuming surface's decision (#386/#389), and inventing one here would give
  // that surface a silent truncation instead of a contract.
  const rows = await getPlatformDb()
    .select()
    .from(financeIntakeItem)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(financeIntakeItem.id)
  return rows.map(intakeItemToView)
}

/** One item, subject to the same visibility rule as the list. */
export async function getIntakeItem(
  actor: FinanceActor,
  id: number,
): Promise<FinanceIntakeItemView | null> {
  const [row] = await getPlatformDb()
    .select()
    .from(financeIntakeItem)
    .where(eq(financeIntakeItem.id, id))
  if (row === undefined) return null
  assertItemVisible(actor, row, await requireMemberId(actor))
  return intakeItemToView(row)
}
