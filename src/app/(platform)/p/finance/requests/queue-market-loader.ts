import { loadMarketValuation } from '@/lib/finance'

import { DISPLAY_CURRENCY_CODES, type RequestMarketBlock } from './request-board-contract'
import { requestMarketBlocks } from './queue-market'

/**
 * The SERVER half of the details sheet's «Курс против рынка» block (spec 339
 * EARS-563, #551): ONE read of the #558 market valuation for the board — every
 * foreign-currency payment and «факт не внесён» request, valued — keyed by
 * request id. The display currencies are loaded into the same rate context, so
 * the block's ₽ / $ / € figures follow EARS-566 without a second read.
 *
 * It lives in the requests queue directory because that is the consumer
 * EARS-553's isolation test allows; the requests API route only calls it.
 */
export async function loadQueueMarket(): Promise<Map<number, RequestMarketBlock>> {
  const { entries, context } = await loadMarketValuation({}, DISPLAY_CURRENCY_CODES)
  return requestMarketBlocks(entries, context)
}
