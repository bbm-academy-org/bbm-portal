/**
 * The fact core — recording an operation and reversing one (spec 338 EARS-310…
 * 316, EARS-320…322, EARS-327, EARS-330, EARS-334).
 *
 * An operation is written ONCE and never touched again (EARS-313). There is no
 * `updateOperation`, no `deleteOperation` and no `reclassify` in this file, and
 * their absence is the design rather than an omission: the only correction is
 * `reverseOperation`, and a database trigger refuses an UPDATE or DELETE even if
 * something managed to try one.
 *
 * There is likewise no allocation of any kind (EARS-334). An amount reaches a
 * product or a project by having been RECORDED with that dimension on its own
 * posting; no percentage base, absorption rate or allocation run exists here to
 * write one, and F3 computes such views as overlays over what is posted.
 */
import { eq, inArray } from 'drizzle-orm'

import { financeAccount } from '@/lib/platform/db/schema/finance/finance-account'
import { financeOperation } from '@/lib/platform/db/schema/finance/finance-operation'
import type { FinanceOperationSource } from '@/lib/platform/db/schema/finance/finance-operation'
import { financePosting } from '@/lib/platform/db/schema/finance/finance-posting'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import { assertFinanceLedgerAccess, financeAuditContext, type FinanceActor } from './core/actor'
import { FinanceRefusal } from './core/errors'
import {
  assertBalancedPerCurrency,
  assertPostingCurrencyMatchesAccount,
  assertProductBinding,
  assertProjectOnResultPostings,
  resolvePostingCategory,
  type AccountFacts,
  type PostingDraft,
} from './core/invariants'
import { requirePurpose } from './references'

/** What a caller offers when recording a fact. */
export type RecordOperationInput = {
  /** `YYYY-MM-DD` — the day the money moved. */
  occurredOn: string
  source: FinanceOperationSource
  postings: readonly PostingDraft[]
  purposeId?: number | null
  sourceRef?: string | null
  backdated?: boolean
}

export type RecordedOperation = {
  id: number
  occurredOn: string
  source: FinanceOperationSource
  purposeId: number | null
  sourceRef: string | null
  backdated: boolean
  reverses: number | null
  postings: { id: number; accountId: number; amount: bigint; currency: string }[]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The keys `RecordOperationInput` accepts — and the ONLY ones.
 *
 * An unknown key is refused rather than dropped, because the key this list
 * exists to refuse is `productBinding` (EARS-331): the binding is master data on
 * the purpose, and an operation that appears to carry one would be a form of
 * per-operation judgement the whole of ruling 2 rejects. Silently ignoring it
 * would leave the caller believing it took effect.
 */
const OPERATION_INPUT_KEYS = new Set([
  'occurredOn',
  'source',
  'postings',
  'purposeId',
  'sourceRef',
  'backdated',
])

export function parseRecordOperationInput(input: RecordOperationInput): RecordOperationInput {
  for (const key of Object.keys(input)) {
    if (OPERATION_INPUT_KEYS.has(key)) continue
    if (key === 'productBinding' || key === 'product_binding') {
      throw new FinanceRefusal(
        'product_binding не принимается в операции: это мастер-данные назначения (EARS-331). ' +
          'Оператор указывает ЗНАЧЕНИЕ продукта, а не правило; правило меняют правкой назначения, ' +
          'и только ролью platform-admin.',
      )
    }
    throw new FinanceRefusal(`Поле «${key}» операция не принимает.`)
  }
  if (typeof input.occurredOn !== 'string' || !ISO_DATE.test(input.occurredOn)) {
    throw new FinanceRefusal(
      `Дата операции «${String(input.occurredOn)}» записана не в формате ГГГГ-ММ-ДД.`,
    )
  }
  if (!Array.isArray(input.postings)) {
    throw new FinanceRefusal(
      'Операция записывается проводками: список проводок обязателен (EARS-310).',
    )
  }
  for (const posting of input.postings) {
    if (typeof posting.amount !== 'bigint') {
      throw new FinanceRefusal(
        'Сумма проводки — целое число минимальных единиц валюты (bigint), а не дробное число: ' +
          'у денег в этом леджере нет округления, которое можно потерять (EARS-310).',
      )
    }
    if (posting.amount === 0n) {
      throw new FinanceRefusal(
        'Проводка на ноль ничего не утверждает — такую операцию не записать.',
      )
    }
  }
  return input
}

/**
 * Record an operation (EARS-310…312, EARS-316, EARS-320…322, EARS-327).
 *
 * Order matters: the write gate first (EARS-330), then the shape of the input,
 * then the invariants that need reference rows, and only then the insert. Every
 * refusal is therefore a readable module message raised BEFORE anything reached
 * Postgres (EARS-326) — the constraints and triggers behind them are the
 * accident guard, not the user experience.
 */
export async function recordOperation(
  actor: FinanceActor,
  input: RecordOperationInput,
): Promise<RecordedOperation> {
  assertFinanceLedgerAccess(actor)
  const parsed = parseRecordOperationInput(input)
  if (parsed.source === 'reversal') {
    throw new FinanceRefusal(
      "source = 'reversal' проставляет только сторно: используйте reverseOperation (EARS-314).",
    )
  }
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const accounts = await loadAccountFacts(tx, parsed.postings)
    assertNoRetiredAccount(accounts)
    const postings = await prepareDimensions(tx, parsed, accounts)
    assertPostingCurrencyMatchesAccount(postings, accounts)
    assertBalancedPerCurrency(postings)
    assertProjectOnResultPostings(postings, accounts)
    return insertOperation(tx, {
      occurredOn: parsed.occurredOn,
      source: parsed.source,
      purposeId: parsed.purposeId ?? null,
      sourceRef: parsed.sourceRef ?? null,
      backdated: parsed.backdated ?? false,
      reverses: null,
      postings,
    })
  })
}

