// Specifies the owner's payment queue on /p/finance/requests (spec 339 §I,
// issue #550): src/app/(platform)/p/finance/requests/RequestsQueue.tsx as the
// default view of RequestsBoardScreen.tsx. The Refine hooks are mocked at their
// boundary the way finance-requests-ui.spec.ts mocks them; the List block and
// TanStack render for real.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const refine = vi.hoisted(() => ({
  custom: { data: null as unknown, isLoading: false, error: null as unknown, refetch: vi.fn() },
  mutate: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('@refinedev/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@refinedev/core')>()
  return {
    ...actual,
    useCustom: () => {
      const response = refine.custom.data === null ? undefined : { data: refine.custom.data }
      return {
        query: {
          data: response,
          isLoading: refine.custom.isLoading,
          error: refine.custom.error,
          refetch: refine.custom.refetch,
        },
        result: { data: response?.data ?? {} },
      }
    },
    useCustomMutation: () => ({ mutate: refine.mutate, mutation: { isPending: false } }),
    useInvalidate: () => refine.invalidate,
  }
})

// The queue hands each group's rows to the block itself (`data`), so the mock
// renders exactly those rows through a real TanStack table, with the screen's
// own controlled sorting state.
vi.mock('@refinedev/react-table', async () => {
  const { getCoreRowModel, useReactTable } = await import('@tanstack/react-table')
  return {
    useTable: <TData>(props: {
      columns: never[]
      data?: TData[]
      state?: Record<string, unknown>
      onSortingChange?: never
    }) => {
      const reactTable = useReactTable<TData>({
        data: props.data ?? [],
        columns: props.columns,
        getCoreRowModel: getCoreRowModel(),
        manualPagination: true,
        manualSorting: true,
        manualFiltering: true,
        state: props.state,
        onSortingChange: props.onSortingChange,
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
          sorters: [],
          setSorters: () => {},
          filters: [],
          setFilters: () => {},
        },
      }
    },
  }
})

import type {
  QueueDisplayAmount,
  RequestBoardItem,
  RequestsSnapshot,
} from '@/app/(platform)/p/finance/requests/request-board-contract'
import { DISPLAY_CURRENCY_STORAGE_KEY } from '@/app/(platform)/p/finance/requests/request-queue-model'
import { RequestsBoardScreen } from '@/app/(platform)/p/finance/requests/RequestsBoardScreen'

const same = (minor: string): QueueDisplayAmount => ({
  kind: 'converted',
  amount: minor,
  numerator: minor,
  denominator: '1',
  basis: 'same_currency',
  rateDate: null,
  reason: null,
})
const cbr = (minor: string): QueueDisplayAmount => ({
  kind: 'converted',
  amount: minor,
  numerator: minor,
  denominator: '1',
  basis: 'cbr',
  rateDate: '2026-11-18',
  reason: 'unpaid',
})

/** A RUB request: ₽ is itself; $ and € are converted at 80 / 90. */
function rubDisplay(rub: bigint): RequestBoardItem['display'] {
  return {
    RUB: same(rub.toString()),
    USD: cbr(((rub * 10n) / 800n).toString()),
    EUR: cbr(((rub * 10n) / 900n).toString()),
  }
}

function item(overrides: Partial<RequestBoardItem> = {}): RequestBoardItem {
  return {
    id: 1,
    own: false,
    status: 'submitted',
    stage: 'decide',
    hasDocument: false,
    settledBy: null,
    snapshot: 'token-1',
    occurredOn: null,
    createdAt: '2026-11-16T09:30:00.000Z',
    sourceRef: null,
    sourceUrl: null,
    sourceLabel: null,
    amount: '1000000',
    currency: 'RUB',
    paidAmount: null,
    paidCurrency: null,
    note: 'Аренда студии',
    alreadyPaid: false,
    personalFunds: false,
    createdBy: 5,
    createdByName: 'М. Иванова',
    memberId: null,
    memberName: null,
    refusalReason: null,
    operationId: null,
    purpose: { id: 21, name: 'Продакшн', categoryId: 5, categoryName: 'Производство' },
    project: { id: 3, name: 'Doctor.School' },
    product: null,
    account: null,
    counterparty: { id: 7, name: 'ООО «Студия-7»' },
    documents: [],
    display: rubDisplay(1_000_000n),
    ...overrides,
  }
}

