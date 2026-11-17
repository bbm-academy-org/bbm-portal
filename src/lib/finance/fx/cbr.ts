/**
 * The Bank of Russia daily rate document (spec `docs/specs/339-ledger-intake.md`
 * §I, EARS-552; issue #548).
 *
 * `XML_daily.asp?date_req=DD/MM/YYYY` answers with a windows-1251 `ValCurs`
 * document: `@Date` is the EFFECTIVE date of the rates in it (a weekend or
 * holiday request gets the previous business day's document), and each
 * `Valute` prices `Nominal` units of `CharCode` at `Value` roubles, with a
 * comma decimal separator.
 *
 * The document's shape is flat and fixed, so it is read with anchored patterns
 * rather than a general XML parser — every field read is ASCII except the
 * `Name`, which is never read. A body that is not a `ValCurs` document, or a
 * `Valute` whose numbers do not parse, is an ERROR: reading it as «no rates
 * that day» would silently stop the series.
 */

export const CBR_DAILY_URL = 'https://www.cbr.ru/scripts/XML_daily.asp'

/** One quote: `valueRub` roubles per `nominal` units of `currency`. */
export type CbrRate = { currency: string; nominal: number; valueRub: string }

/** One `ValCurs` document: the effective date and the quotes it carries. */
export type CbrDaily = { effectiveDate: string; rates: CbrRate[] }

/** cbr.ru answered with something that is not a usable rate document. */
export class CbrResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CbrResponseError'
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `2026-11-15` → `…/XML_daily.asp?date_req=15/11/2026`. */
export function cbrDailyUrl(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate)
  if (!match) throw new CbrResponseError(`date_req must be YYYY-MM-DD, got «${isoDate}»`)
  const [, year, month, day] = match
  return `${CBR_DAILY_URL}?date_req=${day}/${month}/${year}`
}

const VAL_CURS_DATE = /<ValCurs\b[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/
const VALUTE = /<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g
const DECIMAL = /^[0-9]+(\.[0-9]+)?$/

function field(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block)
  return match ? match[1].trim() : null
}

/** Parse a `ValCurs` document, given as the raw response bytes or as decoded text. */
export function parseCbrDaily(body: Uint8Array | string): CbrDaily {
  const xml = typeof body === 'string' ? body : new TextDecoder('windows-1251').decode(body)
  const date = VAL_CURS_DATE.exec(xml)
  if (!date) {
    throw new CbrResponseError(
      `cbr.ru answered without a ValCurs/@Date — not a rate document: «${xml.slice(0, 120)}»`,
    )
  }
  const [, day, month, year] = date
  const effectiveDate = `${year}-${month}-${day}`

  const rates: CbrRate[] = []
  for (const [, block] of xml.matchAll(VALUTE)) {
    const currency = field(block, 'CharCode')
    const nominalText = field(block, 'Nominal')
    const valueText = field(block, 'Value')?.replace(',', '.') ?? null
    if (
      currency === null ||
      !/^[A-Z]{3}$/.test(currency) ||
      nominalText === null ||
      !/^[1-9][0-9]*$/.test(nominalText) ||
      valueText === null ||
      !DECIMAL.test(valueText)
    ) {
      throw new CbrResponseError(
        `cbr.ru ${effectiveDate}: unreadable Valute «${block.slice(0, 160)}»`,
      )
    }
    rates.push({ currency, nominal: Number(nominalText), valueRub: valueText })
  }
  return { effectiveDate, rates }
}

/**
 * Fetch and parse the document for one requested date. `fetchImpl` is the seam
 * the tests use; production passes nothing and reaches cbr.ru.
 */
export async function fetchCbrDaily(
  isoDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CbrDaily> {
  const url = cbrDailyUrl(isoDate)
  const response = await fetchImpl(url, { headers: { accept: 'application/xml' } })
  if (!response.ok) {
    throw new CbrResponseError(`cbr.ru answered ${response.status} for ${url}`)
  }
  return parseCbrDaily(new Uint8Array(await response.arrayBuffer()))
}
