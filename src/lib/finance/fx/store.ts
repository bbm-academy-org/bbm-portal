/**
 * The stored Bank of Russia series — sync, lookup and display conversion
 * (spec `docs/specs/339-ledger-intake.md` §I, EARS-550/552/553; issue #548).
 *
 * `syncCbrRates` is the ONLY writer of `core.finance_fx_rate`: it asks cbr.ru
 * for every calendar day of a range, keeps each answer under its EFFECTIVE date
 * (a Sunday asked answers with Saturday's document, which the unique key then
 * folds into the row already there), and runs one audited transaction per day
 * under `system:finance-fx-sync` — so a network failure on day 40 of a
 * backfill keeps the 39 already stored, and the re-run starts where it stopped.
 * The network call is never inside a transaction.
 *
 * Nothing in the ledger reads this file (EARS-553, asserted by
 * `tests/unit/finance-fx-display-rule.spec.ts`).
 */
import { and, desc, eq, gte, inArray, lte, max } from 'drizzle-orm'

import { getPlatformDb } from '@/lib/platform/db/client'
import { financeCurrency } from '@/lib/platform/db/schema/finance/finance-currency'
import { financeFxRate } from '@/lib/platform/db/schema/finance/finance-fx-rate'
import { platformTransaction, type AuditContext } from '@/lib/platform/db/transaction'

import { fetchCbrDaily, type CbrDaily } from './cbr'
import {
  addDays,
  convertAtRubRates,
  moscowToday,
  RUB_RATE,
  type ExactAmount,
  type FxRate,
} from './rates'

export const FX_SOURCE_CBR = 'cbr'

