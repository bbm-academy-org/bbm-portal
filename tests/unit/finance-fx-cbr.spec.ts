// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CBR_DAILY_URL,
  cbrDailyUrl,
  CbrResponseError,
  fetchCbrDaily,
  parseCbrDaily,
} from '@/lib/finance/fx/cbr'
import {
  convertAtRubRates,
  moscowToday,
  pickRateOn,
  RUB_RATE,
  type FxRate,
} from '@/lib/finance/fx/rates'

/**
 * The Bank of Russia rate source (spec `docs/specs/339-ledger-intake.md` §I,
 * EARS-550/552, issue #548).
 *
 * The fixtures under `fixtures/cbr/` are the bytes cbr.ru served on 2026-11-17
 * for `XML_daily.asp?date_req=…`, untouched: windows-1251, comma decimals, the
 * `Nominal` that says how many units `Value` prices. No network runs here.
 *
 *  - `xml-daily-req-2026-11-15.xml` — asked for a SUNDAY; `ValCurs/@Date` is
 *    `14.11.2026`, the Saturday rate that holds over the weekend;
 *  - `xml-daily-req-2026-11-13.xml` — a Friday, `ValCurs/@Date` = the day asked.
 */
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cbr')
const SUNDAY_BYTES = new Uint8Array(readFileSync(join(FIXTURES, 'xml-daily-req-2026-11-15.xml')))
const FRIDAY_BYTES = new Uint8Array(readFileSync(join(FIXTURES, 'xml-daily-req-2026-11-13.xml')))

function rate(currency: string, rateDate: string, nominal: number, valueRub: string): FxRate {
  return { currency, rateDate, nominal, valueRub }
}

describe('the CBR daily XML (EARS-552)', () => {
  it('EARS-552: a weekend date_req yields the effective date CBR stamps on ValCurs, not the date asked', () => {
    const daily = parseCbrDaily(SUNDAY_BYTES)
    expect(daily.effectiveDate).toBe('2026-11-14')
  })

  it('EARS-552: Value is kept as exact decimal text with its Nominal — THB is quoted per 10 units', () => {
    const daily = parseCbrDaily(SUNDAY_BYTES)
    const byCode = new Map(daily.rates.map((r) => [r.currency, r]))
    expect(byCode.get('USD')).toEqual({ currency: 'USD', nominal: 1, valueRub: '82.1516' })
    expect(byCode.get('EUR')).toEqual({ currency: 'EUR', nominal: 1, valueRub: '91.0322' })
    expect(byCode.get('THB')).toEqual({ currency: 'THB', nominal: 10, valueRub: '24.2629' })
    expect(byCode.get('JPY')).toEqual({ currency: 'JPY', nominal: 100, valueRub: '51.3897' })
    for (const r of daily.rates) {
      expect(typeof r.valueRub).toBe('string')
      expect(r.valueRub).toMatch(/^[0-9]+\.[0-9]+$/)
    }
  })

  it('EARS-552: the response is decoded as windows-1251, so a decoded string parses the same', () => {
    const decoded = new TextDecoder('windows-1251').decode(FRIDAY_BYTES)
    expect(decoded).toContain('Доллар США')
    expect(parseCbrDaily(decoded)).toEqual(parseCbrDaily(FRIDAY_BYTES))
    expect(parseCbrDaily(FRIDAY_BYTES).effectiveDate).toBe('2026-11-13')
  })

  it('EARS-552: a body that is not a CBR ValCurs document is refused, never read as «no rates»', () => {
    expect(() => parseCbrDaily('<html>Service unavailable</html>')).toThrow(CbrResponseError)
    expect(() =>
      parseCbrDaily(
        '<ValCurs Date="14.11.2026"><Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>8x,1</Value></Valute></ValCurs>',
      ),
    ).toThrow(CbrResponseError)
  })

  it('EARS-552: the request URL is XML_daily.asp with date_req in DD/MM/YYYY', () => {
    expect(CBR_DAILY_URL).toBe('https://www.cbr.ru/scripts/XML_daily.asp')
    expect(cbrDailyUrl('2026-11-15')).toBe(
      'https://www.cbr.ru/scripts/XML_daily.asp?date_req=15/11/2026',
    )
  })

  it('EARS-552: the client fetches that URL and parses the raw bytes it gets back', async () => {
    const seen: string[] = []
    const fakeFetch = (async (url: string) => {
      seen.push(url)
      return new Response(SUNDAY_BYTES, {
        status: 200,
        headers: { 'content-type': 'application/xml; charset=windows-1251' },
      })
    }) as unknown as typeof fetch
    const daily = await fetchCbrDaily('2026-11-15', fakeFetch)
    expect(seen).toEqual(['https://www.cbr.ru/scripts/XML_daily.asp?date_req=15/11/2026'])
    expect(daily.effectiveDate).toBe('2026-11-14')
  })

  it('EARS-552: a non-2xx answer from cbr.ru is an error, not an empty day', async () => {
    const fakeFetch = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch
    await expect(fetchCbrDaily('2026-11-15', fakeFetch)).rejects.toThrow(CbrResponseError)
  })
})

