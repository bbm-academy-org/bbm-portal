import { moscowToday } from '@/lib/finance/fx/rates'
import {
  buildMarketReport,
  MARKET_REPORT_PERIODS,
  marketReportPeriod,
  parseMarketReportPeriod,
} from '@/lib/finance/fx/market-report'
import { loadMarketValuation } from '@/lib/finance/fx/market-valuation'

import { DISPLAY_CURRENCY_CODES } from '../../requests/request-board-contract'

import { MarketRateShell } from './MarketRateShell'

/**
 * `/p/finance/reports/market-rate` «Курс против рынка» — spec 339 §J,
 * EARS-564…566, issue #559. The first `/p/finance/reports/…` route; F3 (#340)
 * adopts it into its reports navigation when it lands.
 *
 * The whole report — the total, both tables and every row's items, in each of
 * the three display currencies — is computed here, at read time, and nothing
 * is stored (EARS-553). Reading is open to every member, as the requests
 * queue is (§J preamble); the (platform) layout is the sign-in gate.
 */
export const dynamic = 'force-dynamic'

export default async function MarketRatePage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ period?: string | string[] }>
}) {
  const query = await searchParams
  const period = parseMarketReportPeriod(
    Array.isArray(query.period) ? query.period[0] : query.period,
  )
  const bounds = marketReportPeriod(period, moscowToday())
  const { entries, context, excludedChains } = await loadMarketValuation(
    bounds,
    DISPLAY_CURRENCY_CODES,
  )
  const report = buildMarketReport(
    entries,
    context,
    DISPLAY_CURRENCY_CODES,
    bounds,
    excludedChains.length,
  )
  return (
    <MarketRateShell
      report={report}
      period={period}
      periods={MARKET_REPORT_PERIODS}
      precisions={Object.fromEntries(context.precisions)}
    />
  )
}
