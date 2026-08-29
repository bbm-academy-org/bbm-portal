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
 * leaves the conversion account carrying the historical cost forward. That
 * account is a CLEARING account and holds nothing of its own: once every unit
 * acquired has been disposed of, it reads zero, and a residue there is the
 * ledger evidencing a mispriced disposal.
 *
 * ## Named limitation of F1a — the pool is per CURRENCY PAIR
 *
 * `realizedFxResult` prices a disposal against the holding acquired **against
 * the currency now being received**. So a holding acquired one way and disposed
 * of another — buy USDT with RUB, sell that USDT for THB — finds no pool and
 * recognises NOTHING, silently, even though its recorded cost is perfectly well
 * defined. The same applies to every leg but the first of a multi-step chain,
 * and to any holding that arrived other than by conversion (income received in
 * USDT).
 *
 * This is deliberate for F1a and is the reading that restates nothing: a
 * cross-pair basis would have to be carried through a currency the operation
 * never touched, i.e. through a rate the ledger did not record. It is a real
 * product limitation, not a subtlety of a SQL predicate, and lifting it is F2/F3
 * work — a single holding pool per currency, valued in one reporting currency,
 * with the rate source that implies.
 */
import { and, eq, sql } from 'drizzle-orm'

import { financeConversionStep } from '@/lib/platform/db/schema/finance/finance-conversion-step'
import { financePosting } from '@/lib/platform/db/schema/finance/finance-posting'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import { assertFinanceLedgerAccess, financeAuditContext, type FinanceActor } from './core/actor'
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
  callerTx?: PlatformTx,
): Promise<RecordedOperation> {
  assertFinanceLedgerAccess(actor)
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
    // The AMOUNT has to carry through as well, not only the currency. Without
    // this the mismatch is still caught — by `assertBalancedPerCurrency`'s
    // generic «не сходятся в ноль» — but that message sends the admin looking at
    // the wrong thing entirely (EARS-326 asks for the readable refusal).
    if (previous !== undefined && previous.toAmount !== step.fromAmount) {
      throw new FinanceRefusal(
        `Шаги обмена не стыкуются по сумме: шаг #${index} дал ${previous.toAmount} ` +
          `${previous.toCurrency} (в минимальных единицах), а шаг #${index + 1} забирает ` +
          `${step.fromAmount}. Промежуточная валюта нигде не оседает — цепочка проходит её ` +
          'насквозь; комиссия шага записывается отдельной проводкой, а не разницей сумм.',
      )
    }
  }

  const record = async (tx: PlatformTx) => {
    const first = input.steps[0]
    const last = input.steps[input.steps.length - 1]
    const sourceAccount = await requireAccount(tx, input.sourceAccountId)
    const targetAccount = await requireAccount(tx, input.targetAccountId)
    // A chain runs between the owner's OWN accounts. Letting a system account in
    // is not merely untidy: pass the `conversion` account as source and a fee
    // leg lands on a conversion account WITH a step link — the one combination
    // that would contaminate the EARS-328 average, which is read off exactly
    // those legs.
    for (const [role, account] of [
      ['списания', sourceAccount],
      ['зачисления', targetAccount],
    ] as const) {
      if (account.isSystem) {
        throw new FinanceRefusal(
          `Счётом ${role} в конвертации не может быть системный счёт «${account.name}» ` +
            `(вид ${account.kind}, EARS-305): модуль ведёт его сам, и через него проходят ` +
            'служебные плечи обмена. Обмен идёт между денежными счетами — bank, card, crypto, cash.',
        )
      }
    }
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
  }
  return callerTx === undefined
    ? platformTransaction(financeAuditContext(actor), record)
    : record(callerTx)
}