/** The sync's door in the audit ledger (spec 201 EARS-7). */
export const FX_SYNC_AUDIT_CONTEXT: AuditContext = {
  actorEmail: null,
  source: 'system:finance-fx-sync',
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The latest stored quote of `currency` effective on or before `date`, or `null` (EARS-552). */
export async function rateOn(currency: string, date: string): Promise<FxRate | null> {
  if (currency === 'RUB') return { ...RUB_RATE, rateDate: date }
  const [row] = await getPlatformDb()
    .select({
      currency: financeFxRate.currency,
      rateDate: financeFxRate.rateDate,
      nominal: financeFxRate.nominal,
      valueRub: financeFxRate.valueRub,
    })
    .from(financeFxRate)
    .where(
      and(
        eq(financeFxRate.source, FX_SOURCE_CBR),
        eq(financeFxRate.currency, currency),
        lte(financeFxRate.rateDate, date),
      ),
    )
    .orderBy(desc(financeFxRate.rateDate))
    .limit(1)
  return row ?? null
}

/**
 * Every stored quote of `currencies` effective from `from` through `to`,
 * inclusive — one read for a valuation over many dates (§J, EARS-558), which
 * then picks per date with `pickRateOn`'s rule.
 */
export async function rateSeries(
  currencies: readonly string[],
  from: string,
  to: string,
): Promise<FxRate[]> {
  const quoted = currencies.filter((c) => c !== 'RUB')
  if (quoted.length === 0) return []
  return getPlatformDb()
    .select({
      currency: financeFxRate.currency,
      rateDate: financeFxRate.rateDate,
      nominal: financeFxRate.nominal,
      valueRub: financeFxRate.valueRub,
    })
    .from(financeFxRate)
    .where(
      and(
        eq(financeFxRate.source, FX_SOURCE_CBR),
        inArray(financeFxRate.currency, quoted),
        gte(financeFxRate.rateDate, from),
        lte(financeFxRate.rateDate, to),
      ),
    )
    .orderBy(financeFxRate.rateDate)
}

/** The newest effective date stored — what the stale-rates notice reads (EARS-552). */
export async function latestRateDate(): Promise<string | null> {
  const [row] = await getPlatformDb()
    .select({ latest: max(financeFxRate.rateDate) })
    .from(financeFxRate)
    .where(eq(financeFxRate.source, FX_SOURCE_CBR))
  return row?.latest ?? null
}

export type DisplayConversion =
  | {
      kind: 'converted'
      /** Minimal units of the target currency, rounded once. */
      amount: bigint
      /** The unrounded value, for sums that round once at the end (EARS-549). */
      exact: ExactAmount
      /** The quotes used — their `rateDate` is what the screen names. */
      rates: { from: FxRate; to: FxRate }
    }
  /** CBR has no quote on or before `date` for `currency` (EARS-551 renders it). */
  | { kind: 'no_rate'; currency: string; date: string }

/**
 * Convert `amount` (minimal units of `from`) into `to` at the CBR rates in
 * force on `date`, crossing through RUB (EARS-550). Precisions come from
 * `core.finance_currency`; a currency the ledger does not register is treated
 * like one CBR does not quote — «no rate», never a guessed precision.
 */
export async function convertForDisplay(
  amount: bigint,
  from: string,
  to: string,
  date: string,
): Promise<DisplayConversion> {
  const currencies = await getPlatformDb()
    .select({ code: financeCurrency.code, precision: financeCurrency.precision })
    .from(financeCurrency)
    .where(inArray(financeCurrency.code, [from, to]))
  const precision = new Map(currencies.map((c) => [c.code, c.precision]))
  for (const code of [from, to]) {
    if (!precision.has(code)) return { kind: 'no_rate', currency: code, date }
  }
  const fromRate = await rateOn(from, date)
  if (fromRate === null) return { kind: 'no_rate', currency: from, date }
  const toRate = await rateOn(to, date)
  if (toRate === null) return { kind: 'no_rate', currency: to, date }
  const converted = convertAtRubRates(
    amount,
    fromRate,
    toRate,
    precision.get(from) as number,
    precision.get(to) as number,
  )
  return { kind: 'converted', ...converted, rates: { from: fromRate, to: toRate } }
}

export type FxSyncOptions = {
  /** First date to ask for; default — the newest stored effective date, else `to`. */
  from?: string
  /** Last date to ask for; default — today in Moscow. */
  to?: string
  /** Overrides «today» (tests). */
  today?: string
  /** The per-day fetcher; default — cbr.ru. */
  fetchDaily?: (date: string) => Promise<CbrDaily>
  /** Progress line per day (the CLI prints it). */
  onDay?: (report: {
    date: string
    effectiveDate: string
    quoted: number
    inserted: number
  }) => void
}

export type FxSyncSummary = {
  from: string
  to: string
  days: number
  inserted: number
}

/** Fetch every day of the range from cbr.ru and store what is not stored yet (EARS-552). */
export async function syncCbrRates(options: FxSyncOptions = {}): Promise<FxSyncSummary> {
  const today = options.today ?? moscowToday()
  const to = options.to ?? today
  // A manual `--to <tomorrow>` leaves the last stored date after today; resume
  // from no later than `to`, so the next morning's run does not fail on from > to.
  let from = options.from
  if (from === undefined) {
    const latest = await latestRateDate()
    from = latest !== null && latest < to ? latest : to
  }
  for (const [name, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (!ISO_DATE.test(value))
      throw new Error(`fx sync: --${name} must be YYYY-MM-DD, got «${value}»`)
  }
  if (from > to) throw new Error(`fx sync: --from ${from} is after --to ${to}`)
  // CBR sets tomorrow's rate in the afternoon; anything later is not a rate yet.
  if (to > addDays(today, 1)) {
    throw new Error(`fx sync: --to ${to} is in the future (today in Moscow is ${today})`)
  }

  const fetchDaily = options.fetchDaily ?? ((date: string) => fetchCbrDaily(date))
  let inserted = 0
  let days = 0
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const daily = await fetchDaily(date)
    const written =
      daily.rates.length === 0
        ? 0
        : await platformTransaction(FX_SYNC_AUDIT_CONTEXT, async (tx) => {
            const rows = await tx
              .insert(financeFxRate)
              .values(
                daily.rates.map((r) => ({
                  source: FX_SOURCE_CBR,
                  currency: r.currency,
                  rateDate: daily.effectiveDate,
                  nominal: r.nominal,
                  valueRub: r.valueRub,
                })),
              )
              .onConflictDoNothing({
                target: [financeFxRate.source, financeFxRate.currency, financeFxRate.rateDate],
              })
              .returning({ id: financeFxRate.id })
            return rows.length
          })
    inserted += written
    days += 1
    options.onDay?.({
      date,
      effectiveDate: daily.effectiveDate,
      quoted: daily.rates.length,
      inserted: written,
    })
  }
  return { from, to, days, inserted }
}
