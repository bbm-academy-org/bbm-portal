/**
 * Currency conversions — ONE operation, ordered steps, frozen rates
 * (spec 338 EARS-318/319/328/329; Accounting policy, ruling 3).
 *
 * A conversion chain, however many exchanges it walks through, is a SINGLE
 * operation: the source money account is credited once at one end, the target
 * money account debited once at the other, and every intermediate currency rests
 * on the system `conversion` account. Each step records the actual rate as it
 * stood, as text, and is never restated (EARS-319).
 *
 * **Realized FX (EARS-328).** A disposal of a holding through a conversion is
 * the one event that establishes an actual rate, so it is the one event that
 * recognises a difference. The holding's cost is its WEIGHTED-AVERAGE RECORDED
 * rate — and this module reads that average off POSTINGS, not off re-multiplied
 * rate strings: across every earlier step that acquired the disposed currency
 * against the currency now received, the total received-currency spent over the
 * total disposed-currency acquired IS the average, already as a ratio of minimal
 * units. No lot tracking in v1 (ruling 3, stated), no revaluation ever
 * (EARS-319), and nothing at all when there is no conversion step (EARS-329).
 *
 * The FX difference lands on the fund's system `fx_result` account, never on a
 * product, with the system `conversion` account as the balancing counter-leg in
 * the same currency — which keeps EARS-311's per-currency zero-sum intact and
 * leaves the conversion account carrying the historical cost forward.
 */
import { and, eq, sql } from 'drizzle-orm'

import { financeConversionStep } from '@/lib/platform/db/schema/finance/finance-conversion-step'
import { financePosting } from '@/lib/platform/db/schema/finance/finance-posting'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import { assertFinanceWriteAccess, financeAuditContext, type FinanceActor } from './core/actor'
import { FinanceRefusal } from './core/errors'
import {
  assertBalancedPerCurrency,
  assertPostingCurrencyMatchesAccount,
  assertProjectOnResultPostings,
  type PostingDraft,
} from './core/invariants'
import { costBasisAtAverage, parseRate } from './core/money'
import {
  assertNoRetiredAccount,
  insertOperation,
  loadAccountFacts,
  resolveConversionStepId,
  type RecordedOperation,
} from './operations'
import {
  ensureSystemAccount,
  requireAccount,
  requireCurrency,
  requireFundProject,
} from './references'

/** One exchange in the chain, with the amounts and the rate as recorded. */
export type ConversionStepInput = {
  fromCurrency: string
  toCurrency: string
  /** Minimal units of `fromCurrency` that entered this exchange. */
  fromAmount: bigint
  /** Minimal units of `toCurrency` that came out of it. */
  toAmount: bigint
  /** As recorded: `toCurrency` major units per one `fromCurrency` major unit. */
  rate: string
  /** The exchange's own fee, as its own posting (EARS-318). */
  fee?: { amount: bigint; currency: string; projectId?: number | null } | null
}