function snapshot(overrides: Partial<RequestsSnapshot> = {}): RequestsSnapshot {
  return {
    permissions: { canApprove: true, canEnter: true },
    references: {
      accounts: [{ id: 1, name: 'Банк RUB', currency: 'RUB' }],
      counterparties: [{ id: 7, name: 'ООО «Студия-7»' }],
      currencies: [
        { code: 'RUB', name: 'Российский рубль', precision: 2 },
        { code: 'USD', name: 'Доллар США', precision: 2 },
        { code: 'USDC', name: 'USD Coin', precision: 2 },
      ],
      products: [],
      projects: [
        { id: 3, name: 'Doctor.School' },
        { id: 4, name: 'OrthoBioSchool' },
      ],
      purposes: [{ id: 21, name: 'Продакшн', categoryId: 5, productBinding: 'optional' }],
    },
    requests: QUEUE,
    liabilities: [],
    fx: { latestRateDate: '2026-11-18', today: '2026-11-18' },
    ...overrides,
  }
}

const QUEUE: RequestBoardItem[] = [
  item({ id: 1, stage: 'decide', display: rubDisplay(1_000_000n) }),
  item({
    id: 2,
    stage: 'decide',
    note: 'Монтаж',
    createdAt: '2026-10-20T09:30:00.000Z',
    display: rubDisplay(500_000n),
  }),
  item({
    id: 3,
    status: 'approved',
    stage: 'pay',
    alreadyPaid: true,
    account: { id: 1, name: 'Банк RUB', currency: 'RUB' },
    project: { id: 4, name: 'OrthoBioSchool' },
    display: rubDisplay(300_000n),
  }),
  item({
    id: 4,
    stage: 'reimburse',
    alreadyPaid: true,
    personalFunds: true,
    memberName: 'А. Петров',
    counterparty: null,
    display: rubDisplay(80_000n),
  }),
  item({ id: 5, status: 'draft', stage: 'draft', note: 'Черновик сметы' }),
  item({ id: 6, status: 'cancelled', stage: 'cancelled', note: 'Отозвана автором' }),
  item({ id: 7, status: 'posted', stage: 'paid', note: 'Оплачено в октябре' }),
]

function renderScreen() {
  return render(React.createElement(RequestsBoardScreen))
}

function pick(name: string | RegExp) {
  const control = screen.getByRole('tab', { name })
  fireEvent.mouseDown(control)
  fireEvent.click(control)
}

function group(title: string) {
  return screen.getByRole('region', { name: title })
}

/** The three sums sit in their own group, apart from the group headings they share words with. */
function kpi(label: RegExp) {
  return within(screen.getByRole('group', { name: 'Итоги очереди' })).getByRole('button', {
    name: label,
  })
}

beforeEach(() => {
  window.localStorage.clear()
  refine.custom.data = snapshot()
  refine.custom.isLoading = false
  refine.custom.error = null
  refine.mutate = vi.fn()
  refine.invalidate = vi.fn()
})

afterEach(() => cleanup())

