// Specifies the «Курс против рынка» screen (spec 339 §J, EARS-564…566; issue
// #559): src/app/(platform)/p/finance/reports/market-rate/MarketRateReport.tsx
// and its words in market-rate-view.ts. The report itself is built for real by
// `buildMarketReport` (#559's model); the Refine table hook is mocked at its
// boundary the way finance-requests-queue-ui.spec.ts mocks it, and the List
// block and TanStack render for real.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

vi.mock('@refinedev/react-table', async () => {
  const { getCoreRowModel, useReactTable } = await import('@tanstack/react-table')
  return {
    useTable: <TData>(props: { columns: never[]; data?: TData[] }) => {
      const reactTable = useReactTable<TData>({
        data: props.data ?? [],
        columns: props.columns,
        getCoreRowModel: getCoreRowModel(),
      })
      return {
        reactTable,
        refineCore: {
          tableQuery: { isLoading: false, error: null, data: undefined, refetch: vi.fn() },
          currentPage: 1,
          setCurrentPage: () => {},
          pageCount: 1,
          pageSize: 10,
          setPageSize: () => {},
        },
      }
    },
  }
})

import { MarketRateReport } from '@/app/(platform)/p/finance/reports/market-rate/MarketRateReport'
import {
  formatOverpayment,
  leftOutNotes,
  measuredLabel,
  monthLabel,
  requestHref,
} from '@/app/(platform)/p/finance/reports/market-rate/market-rate-view'
import { DISPLAY_CURRENCY_STORAGE_KEY } from '@/app/(platform)/p/finance/requests/request-queue-model'
import { measureChain, measureIntakeItem, type MarketContext } from '@/lib/finance/fx/market'
import {
  buildMarketReport,
  MARKET_REPORT_PERIODS,
  type MarketReport,
} from '@/lib/finance/fx/market-report'
import type { MarketIntakeFact } from '@/lib/finance/market-facts'

const CONTEXT: MarketContext = {
  series: [
    { currency: 'USD', rateDate: '2026-11-13', nominal: 1, valueRub: '92.0000' },
    { currency: 'EUR', rateDate: '2026-11-13', nominal: 1, valueRub: '100.0000' },
  ],
  precisions: new Map([
    ['RUB', 2],
    ['USD', 2],
    ['EUR', 2],
  ]),
}

function fact(overrides: Partial<MarketIntakeFact>): MarketIntakeFact {
  return {
    itemId: 1,
    kind: 'expense',
    status: 'posted',
    alreadyPaid: true,
    personalFunds: false,
    occurredOn: '2026-11-13',
    submittedOn: '2026-11-10',
    amount: 10_000n,
    currency: 'USD',
    paidAmount: 938_400n,
    paidCurrency: 'RUB',
    feeAmount: null,
    feeCurrency: null,
    accountName: 'Карта RUB',
    accountCurrency: 'RUB',
    operationId: 10,
    operationReversed: false,
    counterpartyName: 'Anthropic',
    memberName: 'Антон',
    ...overrides,
  }
}

function report(): MarketReport {
  const entries = [
    measureIntakeItem(fact({ itemId: 1 }), CONTEXT)!,
    measureIntakeItem(
      fact({
        itemId: 2,
        personalFunds: true,
        accountName: null,
        accountCurrency: null,
        memberName: 'Мария',
        paidAmount: 901_600n,
      }),
      CONTEXT,
    )!,
    measureChain(
      {
        operationId: 77,
        occurredOn: '2026-11-13',
        steps: [
          { fromCurrency: 'RUB', toCurrency: 'USDT' },
          { fromCurrency: 'USDT', toCurrency: 'USD' },
        ],
        moneyLegs: [
          {
            accountId: 1,
            accountName: 'Карта RUB',
            amount: -10_000_000n,
            currency: 'RUB',
            onStep: false,
          },
          {
            accountId: 2,
            accountName: 'Счёт USD',
            amount: 105_000n,
            currency: 'USD',
            onStep: false,
          },
        ],
      },
      CONTEXT,
    ),
    measureIntakeItem(
      fact({
        itemId: 4,
        status: 'submitted',
        paidAmount: null,
        paidCurrency: null,
        accountName: null,
        accountCurrency: null,
      }),
      CONTEXT,
    )!,
    measureIntakeItem(fact({ itemId: 5, occurredOn: '2026-10-01' }), CONTEXT)!,
  ]
  return buildMarketReport(entries, CONTEXT, ['RUB', 'USD', 'EUR'], {
    from: '2025-12-01',
    to: '2026-11-18',
  })
}

function renderReport(value: MarketReport = report()) {
  return render(
    React.createElement(MarketRateReport, {
      report: value,
      period: '12m',
      periods: MARKET_REPORT_PERIODS,
      precisions: { RUB: 2, USD: 2, EUR: 2 },
    }),
  )
}

beforeEach(() => {
  window.localStorage.clear()
  router.push.mockReset()
})

afterEach(() => cleanup())

describe('the words (EARS-559/564)', () => {
  it('EARS-564: Переплата carries its sign, months read as words, counts as Russian plurals', () => {
    expect(formatOverpayment('18400', 'RUB')).toBe('+184,00 ₽')
    expect(formatOverpayment('-18400', 'RUB')).toBe('−184,00 ₽')
    expect(formatOverpayment('0', 'USD')).toBe('0,00 $')
    expect(monthLabel('2026-11')).toBe('Ноябрь 2026')
    expect(measuredLabel({ payments: 2, chains: 1 })).toBe('2 платежа · 1 конвертация')
    expect(measuredLabel({ payments: 5, chains: 0 })).toBe('5 платежей')
    expect(requestHref(12)).toBe('/p/finance/requests?request=12')
    expect(
      leftOutNotes(
        {
          percentTenths: null,
          wording: '—',
          measured: { payments: 0, chains: 0 },
          noRate: { payments: 1, chains: 1 },
          notPosted: 1,
        },
        2,
        'EUR',
        1,
      ),
    ).toEqual([
      'без курса: 2',
      'факт не внесён: 1',
      'без курса в EUR: 2',
      'не учтено конвертаций: 1',
    ])
  })
})

