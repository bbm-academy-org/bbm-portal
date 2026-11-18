// Specifies the owner's payment queue on /p/finance/requests (spec 339 §I,
// issue #550): src/app/(platform)/p/finance/requests/RequestsQueue.tsx as the
// default view of RequestsBoardScreen.tsx. The Refine hooks are mocked at their
// boundary the way finance-requests-ui.spec.ts mocks them; the List block and
// TanStack render for real.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    feeAmount: null,
    feeCurrency: null,
    market: null,
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
    expect(kpi(/Ждёт решения/).textContent).toMatch(/15\s000,00\s₽/)
    expect(kpi(/Ждёт решения/).textContent).toMatch(/2 заявки/)
    expect(kpi(/К оплате/).textContent).toMatch(/3\s000,00\s₽/)
    expect(kpi(/Вернуть сотрудникам/).textContent).toMatch(/800,00\s₽/)
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

  it('EARS-541/543: «Отметить оплату» opens the details sheet of that row with its pay form open', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Отметить оплату заявки №3' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('Заявка №3 · К оплате')).toBeTruthy()
    expect(within(sheet).getByRole('region', { name: 'Отметить оплату' })).toBeTruthy()
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
    expect(usdRow.textContent).toMatch(/8\s000,00\s₽/)
    expect(usdRow.textContent).toMatch(/100,00\s\$/)
    const rubRow = within(decide).getByText('Аренда студии').closest('tr')!
    expect(rubRow.textContent).not.toMatch(/RUB/)
  })

  it('EARS-549: ₽ → $ changes every amount and every sum, and the browser remembers it', () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1 }), usd] })
    renderScreen()
    pick('$')
    expect(kpi(/Ждёт решения/).textContent).toMatch(/225,00\s\$/)
    const usdRow = within(group('Ждёт решения')).getByText('Подписка в долларах').closest('tr')!
    expect(usdRow.textContent).toMatch(/100,00\s\$/)
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
      within(group('Ждёт решения')).getByText(/Назначение предложено: Подкаст-оборудование$/),
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

describe('the queue as the owner reads it (review of #562, UX defects)', () => {
  it('bolds what the author wrote, with the purpose and «№N» under it', () => {
    renderScreen()
    const title = within(group('Ждёт решения')).getByRole('button', { name: /^Заявка №2: / })
    expect(title.textContent).toBe('Монтаж')
    expect(within(group('Ждёт решения')).getByText('№2 · Продакшн')).toBeTruthy()
    expect(
      screen.getByRole('searchbox', { name: 'Поиск по заявкам' }).getAttribute('placeholder'),
    ).toMatch(/№/)
  })

  it('marks a request filed in the last 24 hours «новая», even inside the collapsed drafts', () => {
    const fresh = new Date(Date.now() - 3_600_000).toISOString()
    refine.custom.data = snapshot({
      requests: [
        item({ id: 1, createdAt: '2026-10-01T09:30:00.000Z' }),
        item({ id: 2, createdAt: fresh, note: 'Свежая' }),
        item({ id: 5, status: 'draft', stage: 'draft', note: 'Свежий черновик', createdAt: fresh }),
      ],
    })
    renderScreen()
    const decide = group('Ждёт решения')
    const rows = within(decide).getAllByRole('row').slice(1)
    expect(rows[0]!.textContent).toMatch(/Свежая/)
    expect(within(rows[0]!).getByText('новая')).toBeTruthy()
    expect(within(rows[1]!).queryByText('новая')).toBeNull()
    const drafts = group('Черновики')
    expect(within(drafts).queryByText('Свежий черновик')).toBeNull()
    expect(within(drafts).getByText('1 новая')).toBeTruthy()
  })

  it('a closed group has no empty act column: Оплачено shows the payment date, Отклонено the reason', () => {
    const reason = 'Дубль заявки №12, оплачено по старой '.repeat(4).trim()
    refine.custom.data = snapshot({
      requests: [
        item({
          id: 7,
          status: 'posted',
          stage: 'paid',
          note: 'Оплачено в октябре',
          occurredOn: '2026-10-29',
        }),
        item({ id: 8, status: 'refused', stage: 'refused', note: 'Отказ', refusalReason: reason }),
      ],
    })
    renderScreen()
    pick('Закрытые')
    const paid = group('Оплачено')
    expect(within(paid).queryByRole('columnheader', { name: 'Действие' })).toBeNull()
    expect(within(paid).getByRole('columnheader', { name: /Оплачено/ })).toBeTruthy()
    expect(within(paid).getByText('29 окт.')).toBeTruthy()
    const refused = group('Отклонено')
    const line = within(refused).getByText(reason)
    expect(line.getAttribute('title')).toBe(reason)
    expect(within(refused).getByRole('columnheader', { name: /Причина отказа/ })).toBeTruthy()
  })

  it('the original amount uses the same symbols as the converted one', () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1 })] })
    renderScreen()
    pick('$')
    const row = within(group('Ждёт решения')).getByText('Аренда студии').closest('tr')!
    expect(row.textContent).toMatch(/10\s000,00\s₽/)
    expect(row.textContent).not.toMatch(/RUB/)
  })

  describe('on a phone', () => {
    const original = window.matchMedia
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia
    })
    afterEach(() => {
      window.matchMedia = original
    })

    it('renders each request as one stacked row: when, who → payee, what, amount and act', () => {
      renderScreen()
      const decide = group('Ждёт решения')
      expect(within(decide).queryByRole('columnheader', { name: /От кого/ })).toBeNull()
      expect(within(decide).getByRole('columnheader', { name: /Заявка/ })).toBeTruthy()
      expect(within(decide).getByRole('columnheader', { name: /Сумма/ })).toBeTruthy()
      const row = within(decide).getByText('Аренда студии').closest('tr')!
      expect(row.textContent).toMatch(/М\. Иванова → ООО «Студия-7»/)
      expect(row.textContent).toMatch(/10\s000,00\s₽/)
      expect(within(row).getByRole('button', { name: 'Одобрить заявку №1' })).toBeTruthy()
    })
  })
})