/**
 * Reversal — сторно (EARS-314/315).
 *
 * The mirror is EXACT: same accounts, same currencies, same project, category,
 * product, member and conversion step, amounts negated. That is what makes «both
 * operations remain visible and their sum is zero in every cut» true for cuts
 * this module has never heard of, including F3's.
 *
 * A reversal is itself reversible — that is how a mistaken сторно is undone —
 * so the refusal below is about the ORIGINAL already having one, not about the
 * original being a reversal. The unique index on `reverses` is the accident
 * guard behind the readable message.
 */
export async function reverseOperation(
  actor: FinanceActor,
  operationId: number,
  options: { occurredOn?: string } = {},
): Promise<RecordedOperation> {
  assertFinanceLedgerAccess(actor)
  if (options.occurredOn !== undefined && !ISO_DATE.test(options.occurredOn)) {
    throw new FinanceRefusal(
      `Дата сторно «${options.occurredOn}» записана не в формате ГГГГ-ММ-ДД.`,
    )
  }
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const [original] = await tx
      .select()
      .from(financeOperation)
      .where(eq(financeOperation.id, operationId))
    if (original === undefined) {
      throw new FinanceRefusal(`Операции #${operationId} нет в леджере — сторнировать нечего.`)
    }
    const [already] = await tx
      .select({ id: financeOperation.id })
      .from(financeOperation)
      .where(eq(financeOperation.reverses, operationId))
    if (already !== undefined) {
      throw new FinanceRefusal(
        `Операция #${operationId} уже сторнирована операцией #${already.id} (EARS-315). ` +
          'Повторное сторно обнулило бы её дважды. Сторно самого сторно — законная операция: ' +
          `сторнируйте #${already.id}, если сторно было ошибкой.`,
      )
    }
    const originalPostings = await tx
      .select()
      .from(financePosting)
      .where(eq(financePosting.operationId, operationId))

    // The mirror is built COMPLETE, conversion-step link included, and inserted
    // once. It used to be inserted bare and then patched, which the EARS-313
    // trigger refused outright — so сторно of any conversion was impossible —
    // and which was the wrong shape besides: a module that mutates a recorded
    // fact is exactly what EARS-313 says the module refuses «by having no such
    // function at all». Building the draft whole also removes the positional
    // `postings[index]` pairing that silently relied on `.returning()`
    // preserving input order.
    //
    // The step link is COPIED, never re-created: a conversion and its сторно
    // name the same steps, so they stay one story and no rate is restated
    // (EARS-319).
    const mirrored: PostingDraft[] = originalPostings.map((posting) => ({
      accountId: posting.accountId,
      amount: -posting.amount,
      currency: posting.currency,
      projectId: posting.projectId,
      categoryId: posting.categoryId,
      productId: posting.productId,
      memberId: posting.memberId,
      conversionStepId: posting.conversionStepId,
    }))
    assertBalancedPerCurrency(mirrored)

    return insertOperation(tx, {
      occurredOn: options.occurredOn ?? original.occurredOn,
      source: 'reversal',
      purposeId: original.purposeId,
      sourceRef: original.sourceRef,
      backdated: original.backdated,
      reverses: operationId,
      postings: mirrored,
    })
  })
}

/**
 * The step a posting draft belongs to, as an id.
 *
 * Two ways in, and the precedence is the point: a draft that already KNOWS its
 * step (a reversal, mirroring rows whose steps exist) wins over the positional
 * lookup a conversion uses while it is still building its own chain. Shared by
 * `insertOperation` and `./conversions.ts` so both write the column the same way.
 */
export function resolveConversionStepId(
  posting: PostingDraft,
  stepIdByNo: ReadonlyMap<number, number>,
): number | null {
  if (posting.conversionStepId !== null && posting.conversionStepId !== undefined) {
    return posting.conversionStepId
  }
  if (posting.conversionStepNo === null || posting.conversionStepNo === undefined) return null
  return stepIdByNo.get(posting.conversionStepNo) ?? null
}

// ── internals, shared with ./conversions.ts ──────────────────────────────────

export type OperationRowDraft = {
  occurredOn: string
  source: FinanceOperationSource
  purposeId: number | null
  sourceRef: string | null
  backdated: boolean
  reverses: number | null
  postings: readonly PostingDraft[]
}