describe('the payment queue groups (EARS-536)', () => {
  it('EARS-536: opens on «В работе» with the four groups in order and the drafts collapsed', () => {
    renderScreen()
    expect(screen.getByRole('tab', { name: 'В работе', selected: true })).toBeTruthy()
    const titles = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label'))
      .filter((label) =>
        ['Ждёт решения', 'К оплате', 'Вернуть сотруднику', 'Черновики'].includes(label ?? ''),
      )
    expect(titles).toEqual(['Ждёт решения', 'К оплате', 'Вернуть сотруднику', 'Черновики'])

    expect(within(group('К оплате')).getByText('ООО «Студия-7»')).toBeTruthy()
    expect(within(group('Вернуть сотруднику')).getByText('А. Петров')).toBeTruthy()
    const drafts = group('Черновики')
    expect(within(drafts).queryByText('Черновик сметы')).toBeNull()
    fireEvent.click(within(drafts).getByRole('button', { name: /Черновики/ }))
    expect(within(drafts).getByText('Черновик сметы')).toBeTruthy()
  })

  it('EARS-536: «Закрытые» holds Оплачено, Отклонено and Отменено, and an empty group says so', () => {
    renderScreen()
    pick('Закрытые')
    expect(within(group('Оплачено')).getByText('Оплачено в октябре')).toBeTruthy()
    expect(within(group('Отменено')).getByText('Отозвана автором')).toBeTruthy()
    expect(within(group('Отклонено')).getByText('Ничего нет')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Ждёт решения' })).toBeNull()
  })

  it('EARS-536: «Мои» restricts every group to the reader’s own requests', () => {
    refine.custom.data = snapshot({
      requests: [item({ id: 1, own: true, note: 'моя' }), item({ id: 2, note: 'чужая' })],
    })
    renderScreen()
    pick('Мои')
    expect(screen.getByText('моя')).toBeTruthy()
    expect(screen.queryByText('чужая')).toBeNull()
  })
})

describe('the three sums (EARS-537)', () => {
  it('EARS-537: shows the decide / pay / reimburse sums with counts, equal to the group totals', () => {
    renderScreen()
    expect(kpi(/Ждёт решения/).textContent).toMatch(/15\s000\s₽/)
    expect(kpi(/Ждёт решения/).textContent).toMatch(/2 заявки/)
    expect(kpi(/К оплате/).textContent).toMatch(/3\s000\s₽/)
    expect(kpi(/Вернуть сотрудникам/).textContent).toMatch(/800\s₽/)
  })

  it('EARS-537: a click on «К оплате» shows only that group; a second click restores all four', () => {
    renderScreen()
    fireEvent.click(kpi(/К оплате/))
    expect(kpi(/К оплате/).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('region', { name: 'Ждёт решения' })).toBeNull()
    expect(group('К оплате')).toBeTruthy()
    fireEvent.click(kpi(/К оплате/))
    expect(group('Ждёт решения')).toBeTruthy()
    expect(group('Черновики')).toBeTruthy()
  })
})

describe('the queue row (EARS-538)', () => {
  it('EARS-538: says when it was filed, how long ago, and marks an age over 14 days', () => {
    renderScreen()
    const ages = within(group('Ждёт решения')).getAllByText(/дн\. назад|вчера|сегодня/)
    const overdue = ages.filter((age) => age.getAttribute('data-overdue') === 'true')
    // Request 2 was filed on 20 October — weeks ago; request 1 two days before «now».
    expect(overdue).toHaveLength(1)
    expect(overdue[0]!.closest('tr')!.textContent).toMatch(/Монтаж/)
  })

  it('EARS-538: names who pays, with «заплатил(а) сам(а)» under a member who paid', () => {
    renderScreen()
    const row = group('Вернуть сотруднику')
    expect(within(row).getByText('А. Петров')).toBeTruthy()
    expect(within(row).getByText('заплатил(а) сам(а)')).toBeTruthy()
  })

  it('EARS-538: carries no «Деньги ушли» and no status column', () => {
    renderScreen()
    expect(screen.queryByText(/ушли|не двигались/)).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /Статус/ })).toBeNull()
    for (const header of ['Подана', 'От кого', 'Кому платим', 'На что', 'Сумма']) {
      expect(within(group('Ждёт решения')).getByRole('columnheader', { name: new RegExp(header) }))
    }
  })
})

describe('order, search and filters (EARS-539/540)', () => {
  it('EARS-539: a header click sorts every group by that column, a second click reverses it', () => {
    renderScreen()
    const notes = () =>
      within(group('Ждёт решения'))
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent)
    expect(notes()[0]).toMatch(/Аренда студии/)
    const sorter = within(group('Ждёт решения')).getByRole('button', { name: /по сумме/ })
    fireEvent.click(sorter)
    const first = notes()[0]
    fireEvent.click(within(group('Ждёт решения')).getByRole('button', { name: /по сумме/ }))
    expect(notes()[0]).not.toBe(first)
  })

  it('EARS-540: «#2» finds exactly that request', () => {
    renderScreen()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по заявкам' }), {
      target: { value: '#2' },
    })
    expect(within(group('Ждёт решения')).getByText('Монтаж')).toBeTruthy()
    expect(within(group('Ждёт решения')).queryByText('Аренда студии')).toBeNull()
    expect(within(group('К оплате')).getByText('Ничего нет')).toBeTruthy()
  })

  it('EARS-540: the project filter narrows every group and leaves the sums alone', async () => {
    renderScreen()
    const before = kpi(/Ждёт решения/).textContent
    fireEvent.click(screen.getByRole('combobox', { name: 'Проект' }))
    fireEvent.click(await screen.findByRole('option', { name: 'OrthoBioSchool' }))
    await waitFor(() => expect(within(group('Ждёт решения')).getByText('Ничего нет')).toBeTruthy())
    expect(within(group('К оплате')).getByText('ООО «Студия-7»')).toBeTruthy()
    expect(kpi(/Ждёт решения/).textContent).toBe(before)
  })
})

describe('the row act (EARS-541)', () => {
  it('EARS-541: «Одобрить» runs the approve act of the row', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить заявку №1' }))
    expect(refine.mutate.mock.calls[0][0]).toMatchObject({
      url: '/p/finance/api/requests/1/actions',
      values: { act: 'approve' },
    })
  })

  it('EARS-541: «Отметить оплату» opens the details sheet of that row, carrying its list row', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Отметить оплату заявки №3' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/10\s000,00 RUB — Аренда студии/)).toBeTruthy()
    expect(refine.mutate).not.toHaveBeenCalled()
  })

  it('EARS-541: a reader without the approve role sees the same groups and no row act', () => {
    refine.custom.data = snapshot({ permissions: { canApprove: false, canEnter: false } })
    renderScreen()
    expect(group('Ждёт решения')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Одобрить заявку/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Отметить/ })).toBeNull()
  })
})