// ── #551: the details sheet, its forms and the bulk dialog (spec 339 §I/§J) ──

describe('the details sheet of the queue (EARS-542…548, EARS-563)', () => {
  const usdApproved = item({
    id: 9,
    status: 'approved',
    stage: 'pay',
    note: 'Подписка в долларах',
    amount: '10000',
    currency: 'USD',
    account: { id: 1, name: 'Банк RUB', currency: 'RUB' },
    display: { RUB: cbr('920000'), USD: same('10000'), EUR: cbr('8500') },
  })

  async function openSheet(name: RegExp) {
    fireEvent.click(screen.getByRole('button', { name }))
    return screen.findByRole('dialog')
  }

  async function startAct(sheet: HTMLElement, label: string) {
    fireEvent.click(within(sheet).getByRole('button', { name: label }))
    return within(sheet).findByRole('region', { name: label })
  }

  it('EARS-543: «Отметить оплату» with a date and an account and no file posts the list row’s token', async () => {
    renderScreen()
    const sheet = await openSheet(/^Заявка №3:/)
    const form = await startAct(sheet, 'Отметить оплату')
    expect(within(form).getByLabelText('Дата оплаты')).toHaveProperty('value', '2026-11-18')
    fireEvent.click(within(form).getByRole('button', { name: 'Оплачено' }))

    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    expect(refine.mutate.mock.calls[0][0]).toMatchObject({
      url: '/p/finance/api/requests/3/actions',
      values: { act: 'mark-paid', snapshot: 'token-1', occurredOn: '2026-11-18', accountId: 1 },
    })
    expect(refine.mutate.mock.calls[0][0].values).not.toHaveProperty('paidAmount')
  })

  it('EARS-543: a USD request paid from a RUB account cannot be marked until the debited roubles are entered', async () => {
    refine.custom.data = snapshot({ requests: [usdApproved] })
    renderScreen()
    const sheet = await openSheet(/^Заявка №9:/)
    const form = await startAct(sheet, 'Отметить оплату')
    const submit = within(form).getByRole('button', { name: 'Оплачено' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(within(form).getByLabelText(/Списано фактически, RUB/), {
      target: { value: '9 384,00' },
    })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    expect(refine.mutate.mock.calls[0][0].values).toMatchObject({
      act: 'mark-paid',
      paidAmount: '938400',
      paidCurrency: 'RUB',
    })
  })

  it('EARS-543/548: the server’s refusal is shown verbatim in the form, and the board re-reads itself', async () => {
    renderScreen()
    const sheet = await openSheet(/^Заявка №3:/)
    const form = await startAct(sheet, 'Отметить оплату')
    fireEvent.click(within(form).getByRole('button', { name: 'Оплачено' }))
    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    const refusal =
      'Заявка #3 изменилась после того, как карточка её показала — отметка не проведена; откройте заявку заново (EARS-543/544, EARS-548).'
    await act(async () => refine.mutate.mock.calls[0][1].onError({ message: refusal }))

    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe(refusal)
    expect(refine.custom.refetch).toHaveBeenCalled()
  })

  it('EARS-543/545: a chosen receipt is attached to the request once the act has posted', async () => {
    renderScreen()
    const sheet = await openSheet(/^Заявка №3:/)
    const form = await startAct(sheet, 'Отметить оплату')
    fireEvent.change(within(form).getByLabelText('Чек или скриншот оплаты'), {
      target: { files: [new File(['%PDF-1.4'], 'чек.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Оплачено' }))
    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    expect(refine.mutate.mock.calls[0][0].values).not.toHaveProperty('documentIds')

    await act(async () => refine.mutate.mock.calls[0][1].onSuccess({ data: {} }))
    expect(refine.mutate).toHaveBeenCalledTimes(2)
    const upload = refine.mutate.mock.calls[1][0]
    expect(upload.url).toBe('/p/finance/api/documents')
    expect((upload.values as FormData).get('intakeItemId')).toBe('3')
  })

  it('EARS-544: «Отметить возврат» prefills the required refund and sends it in the account’s minor units', async () => {
    renderScreen()
    const sheet = await openSheet(/^Заявка №4:/)
    const form = await startAct(sheet, 'Отметить возврат')
    expect(within(form).getByLabelText(/Сумма возврата/)).toHaveProperty('value', '10000,00')
    fireEvent.click(within(form).getByRole('button', { name: 'Возвращено' }))
    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    expect(refine.mutate.mock.calls[0][0].values).toMatchObject({
      act: 'mark-reimbursed',
      snapshot: 'token-1',
      accountId: 1,
      amount: '1000000',
    })
  })

  it('EARS-542: the sheet of a «Ждёт решения» request offers its three acts and warns that payment details are missing', async () => {
    renderScreen()
    const sheet = await openSheet(/^Заявка №1:/)
    expect(within(sheet).getByText('Заявка №1 · Ждёт решения')).toBeTruthy()
    expect(within(sheet).getByText('Реквизитов или ссылки на оплату нет')).toBeTruthy()
    for (const label of ['Одобрить', 'Одобрить и отметить оплату', 'Отклонить']) {
      expect(within(sheet).getByRole('button', { name: label })).toBeTruthy()
    }
    expect(within(sheet).getByText('Подана')).toBeTruthy()
    expect(within(sheet).getByText('Решение')).toBeTruthy()
  })

  it('EARS-541/542: a reader without `finance-approve` gets the sheet with no act at all', async () => {
    refine.custom.data = snapshot({ permissions: { canApprove: false, canEnter: false } })
    renderScreen()
    const sheet = await openSheet(/^Заявка №3:/)
    expect(
      within(sheet).queryByRole('button', { name: /^(Одобрить|Отметить|Отклонить|Отозвать)/ }),
    ).toBeNull()
  })

  it('EARS-546: a paid request with no document is marked «без чека» in its row and in its sheet', async () => {
    renderScreen()
    pick('Закрытые')
    const paid = group('Оплачено')
    const row = within(paid).getByText('Оплачено в октябре').closest('tr')!
    expect(within(row).getByText('без чека')).toBeTruthy()
    const sheet = await openSheet(/^Заявка №7:/)
    expect(within(sheet).getByText('без чека')).toBeTruthy()
  })

  it('EARS-563: a posted USD payment carries «Курс против рынка» — Рынок, Факт, Переплата — and $ changes the amounts, not the %', async () => {
    const posted = item({
      id: 11,
      status: 'posted',
      stage: 'paid',
      alreadyPaid: true,
      hasDocument: true,
      note: 'Инвойс в долларах',
      currency: 'USD',
      amount: '10000',
      occurredOn: '2026-11-13',
      market: {
        kind: 'measured',
        date: '2026-11-13',
        rate: { currency: 'USD', rateDate: '2026-11-13', nominal: 1, valueRub: '92.0000' },
        fact: {
          amount: '938400',
          currency: 'RUB',
          fee: { amount: '5000', currency: 'RUB' },
          account: 'Банк RUB',
        },
        percentTenths: '20',
        wording: 'хуже рынка на 2,0%',
        display: {
          RUB: { fact: '938400', market: '920000', overpayment: '18400' },
          USD: { fact: '10200', market: '10000', overpayment: '200' },
          EUR: null,
        },
      },
      display: { RUB: cbr('938400'), USD: same('10000'), EUR: cbr('8500') },
    })
    refine.custom.data = snapshot({ requests: [posted] })
    renderScreen()
    pick('Закрытые')
    let sheet = await openSheet(/^Заявка №11:/)
    const block = within(sheet).getByRole('region', { name: 'Курс против рынка' })
    expect(block.textContent).toMatch(/Рынок9\s200,00\s₽курс ЦБ на 13\.11\.2026/)
    expect(block.textContent).toMatch(
      /Факт9\s384,00\s₽со счёта «Банк RUB» · в т\.ч\. комиссия 50,00 ₽/,
    )
    expect(block.textContent).toMatch(/Переплата\+184,00\s₽хуже рынка на 2,0%/)

    fireEvent.click(within(sheet).getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    pick('$')
    sheet = await openSheet(/^Заявка №11:/)
    const usd = within(sheet).getByRole('region', { name: 'Курс против рынка' })
    expect(usd.textContent).toMatch(/\+2,00\s\$хуже рынка на 2,0%/)
  })

  it('EARS-547: «Отметить все N как оплаченные…» previews the plan and its exclusions, and posts only on the explicit confirm', async () => {
    refine.custom.data = snapshot({ requests: [...QUEUE, usdApproved] })
    renderScreen()
    fireEvent.click(
      within(group('К оплате')).getByRole('button', { name: 'Отметить все 2 как оплаченные…' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(refine.mutate).not.toHaveBeenCalled()

    fireEvent.keyDown(within(dialog).getByRole('combobox', { name: 'Счёт пакета' }), {
      key: 'ArrowDown',
    })
    fireEvent.click(screen.getByRole('option', { name: 'Банк RUB · RUB' }))
    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    const preview = refine.mutate.mock.calls[0][0]
    expect(preview.values).toMatchObject({
      group: 'pay',
      accountId: 1,
      preview: true,
    })
    expect(preview.values.items).toEqual(
      expect.arrayContaining([
        { id: 3, snapshot: 'token-1' },
        { id: 9, snapshot: 'token-1' },
      ]),
    )
    await act(async () =>
      refine.mutate.mock.calls[0][1].onSuccess({
        data: {
          posted: [],
          planned: [{ id: 3, occurredOn: '2026-09-17' }],
          excluded: [{ id: 9, reason: 'Валюта списания USD ≠ RUB — валюте счёта пакета.' }],
        },
      }),
    )
    const planned = within(dialog).getByRole('region', { name: 'Будет отмечено' })
    expect(planned.textContent).toMatch(/17\.09\.2026№3/)
    expect(within(dialog).getByRole('region', { name: 'Не войдут в пакет' }).textContent).toMatch(
      /№9.*Валюта списания USD ≠ RUB/,
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отметить 1 как оплаченные' }))
    expect(refine.mutate).toHaveBeenCalledTimes(2)
    expect(refine.mutate.mock.calls[1][0].values).toMatchObject({ preview: false, accountId: 1 })
  })

  it('EARS-547: cancelling the bulk dialog posts nothing', async () => {
    refine.custom.data = snapshot({ requests: [...QUEUE, usdApproved] })
    renderScreen()
    fireEvent.click(
      within(group('К оплате')).getByRole('button', { name: 'Отметить все 2 как оплаченные…' }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(refine.mutate).not.toHaveBeenCalled()
  })

  it('EARS-547: a group with a single row has no bulk act', () => {
    renderScreen()
    expect(within(group('К оплате')).queryByRole('button', { name: /^Отметить все/ })).toBeNull()
  })
})

describe('the deep link ?request=<id> (lead addition on #551)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('EARS-542: /p/finance/requests?request=<id> opens that request’s sheet on load, with the list row’s token', async () => {
    window.history.replaceState(null, '', '/p/finance/requests?request=3')
    renderScreen()
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('Заявка №3 · К оплате')).toBeTruthy()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Отметить оплату' }))
    const form = await within(sheet).findByRole('region', { name: 'Отметить оплату' })
    fireEvent.click(within(form).getByRole('button', { name: 'Оплачено' }))
    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    expect(refine.mutate.mock.calls[0][0].values).toMatchObject({ snapshot: 'token-1' })
  })

  it('EARS-542: closing the linked sheet drops the parameter, so the queue stays a queue', async () => {
    window.history.replaceState(null, '', '/p/finance/requests?request=3')
    renderScreen()
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.search).toBe('')
  })

  it('EARS-542: an unknown or unreadable id leaves the plain queue with a quiet notice', () => {
    window.history.replaceState(null, '', '/p/finance/requests?request=999')
    renderScreen()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      screen.getByText('Заявки №999 нет в списке — она удалена или недоступна вам.'),
    ).toBeTruthy()
    expect(group('Ждёт решения')).toBeTruthy()
  })
})
