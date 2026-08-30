import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const currentMoneyOverviewMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance')>()
  return {
    ...actual,
    currentMoneyOverview: currentMoneyOverviewMock,
    listCurrencies: async () => [
      { code: 'RUB', name: 'Российский рубль', precision: 2, retiredAt: null },
      { code: 'THB', name: 'Тайский бат', precision: 2, retiredAt: null },
    ],
  }
})

describe('/p/finance F1b overview (spec 338 EARS-325)', () => {
  beforeEach(() => {
    currentMoneyOverviewMock.mockImplementation(async (reportingCurrency = 'RUB') => ({
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
      status: reportingCurrency === 'RUB' ? 'complete' : 'incomplete',
      total: reportingCurrency === 'RUB' ? 201_000_000n : null,
      missingCurrencies: reportingCurrency === 'RUB' ? [] : ['RUB', 'USD'],
      currencyPools: {},
    }))
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
    expect(html).toContain('По записанной стоимости')
    expect(html).toContain('Тайский бат')
    for (const deferred of ['P&amp;L', 'Обязательства', 'Заявки', 'Сверка', 'Сценарии']) {
      expect(html).not.toContain(deferred)
    }
  })

  it('EARS-325: a switched incomplete view keeps native rows and names every missing currency', async () => {
    const page = await import('@/app/(platform)/p/finance/page')
    const html = renderToStaticMarkup(
      await page.default({ searchParams: Promise.resolve({ currency: 'THB' }) }),
    )

    expect(currentMoneyOverviewMock).toHaveBeenLastCalledWith('THB')
    expect(html).toContain('Банк RUB')
    expect(html).toContain('Карта USD')
    expect(html).toContain('Итого пока не рассчитано')
    expect(html).toContain('RUB')
    expect(html).toContain('USD')
    expect(html).not.toContain('2 010 000,00')
  })
})