describe('the display currency (EARS-549/551)', () => {
  const usd: RequestBoardItem = item({
    id: 8,
    note: 'Подписка в долларах',
    amount: '10000',
    currency: 'USD',
    display: { RUB: cbr('800000'), USD: same('10000'), EUR: cbr('8889') },
  })

  it('EARS-549: ₽ by default; a USD request shows its original under the rouble amount, a RUB one does not', () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1 }), usd] })
    renderScreen()
    const decide = group('Ждёт решения')
    expect(screen.getByRole('tab', { name: '₽', selected: true })).toBeTruthy()
    const usdRow = within(decide).getByText('Подписка в долларах').closest('tr')!
    expect(usdRow.textContent).toMatch(/8\s000\s₽/)
    expect(usdRow.textContent).toMatch(/100\s\$|100,00 USD/)
    const rubRow = within(decide).getByText('Аренда студии').closest('tr')!
    expect(rubRow.textContent).not.toMatch(/RUB/)
  })

  it('EARS-549: ₽ → $ changes every amount and every sum, and the browser remembers it', () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1 }), usd] })
    renderScreen()
    pick('$')
    expect(kpi(/Ждёт решения/).textContent).toMatch(/225\s\$/)
    const usdRow = within(group('Ждёт решения')).getByText('Подписка в долларах').closest('tr')!
    expect(usdRow.textContent).toMatch(/100\s\$/)
    expect(window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)).toBe('USD')
  })

  it('EARS-551: a currency with no rate shows its original amount and «нет курса», and the sums say «без 1 заявки»', () => {
    const noRate: QueueDisplayAmount = { kind: 'no_rate', currency: 'USDC', date: '2026-11-18' }
    refine.custom.data = snapshot({
      requests: [
        item({ id: 1 }),
        item({
          id: 9,
          note: 'Кошелёк в USDC',
          amount: '30000',
          currency: 'USDC',
          display: { RUB: noRate, USD: noRate, EUR: noRate },
        }),
      ],
    })
    renderScreen()
    const row = within(group('Ждёт решения')).getByText('Кошелёк в USDC').closest('tr')!
    expect(row.textContent).toMatch(/300,00 USDC/)
    expect(row.textContent).toMatch(/нет курса/)
    expect(kpi(/Ждёт решения/).textContent).toMatch(/без 1 заявки/)
    expect(within(group('Ждёт решения')).getByText(/без 1 заявки/)).toBeTruthy()
  })

  it('EARS-552: says the stored rates are stale and from which date', () => {
    refine.custom.data = snapshot({ fx: { latestRateDate: '2026-11-10', today: '2026-11-18' } })
    renderScreen()
    expect(screen.getByText(/Курсы ЦБ устарели.*10\.11\.2026/)).toBeTruthy()
  })
})

describe('the queue row carries what the replaced table carried (#480, #517)', () => {
  it('EARS-534: another member’s PROPOSED purpose is read with its text on the row', () => {
    refine.custom.data = snapshot({
      requests: [
        item({
          id: 1,
          purpose: null,
          proposal: { id: 4, text: 'Подкаст-оборудование', status: 'pending' },
        }),
      ],
    })
    renderScreen()
    expect(
      within(group('Ждёт решения')).getByText('Назначение предложено: Подкаст-оборудование'),
    ).toBeTruthy()
  })

  it('EARS-554/556: puts the source link next to «Подана», and nothing where there is none', () => {
    refine.custom.data = snapshot({
      requests: [
        item({
          id: 1,
          sourceRef: 'mm:post/abc',
          sourceUrl: 'https://chat.example/pl/abc',
          sourceLabel: 'Mattermost',
        }),
        item({ id: 2, note: 'Без источника' }),
      ],
    })
    renderScreen()
    const links = within(group('Ждёт решения')).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]!.getAttribute('href')).toBe('https://chat.example/pl/abc')
  })

  it('opens the details sheet from the row’s purpose, a named control', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /^Заявка №2: / }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/Монтаж/)).toBeTruthy()
  })

  it('a long note truncates inside its column and stays readable in full on hover', () => {
    const note = 'Очень длинный комментарий '.repeat(12).trim()
    refine.custom.data = snapshot({ requests: [item({ id: 1, note })] })
    renderScreen()
    const line = within(group('Ждёт решения')).getByText(note)
    expect(line.className).toMatch(/truncate/)
    expect(line.getAttribute('title')).toBe(note)
  })
})