/**
 * The realized FX difference of one disposal step, in `toCurrency` minimal units
 * (EARS-328). Positive is a gain.
 *
 * **Moving average over the REMAINING holding, not a lifetime average.** Ruling
 * 3 names «the holding's weighted-average recorded rate … the standard cost-flow
 * assumption for a fungible holding», and the standard assumption tracks a pool
 * that DEPLETES: every disposal removes both quantity and its share of the cost.
 * Averaging every acquisition ever made instead diverges the moment an
 * acquisition follows a disposal, and the divergence is not academic — it posts
 * a gain no cash movement backs, and leaves the `conversion` clearing account
 * holding a residue that corresponds to nothing. So the prior steps of the pair
 * are REPLAYED in chronological order, in both directions, and the pool that
 * comes out the far end is what prices this disposal.
 *
 * **A reversal nets out because the legs are SUMMED, not sign-filtered.** A
 * сторно mirrors each leg with the opposite sign and the SAME
 * `conversion_step_id`, so a fully reversed step aggregates to zero on both
 * sides and contributes neither quantity nor cost — which is EARS-314's «their
 * sum shall be zero in every cut» applied to the cut this function computes. An
 * earlier `amount > 0` / `amount < 0` predicate excluded exactly the mirror leg
 * and so kept reversed purchases alive in the average.
 *
 * The legs that count are named exactly: step-linked AND on a system
 * `conversion` account. Fee legs sit on money and expense accounts, FX legs
 * carry no step link, so neither can enter the average, and an operation's own
 * result can never price the next disposal.
 *
 * **Scope, and its limit:** the pool is per CURRENCY PAIR. Acquire USDT with RUB
 * and dispose of it for THB and this function has no pool to price against, so
 * it posts nothing — the named limitation recorded in the module header.
 *
 * Zero — no remaining holding, or none ever acquired against this currency —
 * means nothing is posted at all: without a recorded acquisition there is no
 * cost to compare against, and inventing one is the restatement EARS-319 forbids.
 */
async function realizedFxResult(tx: PlatformTx, step: ConversionStepInput): Promise<bigint> {
  // One row per PRIOR step of the pair, in either direction, with its two sides
  // aggregated. `filter (where …)` rather than two subqueries: the sides must
  // come from the same step to be replayed together, and summing (rather than
  // filtering by sign) is what makes a сторно cancel its original.
  const steps = await tx.execute(sql`
    select cs.from_currency,
           coalesce(sum(p.amount) filter (where p.currency = cs.from_currency), 0)::text as net_from,
           coalesce(sum(p.amount) filter (where p.currency = cs.to_currency), 0)::text   as net_to
      from core.finance_conversion_step cs
      join core.finance_operation o on o.id = cs.operation_id
      join core.finance_posting p on p.conversion_step_id = cs.id
      join core.finance_account a on a.id = p.account_id and a.kind = 'conversion'
     where (cs.from_currency = ${step.fromCurrency} and cs.to_currency = ${step.toCurrency})
        or (cs.from_currency = ${step.toCurrency} and cs.to_currency = ${step.fromCurrency})
     group by cs.id, cs.from_currency, cs.to_currency, o.occurred_on, o.id, cs.step_no
     order by o.occurred_on, o.id, cs.step_no
  `)

  // The remaining holding of the currency being disposed of now, and the cost it
  // was acquired at, expressed in the currency now being received.
  let heldQuantity = 0n
  let heldCost = 0n

  for (const raw of steps.rows as Record<string, unknown>[]) {
    const netFrom = BigInt(String(raw.net_from))
    const netTo = BigInt(String(raw.net_to))

    if (String(raw.from_currency) === step.toCurrency) {
      // An ACQUISITION of the disposed currency, paid for in the received one.
      heldQuantity += -netTo
      heldCost += netFrom
      continue
    }
    // An earlier DISPOSAL: it takes its quantity out of the pool, and with it
    // the share of the cost that quantity carried at the time.
    const disposed = netFrom
    if (disposed <= 0n || heldQuantity <= 0n) continue
    const consumed =
      disposed >= heldQuantity ? heldCost : costBasisAtAverage(disposed, heldCost, heldQuantity)
    heldQuantity -= disposed
    heldCost -= consumed
    if (heldQuantity <= 0n) {
      heldQuantity = 0n
      heldCost = 0n
    }
  }

  if (heldQuantity <= 0n || heldCost <= 0n) return 0n
  const basis =
    step.fromAmount >= heldQuantity
      ? heldCost
      : costBasisAtAverage(step.fromAmount, heldCost, heldQuantity)
  return step.toAmount - basis
}

/** The postings of a conversion, written after its steps exist to be named. */
export async function appendPostings(
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