describe('the rate lookup (EARS-552)', () => {
  const sunday = parseCbrDaily(SUNDAY_BYTES)
  const friday = parseCbrDaily(FRIDAY_BYTES)
  const series: FxRate[] = [friday, sunday].flatMap((d) =>
    d.rates.map((r) => rate(r.currency, d.effectiveDate, r.nominal, r.valueRub)),
  )

  it("EARS-552: rateOn for a Sunday returns the rate whose rate_date is the fixture's ValCurs/@Date", () => {
    const found = pickRateOn(series, 'USD', '2026-11-15')
    expect(found).toEqual(rate('USD', '2026-11-14', 1, '82.1516'))
  })

  it('EARS-552: between stored dates the NEAREST PREVIOUS effective date wins', () => {
    expect(pickRateOn(series, 'USD', '2026-11-13')?.rateDate).toBe('2026-11-13')
    expect(pickRateOn(series, 'USD', '2026-11-14')?.rateDate).toBe('2026-11-14')
    expect(pickRateOn(series, 'EUR', '2026-12-31')?.rateDate).toBe('2026-11-14')
  })

  it('EARS-552: a date before the first stored rate, or a currency CBR does not quote, is «no rate»', () => {
    expect(pickRateOn(series, 'USD', '2026-11-12')).toBeNull()
    expect(pickRateOn(series, 'USDT', '2026-11-15')).toBeNull()
  })

  it('EARS-552: RUB needs no quote — it is the cross currency itself', () => {
    expect(pickRateOn(series, 'RUB', '2020-01-01')).toEqual({ ...RUB_RATE, rateDate: '2020-01-01' })
  })

  it('EARS-552: «today» is the Moscow calendar date, not the UTC one', () => {
    // 22:30 UTC on the 16th is already 01:30 on the 17th in Moscow (UTC+3).
    expect(moscowToday(new Date('2026-11-16T22:30:00Z'))).toBe('2026-11-17')
    expect(moscowToday(new Date('2026-11-16T20:59:00Z'))).toBe('2026-11-16')
  })
})

describe('the display conversion (EARS-550)', () => {
  const usd = rate('USD', '2026-11-14', 1, '82.1516')
  const eur = rate('EUR', '2026-11-14', 1, '91.0322')
  const thb = rate('THB', '2026-11-14', 10, '24.2629')

  it('EARS-550: USD→EUR crosses through RUB and round-trips back to the cent', () => {
    const toEur = convertAtRubRates(10_000n, usd, eur, 2, 2) // $100.00
    // 100 × 82.1516 / 91.0322 = 90.24459… → €90.24
    expect(toEur.amount).toBe(9_024n)
    // Back again from the ROUNDED €90.24: within one cent of the start (99.99),
    // which is the most a single display rounding can move it.
    const back = convertAtRubRates(toEur.amount, eur, usd, 2, 2)
    const drift = back.amount - 10_000n
    expect(drift >= -1n && drift <= 1n).toBe(true)
    expect(back.amount).toBe(9_999n)
  })

  it('EARS-550: Nominal divides Value — 1000 THB at 24.2629 per 10 is 2426.29 RUB', () => {
    const toRub = convertAtRubRates(100_000n, thb, { ...RUB_RATE, rateDate: '2026-11-14' }, 2, 2)
    expect(toRub.amount).toBe(242_629n)
  })

  it('EARS-550: the exact quotient is kept so sums round once, at the display edge', () => {
    const one = convertAtRubRates(1n, usd, eur, 2, 2) // $0.01 → €0.00902…
    expect(one.amount).toBe(1n)
    expect((one.exact.numerator * 1000n) / one.exact.denominator).toBe(902n)
    // Three of them: rounding each first says 3 cents, the exact sum says 2.7 → 3;
    // ten of them: 10 rounded cents vs 9.02 exact → 9. Sums use `exact`.
    const tenExact =
      (one.exact.numerator * 10n * 2n + one.exact.denominator) / (2n * one.exact.denominator)
    expect(tenExact).toBe(9n)
  })

  it('EARS-550: no JS number enters the money path — amounts in and out are bigint', () => {
    const out = convertAtRubRates(123_456_789_012_345_678n, usd, eur, 2, 2)
    expect(typeof out.amount).toBe('bigint')
    expect(typeof out.exact.numerator).toBe('bigint')
    expect(typeof out.exact.denominator).toBe('bigint')
    // Far past 2^53: a float path would lose the low digits.
    expect(out.amount).toBe(111_413_024_712_427_220n)
  })

  it('EARS-550: precisions are honoured — 1 USDT-precision-6 unit style amounts scale correctly', () => {
    const fromSixDp = convertAtRubRates(
      1_000_000n,
      usd,
      { ...RUB_RATE, rateDate: '2026-11-14' },
      6,
      2,
    )
    expect(fromSixDp.amount).toBe(8_215n) // 1.000000 USD → 82.15 RUB
  })
})