/** The insert itself. Never an update — the fact core is append-only (EARS-313). */
export async function insertOperation(
  tx: PlatformTx,
  draft: OperationRowDraft,
  stepIdByNo: ReadonlyMap<number, number> = new Map(),
): Promise<RecordedOperation> {
  const [operation] = await tx
    .insert(financeOperation)
    .values({
      occurredOn: draft.occurredOn,
      source: draft.source,
      purposeId: draft.purposeId,
      sourceRef: draft.sourceRef,
      backdated: draft.backdated,
      reverses: draft.reverses,
    })
    .returning()

  // A conversion inserts its operation row FIRST, so its steps exist by the time
  // its postings name them; that call passes no postings here and appends them
  // itself. Every other caller passes them together.
  if (draft.postings.length === 0) {
    return {
      id: operation.id,
      occurredOn: operation.occurredOn,
      source: operation.source as FinanceOperationSource,
      purposeId: operation.purposeId,
      sourceRef: operation.sourceRef,
      backdated: operation.backdated,
      reverses: operation.reverses,
      postings: [],
    }
  }

  const inserted = await tx
    .insert(financePosting)
    .values(
      draft.postings.map((posting) => ({
        operationId: operation.id,
        accountId: posting.accountId,
        amount: posting.amount,
        currency: posting.currency,
        projectId: posting.projectId ?? null,
        categoryId: posting.categoryId ?? null,
        productId: posting.productId ?? null,
        memberId: posting.memberId ?? null,
        conversionStepId: resolveConversionStepId(posting, stepIdByNo),
      })),
    )
    .returning()

  return {
    id: operation.id,
    occurredOn: operation.occurredOn,
    source: operation.source as FinanceOperationSource,
    purposeId: operation.purposeId,
    sourceRef: operation.sourceRef,
    backdated: operation.backdated,
    reverses: operation.reverses,
    postings: inserted.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      amount: row.amount,
      currency: row.currency,
    })),
  }
}

/** The account rows the invariants need, keyed by id. */
export async function loadAccountFacts(
  tx: PlatformTx,
  postings: readonly PostingDraft[],
): Promise<ReadonlyMap<number, AccountFacts>> {
  const ids = [...new Set(postings.map((posting) => posting.accountId))]
  if (ids.length === 0) return new Map()
  const rows = await tx.select().from(financeAccount).where(inArray(financeAccount.id, ids))
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        currency: row.currency,
        kind: row.kind as AccountFacts['kind'],
        isSystem: row.isSystem,
        retiredAt: row.retiredAt,
      },
    ]),
  )
}

/** EARS-308 — a retired row stops being offered for NEW postings. */
export function assertNoRetiredAccount(accounts: ReadonlyMap<number, AccountFacts>): void {
  for (const account of accounts.values()) {
    if (account.retiredAt !== null) {
      throw new FinanceRefusal(
        `Счёт #${account.id} выведен из обращения: на уже записанных проводках он остаётся верным, ` +
          'но новые на него не записываются (EARS-308).',
      )
    }
  }
}

/** Which postings carry the P&L dimensions — the result legs of EARS-321/327. */
const RESULT_KINDS = new Set(['income', 'expense'])

/**
 * EARS-320/327/331 — apply the purpose to the postings before anything is
 * written.
 *
 * The binding is read from the purpose ROW and applied at OPERATION level, which
 * is what EARS-320 states: a `required` purpose refuses an operation that names
 * no product anywhere, a `forbidden` one refuses an operation that names one on
 * any leg. Per-posting would be the wrong grain — a money leg names no product
 * by construction, and a `required` purpose would then be unusable.
 *
 * The category (EARS-327) is set by the module itself on the RESULT-side
 * postings, and a caller-supplied category that differs from the purpose's is
 * refused: a purpose and its category can never disagree on a posting.
 */
export async function prepareDimensions(
  tx: PlatformTx,
  input: RecordOperationInput,
  accounts: ReadonlyMap<number, AccountFacts>,
): Promise<PostingDraft[]> {
  const postings = input.postings.map((posting) => ({ ...posting }))
  const namedProducts = postings
    .map((posting) => posting.productId)
    .filter((productId): productId is number => productId !== null && productId !== undefined)

  if (input.purposeId === null || input.purposeId === undefined) {
    if (namedProducts.length > 0) {
      throw new FinanceRefusal(
        'Продукт на проводке без назначения указать нельзя: привязка к продукту объявляется ' +
          'назначением (EARS-320/331), и без назначения правила нет.',
      )
    }
    return postings
  }

  const purpose = await requirePurpose(tx, input.purposeId)
  if (purpose.retiredAt !== null) {
    throw new FinanceRefusal(
      `Назначение «${purpose.name}» выведено из обращения и больше не предлагается для новых ` +
        'операций (EARS-308); уже записанные проводки оно по-прежнему описывает верно.',
    )
  }
  assertProductBinding(purpose.productBinding, namedProducts[0] ?? null, purpose.name)

  for (const posting of postings) {
    const account = accounts.get(posting.accountId)
    if (account === undefined || !RESULT_KINDS.has(account.kind)) continue
    posting.categoryId = resolvePostingCategory(
      purpose.categoryId,
      posting.categoryId,
      purpose.name,
    )
  }
  return postings
}