describe('the period total (EARS-564)', () => {
  it('EARS-564: shows Σ Переплата in ₽ with the weighted wording, Σ Факт, Σ Рынок, what was measured and the «без курса» / «факт не внесён» counts', () => {
    renderReport()
    const total = screen.getByRole('group', { name: 'Итого за период' })
    // Факт 9 384 + 9 016 + 100 000 = 118 400 ₽; Рынок 9 200 + 9 200 + 96 600 = 115 000 ₽.
    expect(within(total).getByText('+3 400,00 ₽')).toBeTruthy()
    expect(within(total).getByText('хуже рынка на 3,0%')).toBeTruthy()
    expect(total.textContent).toContain('Факт 118 400,00 ₽ · Рынок 115 000,00 ₽')
    expect(total.textContent).toContain(
      '2 платежа · 1 конвертация · без курса: 1 · факт не внесён: 1',
    )
  })

  it('EARS-564: the period selector offers the five periods and navigates to the chosen one', () => {
    renderReport()
    fireEvent.click(screen.getByRole('combobox', { name: 'Период' }))
    for (const option of MARKET_REPORT_PERIODS)
      expect(screen.getByRole('option', { name: option.label })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: 'Этот квартал' }))
    expect(router.push).toHaveBeenCalledWith('/p/finance/reports/market-rate?period=quarter')
  })

  it('EARS-564: an empty period says so in both tables and shows a zero total', () => {
    renderReport(buildMarketReport([], CONTEXT, ['RUB', 'USD', 'EUR'], {}))
    expect(screen.getAllByText('За этот период платежей в валюте нет')).toHaveLength(2)
    const total = screen.getByRole('group', { name: 'Итого за период' })
    expect(total.textContent).toContain('Факт 0,00 ₽ · Рынок 0,00 ₽')
    expect(total.textContent).toContain('ничего не измерено')
  })
})

describe('the breakdowns (EARS-565)', () => {
  it('EARS-565: the month and payee / route tables list their rows with an «Итого» footer, and the chain row is its route', () => {
    renderReport()
    const months = screen.getByRole('region', { name: 'По месяцам' })
    expect(within(months).getByRole('button', { name: 'Ноябрь 2026' })).toBeTruthy()
    expect(within(months).getByRole('button', { name: 'Октябрь 2026' })).toBeTruthy()
    expect(within(months).getByText('Итого')).toBeTruthy()
    const payees = screen.getByRole('region', { name: 'По получателям и маршрутам' })
    expect(within(payees).getByRole('button', { name: 'RUB → USDT → USD' })).toBeTruthy()
    expect(within(payees).getByRole('button', { name: 'Мария' })).toBeTruthy()
    expect(within(payees).getByText('свои средства · RUB → USD')).toBeTruthy()
  })

  it('EARS-565: opening a row lists its payments with date, document amount, Рынок, Факт and Переплата, a payment linking to its request', () => {
    renderReport()
    const months = screen.getByRole('region', { name: 'По месяцам' })
    fireEvent.click(within(months).getByRole('button', { name: 'Ноябрь 2026' }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('heading', { name: 'Ноябрь 2026' })).toBeTruthy()
    const link = within(sheet).getByRole('link', { name: 'Заявка №1 · Anthropic' })
    expect(link.getAttribute('href')).toBe('/p/finance/requests?request=1')
    expect(within(sheet).getByText('Конвертация · RUB → USDT → USD')).toBeTruthy()
    expect(sheet.textContent).toContain('13.11.2026')
    expect(sheet.textContent).toContain('100 000,00 ₽ → 1 050,00 $')
    expect(within(sheet).getAllByText('+184,00 ₽').length).toBeGreaterThan(0)
    expect(within(sheet).getByText('факт не внесён')).toBeTruthy()
  })
})

describe('the display currency (EARS-566)', () => {
  it('EARS-566: switching ₽ → $ re-presents every amount and leaves every percentage, and it is the requests queue’s remembered choice', () => {
    renderReport()
    const total = screen.getByRole('group', { name: 'Итого за период' })
    const wordingsBefore = screen
      .getAllByText(/рынка на|как на рынке/)
      .map((node) => node.textContent)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '$' }), { button: 0 })
    fireEvent.click(screen.getByRole('tab', { name: '$' }))
    expect(window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)).toBe('USD')
    // 3 400 ₽ / 92 = 36,96 $ — from 1 286,96 $ Факт less 1 250,00 $ Рынок.
    expect(within(total).getByText('+36,96 $')).toBeTruthy()
    expect(total.textContent).toContain('Факт 1 286,96 $ · Рынок 1 250,00 $')
    expect(screen.getAllByText(/рынка на|как на рынке/).map((node) => node.textContent)).toEqual(
      wordingsBefore,
    )
  })

  it('EARS-566: a stored € choice from the requests queue opens the report in €', () => {
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, 'EUR')
    renderReport()
    expect(
      within(screen.getByRole('group', { name: 'Итого за период' })).getByText('+34,00 €'),
    ).toBeTruthy()
  })
})
