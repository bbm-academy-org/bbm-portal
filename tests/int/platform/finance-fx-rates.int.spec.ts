// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createCurrency } from '@/lib/finance'
import { parseCbrDaily, type CbrDaily } from '@/lib/finance/fx/cbr'
import { convertForDisplay, latestRateDate, rateOn, syncCbrRates } from '@/lib/finance/fx/store'
import { closePlatformDb } from '@/lib/platform/db/client'

import { ADMIN, fixtureWrite, truncateFinanceTables } from './finance-helpers'
import { truncateAsFixture } from './privilege-helpers'

/**
 * The stored Bank of Russia series against the really-migrated database (spec
 * `docs/specs/339-ledger-intake.md` §I, EARS-550/552, issue #548).
 *
 * cbr.ru is never reached: the sync takes its fetcher as an argument, and the
 * one used here serves the recorded fixtures by the date asked — a Friday and a
 * Sunday, whose `ValCurs/@Date` is the Saturday before it.
 */
const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'unit',
  'fixtures',
  'cbr',
)
const BY_REQUEST: Record<string, CbrDaily> = {
  '2026-11-13': parseCbrDaily(
    new Uint8Array(readFileSync(join(FIXTURES, 'xml-daily-req-2026-11-13.xml'))),
  ),
  '2026-11-15': parseCbrDaily(
    new Uint8Array(readFileSync(join(FIXTURES, 'xml-daily-req-2026-11-15.xml'))),
  ),
}
// The Saturday asked directly answers with the same document as the Sunday.
BY_REQUEST['2026-11-14'] = BY_REQUEST['2026-11-15']

const asked: string[] = []
async function fixtureFetch(date: string): Promise<CbrDaily> {
  asked.push(date)
  const daily = BY_REQUEST[date]
  if (!daily) throw new Error(`no fixture for ${date}`)
  return daily
}

async function countRates(): Promise<number> {
  return fixtureWrite(async (tx) => {
    const res = await tx.execute(sql`select count(*)::int as n from core.finance_fx_rate`)
    return Number((res.rows[0] as { n: number }).n)
  })
}

beforeEach(async () => {
  asked.length = 0
  await truncateAsFixture('truncate table core.finance_fx_rate restart identity')
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

describe('core.finance_fx_rate (EARS-552)', () => {
  it('EARS-552: the migrated table is keyed unique on (source, currency, rate_date)', async () => {
    const columns = await fixtureWrite(async (tx) => {
      const res = await tx.execute(sql`
        select a.attname as column
        from pg_index i
        join pg_class c on c.oid = i.indexrelid
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
        where i.indrelid = 'core.finance_fx_rate'::regclass and i.indisunique and not i.indisprimary
        order by array_position(i.indkey, a.attnum)`)
      return res.rows.map((r) => (r as { column: string }).column)
    })
    expect(columns).toEqual(['source', 'currency', 'rate_date'])
  })

  it('EARS-552: syncing the same range twice writes no duplicate — the second run inserts 0', async () => {
    const first = await syncCbrRates({
      from: '2026-11-13',
      to: '2026-11-15',
      fetchDaily: fixtureFetch,
    })
    const stored = await countRates()
    const perDay = BY_REQUEST['2026-11-13'].rates.length + BY_REQUEST['2026-11-15'].rates.length
    // Saturday and Sunday answer with the same effective date: two days of rows.
    expect(stored).toBe(perDay)
    expect(first.inserted).toBe(perDay)
    expect(asked).toEqual(['2026-11-13', '2026-11-14', '2026-11-15'])

    const second = await syncCbrRates({
      from: '2026-11-13',
      to: '2026-11-15',
      fetchDaily: fixtureFetch,
    })
    expect(second.inserted).toBe(0)
    expect(await countRates()).toBe(stored)
  })

  it('EARS-552: rows are attributed to the sync job as their door (system:finance-fx-sync)', async () => {
    await syncCbrRates({ from: '2026-11-13', to: '2026-11-13', fetchDaily: fixtureFetch })
    const sources = await fixtureWrite(async (tx) => {
      const res = await tx.execute(sql`
        select distinct source from core.audit_event where table_name = 'finance_fx_rate'`)
      return res.rows.map((r) => (r as { source: string }).source)
    })
    expect(sources).toEqual(['system:finance-fx-sync'])
  })

  it('EARS-552: with no range given it resumes from the last stored date up to today', async () => {
    await syncCbrRates({ from: '2026-11-13', to: '2026-11-13', fetchDaily: fixtureFetch })
    asked.length = 0
    const summary = await syncCbrRates({ today: '2026-11-15', fetchDaily: fixtureFetch })
    expect(asked).toEqual(['2026-11-13', '2026-11-14', '2026-11-15'])
    expect(summary.from).toBe('2026-11-13')
    expect(summary.to).toBe('2026-11-15')
    expect(await latestRateDate()).toBe('2026-11-14')
  })

  it("EARS-552: rateOn for a Sunday returns the stored rate whose rate_date is the fixture's ValCurs/@Date", async () => {
    await syncCbrRates({ from: '2026-11-13', to: '2026-11-15', fetchDaily: fixtureFetch })
    expect(await rateOn('USD', '2026-11-15')).toEqual({
      currency: 'USD',
      rateDate: '2026-11-14',
      nominal: 1,
      valueRub: '82.1516',
    })
    expect(await rateOn('THB', '2026-11-13')).toEqual({
      currency: 'THB',
      rateDate: '2026-11-13',
      nominal: 10,
      valueRub: '24.5678',
    })
  })

  it('EARS-552: a date before the first stored rate, and a currency CBR does not quote, return no rate', async () => {
    await syncCbrRates({ from: '2026-11-13', to: '2026-11-13', fetchDaily: fixtureFetch })
    expect(await rateOn('USD', '2026-11-12')).toBeNull()
    expect(await rateOn('USDT', '2026-11-13')).toBeNull()
  })

  it('EARS-550: convertForDisplay crosses via RUB on the stored rates and says when there is no rate', async () => {
    await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
    await createCurrency(ADMIN, { code: 'USD', name: 'Доллар США', precision: 2 })
    await createCurrency(ADMIN, { code: 'EUR', name: 'Евро', precision: 2 })
    await createCurrency(ADMIN, { code: 'USDT', name: 'Tether', precision: 6 })
    await syncCbrRates({ from: '2026-11-13', to: '2026-11-15', fetchDaily: fixtureFetch })

    const eur = await convertForDisplay(10_000n, 'USD', 'EUR', '2026-11-15')
    expect(eur).toMatchObject({ kind: 'converted', amount: 9_024n })

    const rub = await convertForDisplay(10_000n, 'USD', 'RUB', '2026-11-13')
    expect(rub).toMatchObject({ kind: 'converted', amount: 829_803n })

    expect(await convertForDisplay(1_000_000n, 'USDT', 'RUB', '2026-11-15')).toEqual({
      kind: 'no_rate',
      currency: 'USDT',
      date: '2026-11-15',
    })
    expect(await convertForDisplay(10_000n, 'USD', 'RUB', '2026-11-01')).toEqual({
      kind: 'no_rate',
      currency: 'USD',
      date: '2026-11-01',
    })
  })
})