export type RecordConversionInput = {
  occurredOn: string
  /** The money account the chain starts from (holds `steps[0].fromCurrency`). */
  sourceAccountId: number
  /** The money account the chain ends in (holds the last step's `toCurrency`). */
  targetAccountId: number
  steps: readonly ConversionStepInput[]
  source?: 'manual' | 'backfill' | 'bank_import' | 'request'
  backdated?: boolean
  sourceRef?: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function recordConversion(
  actor: FinanceActor,
  input: RecordConversionInput,
): Promise<RecordedOperation> {
  assertFinanceWriteAccess(actor)
  if (!ISO_DATE.test(input.occurredOn)) {
    throw new FinanceRefusal(
      `Дата операции «${input.occurredOn}» записана не в формате ГГГГ-ММ-ДД.`,
    )
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new FinanceRefusal(
      'Конвертация без шагов обмена — это не конвертация (EARS-318). ' +
        'Платёж или перевод в одной валюте записывается через recordOperation, и FX-результата ' +
        'по нему нет: леджер не знает для него курса (EARS-329).',
    )
  }
  for (const [index, step] of input.steps.entries()) {
    parseRate(step.rate)
    if (step.fromAmount <= 0n || step.toAmount <= 0n) {
      throw new FinanceRefusal(
        `Шаг обмена #${index + 1}: суммы обмена — положительные количества минимальных единиц.`,
      )
    }
    const previous = input.steps[index - 1]
    if (previous !== undefined && previous.toCurrency !== step.fromCurrency) {
      throw new FinanceRefusal(
        `Шаги обмена не стыкуются: шаг #${index} закончился в ${previous.toCurrency}, ` +
          `а шаг #${index + 1} начинается с ${step.fromCurrency}.`,
      )
    }
  }

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const first = input.steps[0]
    const last = input.steps[input.steps.length - 1]
    const sourceAccount = await requireAccount(tx, input.sourceAccountId)
    const targetAccount = await requireAccount(tx, input.targetAccountId)
    if (sourceAccount.currency !== first.fromCurrency) {
      throw new FinanceRefusal(
        `Счёт списания ведётся в ${sourceAccount.currency}, а обмен начинается с ${first.fromCurrency} (EARS-312).`,
      )
    }
    if (targetAccount.currency !== last.toCurrency) {
      throw new FinanceRefusal(
        `Счёт зачисления ведётся в ${targetAccount.currency}, а обмен заканчивается в ${last.toCurrency} (EARS-312).`,
      )
    }

    const fund = await requireFundProject(tx)
    const postings: PostingDraft[] = []

    // The chain's two ends: the money actually left one account and arrived in
    // another. Everything between them rests on the conversion account.
    postings.push({
      accountId: sourceAccount.id,
      amount: -first.fromAmount,
      currency: first.fromCurrency,
    })
    postings.push({
      accountId: targetAccount.id,
      amount: last.toAmount,
      currency: last.toCurrency,
    })

    for (const [index, step] of input.steps.entries()) {
      await requireCurrency(tx, step.fromCurrency)
      await requireCurrency(tx, step.toCurrency)
      const stepNo = index + 1
      const conversionFrom = await ensureSystemAccount(tx, 'conversion', step.fromCurrency)
      const conversionTo = await ensureSystemAccount(tx, 'conversion', step.toCurrency)
      // Both legs of the exchange carry the step, not only the fee: that is what
      // makes the weighted average of EARS-328 readable off recorded postings.
      postings.push({
        accountId: conversionFrom.id,
        amount: step.fromAmount,
        currency: step.fromCurrency,
        conversionStepNo: stepNo,
      })
      postings.push({
        accountId: conversionTo.id,
        amount: -step.toAmount,
        currency: step.toCurrency,
        conversionStepNo: stepNo,
      })

      if (step.fee != null && step.fee.amount !== 0n) {
        if (step.fee.amount < 0n) {
          throw new FinanceRefusal(`Комиссия шага #${stepNo} — положительная сумма расхода.`)
        }
        // The fee is charged against the MONEY account it was actually taken
        // from, not against the conversion clearing: a bank debits your account
        // for it. Keeping it off the conversion account also keeps that
        // account's step-linked legs exactly the two exchange legs, which is
        // what makes the weighted average of EARS-328 exact rather than
        // approximately right.
        const feeMoneyAccount =
          step.fee.currency === sourceAccount.currency
            ? sourceAccount
            : step.fee.currency === targetAccount.currency
              ? targetAccount
              : null
        if (feeMoneyAccount === null) {
          throw new FinanceRefusal(
            `Комиссия шага #${stepNo} в ${step.fee.currency} не может быть списана: ни счёт ` +
              `списания (${sourceAccount.currency}), ни счёт зачисления (${targetAccount.currency}) ` +
              'не ведётся в этой валюте. Комиссия в третьей валюте — это отдельная операция.',
          )
        }
        const feeExpense = await ensureSystemAccount(tx, 'expense', step.fee.currency)
        postings.push({
          accountId: feeExpense.id,
          amount: step.fee.amount,
          currency: step.fee.currency,
          projectId: step.fee.projectId ?? fund.id,
          conversionStepNo: stepNo,
        })
        postings.push({
          accountId: feeMoneyAccount.id,
          amount: -step.fee.amount,
          currency: step.fee.currency,
          conversionStepNo: stepNo,
        })
      }

      // EARS-328 — the realized difference on THIS step's disposal, if the
      // ledger holds an average to compare the actual rate against.
      //
      // The two FX legs deliberately carry NO conversion-step link: the average
      // is read off step-linked conversion-account legs, and an FX leg is not an
      // exchange leg. Linking it would let this operation's own result silently
      // re-enter the average that prices the next disposal.
      const realized = await realizedFxResult(tx, step)
      if (realized !== 0n) {
        const fxAccount = await ensureSystemAccount(tx, 'fx_result', step.toCurrency)
        const fxCounter = await ensureSystemAccount(tx, 'conversion', step.toCurrency)
        postings.push({
          accountId: fxAccount.id,
          amount: -realized,
          currency: step.toCurrency,
          projectId: fund.id,
        })
        postings.push({
          accountId: fxCounter.id,
          amount: realized,
          currency: step.toCurrency,
        })
      }
    }

    const accounts = await loadAccountFacts(tx, postings)
    assertNoRetiredAccount(accounts)
    assertPostingCurrencyMatchesAccount(postings, accounts)
    assertProjectOnResultPostings(postings, accounts)
    assertBalancedPerCurrency(postings)

    // The operation row first, then its steps, then the postings that name them.
    const stepIdByNo = new Map<number, number>()
    const operation = await insertOperation(
      tx,
      {
        occurredOn: input.occurredOn,
        source: input.source ?? 'manual',
        // A conversion carries no purpose — it is a movement, not a spend
        // (the spec's data-model table).
        purposeId: null,
        sourceRef: input.sourceRef ?? null,
        backdated: input.backdated ?? false,
        reverses: null,
        postings: [],
      },
      stepIdByNo,
    )
    for (const [index, step] of input.steps.entries()) {
      const [row] = await tx
        .insert(financeConversionStep)
        .values({
          operationId: operation.id,
          stepNo: index + 1,
          fromCurrency: step.fromCurrency,
          toCurrency: step.toCurrency,
          rate: step.rate,
        })
        .returning()
      stepIdByNo.set(index + 1, row.id)
    }
    const withPostings = await appendPostings(tx, operation, postings, stepIdByNo)
    return withPostings
  })
}

