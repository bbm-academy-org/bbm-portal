/**
 * Minimal-unit arithmetic (spec 338 EARS-310, EARS-318, EARS-328).
 *
 * Every amount in this ledger is a signed `bigint` count of the currency's
 * MINIMAL units, and every number here stays a `bigint` from end to end: the
 * moment a rate multiplication passes through `number`, a USDT amount past 2^53
 * minimal units is quietly wrong, and «quietly wrong money» is the one class of
 * defect a ledger exists to make impossible.
 *
 * A rate is TEXT as recorded (EARS-319) and is parsed, never re-serialized: this
 * file reads `"34.5"` as the exact pair (345, scale 1) and does integer
 * arithmetic with it.
 *
 * **Orientation is the CALLER's to establish.** `convertMinorUnits` multiplies:
 * it treats `rate` as `to` major units per one `from` major unit, and a caller
 * holding the inverse quote inverts it before calling. This is deliberately NOT
 * asserted against `finance_conversion_step.rate`, whose orientation is not
 * machine-determinable — see that file's header for why the recorded rate is
 * testimony and the amounts are the fact. Nothing in F1a applies this function
 * to a stored rate; it is here for the intakes (F2) that compute an amount from
 * a quote whose orientation they know, and for F3's display arithmetic.
 */
import { FinanceRefusal } from './errors'

/** `123`, `0.5`, `34.50` — the shape the `finance_conversion_step` CHECK allows. */
const DECIMAL_LITERAL = /^[0-9]+(\.[0-9]+)?$/

/** The parsed rate: `value / 10^scale` is the exact decimal that was recorded. */
export type ParsedRate = { value: bigint; scale: number }

/**
 * Parse a recorded rate, refusing anything that is not a POSITIVE decimal
 * literal. A comma decimal separator, a minus sign and an exponent are all
 * refused here rather than at the database: EARS-326 wants the readable message.
 */
export function parseRate(rate: string): ParsedRate {
  if (typeof rate !== 'string' || !DECIMAL_LITERAL.test(rate)) {
    throw new FinanceRefusal(
      `Курс «${rate}» записан не как десятичное число: допустимы только цифры и точка ` +
        '(например «34.5»). Курс хранится ровно так, как записан, и никогда не пересчитывается (EARS-319).',
    )
  }
  const [whole, fraction = ''] = rate.split('.')
  const value = BigInt(whole + fraction)
  if (value === 0n) {
    throw new FinanceRefusal(
      `Курс «${rate}» равен нулю — конвертация по нулевому курсу не факт, а ошибка.`,
    )
  }
  return { value, scale: fraction.length }
}

/** 10^n as a bigint, without going through `Math.pow`. */
function pow10(n: number): bigint {
  return 10n ** BigInt(n)
}

/**
 * Divide, rounding HALF AWAY FROM ZERO.
 *
 * Half-away-from-zero rather than banker's rounding because that is what the
 * money side of the estate already does — spec 081 §6's `Math.round` order,
 * inherited by `/p/hours` — and a ledger whose two halves round differently
 * produces reconciliation differences nobody can explain.
 */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const absNumerator = numerator < 0n ? -numerator : numerator
  const absDenominator = denominator < 0n ? -denominator : denominator
  const quotient = (2n * absNumerator + absDenominator) / (2n * absDenominator)
  return negative ? -quotient : quotient
}

/**
 * Apply a recorded rate to an amount in minimal units (EARS-310, EARS-318).
 *
 * `amountFrom` is in `from`'s minimal units, the result is in `to`'s. The two
 * precisions are arguments and not a lookup, so this function stays pure and the
 * caller — which already holds the currency rows — cannot silently apply a THB
 * precision to a USDT amount.
 */
export function convertMinorUnits(
  amountFrom: bigint,
  rate: string,
  precisionFrom: number,
  precisionTo: number,
): bigint {
  const { value, scale } = parseRate(rate)
  // amountTo = amountFrom × rate × 10^(precisionTo − precisionFrom)
  //          = amountFrom × value × 10^precisionTo / (10^scale × 10^precisionFrom)
  return divideRounded(amountFrom * value * pow10(precisionTo), pow10(scale + precisionFrom))
}

/**
 * The cost basis of a disposal at a weighted-average recorded rate (EARS-328).
 *
 * The average arrives already as a RATIO OF MINIMAL UNITS — total `to` spent
 * over total `from` acquired, both read off recorded postings — so the two
 * precisions cancel and no rate string is involved at all. That is the point:
 * the average is derived from what was posted, never from re-multiplied rates,
 * so nothing is restated (EARS-319).
 */
export function costBasisAtAverage(
  amountFrom: bigint,
  totalToSpent: bigint,
  totalFromAcquired: bigint,
): bigint {
  if (totalFromAcquired === 0n) {
    throw new FinanceRefusal(
      'Средневзвешенный курс не определён: в леджере нет ни одной записанной покупки этой валюты ' +
        'за валюту выбытия, а курс из воздуха — это как раз восстановление факта, которое EARS-319 запрещает.',
    )
  }
  return divideRounded(amountFrom * totalToSpent, totalFromAcquired)
}
