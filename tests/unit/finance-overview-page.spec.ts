// Specifies the /p/finance overview surface: src/app/(platform)/p/finance/page.tsx
// and its reporting-currency control src/app/(platform)/p/finance/reporting-currency-select.tsx.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const currentMoneyOverviewMock = vi.hoisted(() => vi.fn())
const reportingCurrencySelectMock = vi.hoisted(() =>
  vi.fn(
    ({ currencies, value }: { currencies: Array<{ code: string; name: string }>; value: string }) =>
      `selector:${value}:${currencies.map((currency) => currency.code).join(',')}`,
  ),
)

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock('@/app/(platform)/p/finance/reporting-currency-select', () => ({
  ReportingCurrencySelect: reportingCurrencySelectMock,
}))

vi.mock('@/lib/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance')>()
  return {
    ...actual,
    currentMoneyOverview: currentMoneyOverviewMock,
    listCurrencies: async () => [
      { code: 'RUB', name: 'Российский рубль', precision: 2, retiredAt: null },
      { code: 'USD', name: 'Доллар США', precision: 2, retiredAt: null },
      { code: 'THB', name: 'Тайский бат', precision: 2, retiredAt: null },
      { code: 'EUR', name: 'Евро', precision: 2, retiredAt: null },
    ],
  }
})

describe('/p/finance F1b overview (spec 338 EARS-325)', () => {
  beforeEach(() => {
    currentMoneyOverviewMock.mockReset()
    reportingCurrencySelectMock.mockClear()
    currentMoneyOverviewMock.mockImplementation(async (requestedCurrency = 'RUB') => {
      const reportingCurrency = requestedCurrency === 'EUR' ? 'RUB' : requestedCurrency
      const totals: Record<string, bigint> = {
        RUB: 201_000_000n,
        USD: 3_182_500n,
        THB: 111_387_500n,
      }
      return {
        accounts: [
          {
            accountId: 1,
            name: 'Банк RUB',
            kind: 'bank',
            currency: 'RUB',
            balance: 141_000_000n,
          },
          {
            accountId: 2,
            name: 'Карта USD',
            kind: 'card',
            currency: 'USD',
            balance: 550_000n,
          },
        ],
        reportingCurrency,
        status: 'complete',
        total: totals[reportingCurrency],
        missingCurrencies: [],
        availableReportingCurrencies: ['RUB', 'USD', 'THB'],
      }
    })
  })

  it('EARS-430: opts the whole finance route into the accepted workspace theme and geometry', async () => {
    const layout = await import('@/app/(platform)/p/finance/layout')
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(
      await layout.default({ children: createElement('div', { id: 'finance-child' }) }),
    )

    const main = host.querySelector('main[data-bbm-ui]')
    expect(main).not.toBeNull()
    expect(main?.classList.contains('min-h-[calc(100vh-3.25rem)]')).toBe(true)
    expect(main?.classList.contains('bg-background')).toBe(true)
    expect(main?.querySelector('#finance-child')).not.toBeNull()

    const inner = main?.firstElementChild
    for (const token of ['mx-auto', 'w-full', 'max-w-[1160px]', 'px-4', 'py-10', 'sm:px-6']) {
      expect(inner?.classList.contains(token), token).toBe(true)
    }
  })

  it('EARS-325: renders compact native account tiles and the complete RUB recorded-cost total', async () => {
    const page = await import('@/app/(platform)/p/finance/page')
    const html = renderToStaticMarkup(
      await page.default({ searchParams: Promise.resolve({ currency: 'RUB' }) }),
    )

    expect(html).toContain('Деньги сейчас')
    expect(html).toContain('Банк RUB')
    expect(html).toContain('1 410 000,00')
    expect(html).toContain('Карта USD')
    expect(html).toContain('5 500,00')
    expect(html).toContain('2 010 000,00')
    expect(html).toContain('RUB')
    expect(html).toContain('По фактическим курсам операций')
    expect(html).toContain('selector:RUB:RUB,USD,THB')
    for (const deferred of ['P&amp;L', 'Обязательства', 'Заявки', 'Сверка', 'Сценарии']) {
      expect(html).not.toContain(deferred)
    }
  })

  it('EARS-325: marks a retired account that still holds money «архивный» (owner ruling 2026-08-31)', async () => {
    currentMoneyOverviewMock.mockImplementation(async () => ({
      accounts: [
        {
          accountId: 1,
          name: 'Банк RUB',
          kind: 'bank',
          currency: 'RUB',
          balance: 141_000_000n,
          retired: false,
        },
        {
          accountId: 3,
          name: 'Архивный кошелёк RUB',
          kind: 'crypto',
          currency: 'RUB',
          balance: 2_500_000n,
          retired: true,
        },
      ],
      reportingCurrency: 'RUB',
      status: 'complete',
      total: 143_500_000n,
      missingCurrencies: [],
      availableReportingCurrencies: ['RUB'],
    }))
    const page = await import('@/app/(platform)/p/finance/page')
    const html = renderToStaticMarkup(
      await page.default({ searchParams: Promise.resolve({ currency: 'RUB' }) }),
    )

    expect(html).toContain('Архивный кошелёк RUB')
    expect(html).toContain('архивный')
    expect(html).toContain('1 435 000,00')
    // The live account carries no such mark.
    expect(html.split('Банк RUB')[1]?.split('Архивный')[0]).not.toContain('архивный')
  })

  it('EARS-325: a switched THB view keeps native rows and renders the exact numeric total', async () => {
    const page = await import('@/app/(platform)/p/finance/page')
    const html = renderToStaticMarkup(
      await page.default({ searchParams: Promise.resolve({ currency: 'THB' }) }),
    )

    expect(currentMoneyOverviewMock).toHaveBeenLastCalledWith('THB')
    expect(html).toContain('Банк RUB')
    expect(html).toContain('Карта USD')
    expect(html).toContain('1 113 875,00')
    expect(html).toContain('selector:THB:RUB,USD,THB')
    expect(html).not.toContain('Итого пока не рассчитано')
    expect(html).not.toContain('2 010 000,00')
  })

  it('EARS-325: a stale unavailable selector query falls back to RUB and is not offered', async () => {
    const page = await import('@/app/(platform)/p/finance/page')
    const html = renderToStaticMarkup(
      await page.default({ searchParams: Promise.resolve({ currency: 'EUR' }) }),
    )

    expect(currentMoneyOverviewMock).toHaveBeenLastCalledWith('EUR')
    expect(html).toContain('2 010 000,00')
    expect(html).toContain('selector:RUB:RUB,USD,THB')
    expect(html).not.toContain('selector:RUB:RUB,USD,THB,EUR')
  })
})