/**
 * The realized FX difference of one disposal step, in `toCurrency` minimal units
 * (EARS-328).
 *
 * Positive is a gain. Zero — including «the ledger has never recorded an
 * acquisition of this currency against that one» — means nothing is posted:
 * without a recorded acquisition there is no cost to compare against, and
 * inventing one would be exactly the restatement EARS-319 forbids.
 */
async function realizedFxResult(tx: PlatformTx, step: ConversionStepInput): Promise<bigint> {
  // Two independent aggregates, not a join: a join would multiply rows the
  // moment a step ever carries more than one leg per side. The filters name the
  // EXCHANGE legs exactly — step-linked, on the system `conversion` account —
  // which is why fee legs (money + expense accounts) and FX legs (unlinked) can
  // never enter the average.
  const acquired = await tx.execute(sql`
    select
      (select coalesce(sum(p.amount), 0)
         from core.finance_conversion_step cs
         join core.finance_posting p on p.conversion_step_id = cs.id
         join core.finance_account a on a.id = p.account_id and a.kind = 'conversion'
        where cs.from_currency = ${step.toCurrency}
          and cs.to_currency = ${step.fromCurrency}
          and p.currency = ${step.toCurrency}
          and p.amount > 0)::text as total_to_spent,
      (select coalesce(-sum(p.amount), 0)
         from core.finance_conversion_step cs
         join core.finance_posting p on p.conversion_step_id = cs.id
         join core.finance_account a on a.id = p.account_id and a.kind = 'conversion'
        where cs.from_currency = ${step.toCurrency}
          and cs.to_currency = ${step.fromCurrency}
          and p.currency = ${step.fromCurrency}
          and p.amount < 0)::text as total_from_acquired
  `)
  const row = (acquired.rows[0] ?? {}) as { total_to_spent?: string; total_from_acquired?: string }
  const totalToSpent = BigInt(row.total_to_spent ?? '0')
  const totalFromAcquired = BigInt(row.total_from_acquired ?? '0')
  if (totalFromAcquired === 0n) return 0n
  const basis = costBasisAtAverage(step.fromAmount, totalToSpent, totalFromAcquired)
  return step.toAmount - basis
}

/** The postings of a conversion, written after its steps exist to be named. */
async function appendPostings(
  tx: PlatformTx,
  operation: RecordedOperation,
  postings: readonly PostingDraft[],
  stepIdByNo: ReadonlyMap<number, number>,
): Promise<RecordedOperation> {
  const inserted = await tx
    .insert(financePosting)
    .values(
      postings.map((posting) => ({
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
    ...operation,
    postings: inserted.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      amount: row.amount,
      currency: row.currency,
    })),
  }
}

/** The steps of one operation, in order — read side for F3 and the tests. */
export async function conversionStepsOf(
  tx: PlatformTx,
  operationId: number,
): Promise<{ stepNo: number; fromCurrency: string; toCurrency: string; rate: string }[]> {
  const rows = await tx
    .select()
    .from(financeConversionStep)
    .where(and(eq(financeConversionStep.operationId, operationId)))
  return rows
    .map((row) => ({
      stepNo: row.stepNo,
      fromCurrency: row.fromCurrency,
      toCurrency: row.toCurrency,
      rate: row.rate,
    }))
    .sort((a, b) => a.stepNo - b.stepNo)
}
