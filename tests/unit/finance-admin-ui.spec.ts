import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refine = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  navigation: {
    create: vi.fn(),
    show: vi.fn(),
    edit: vi.fn(),
  },
}))

vi.mock('@refinedev/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@refinedev/core')>()
  return {
    ...actual,
    useList: () => ({
      query: { isLoading: false, error: null },
      result: { data: refine.rows, total: refine.rows.length },
    }),
    useUpdate: () => ({ mutate: vi.fn(), mutation: { isPending: false, error: null } }),
    useDelete: () => ({ mutate: vi.fn(), mutation: { isPending: false, error: null } }),
    useNavigation: () => refine.navigation,
  }
})

beforeEach(() => {
  refine.rows = []
  Object.values(refine.navigation).forEach((mock) => mock.mockReset())
})

afterEach(cleanup)

describe('finance reference cabinet (spec 338 acceptance CRUD check)', () => {
  it('renders the intentional categories empty state with the create action', async () => {
    const { FinanceReferenceListScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceListScreen')

    render(React.createElement(FinanceReferenceListScreen, { resource: 'categories' }))

    expect(screen.getByText(/статей расходов пока нет/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /добавить статью расходов/i })).toBeTruthy()
  })

  it('omits edit and destructive actions for system accounts', async () => {
    refine.rows = [
      {
        id: 1,
        name: 'Системный счёт',
        kind: 'system',
        currencyCode: 'RUB',
        retiredAt: null,
      },
    ]
    const { FinanceReferenceListScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceListScreen')

    render(React.createElement(FinanceReferenceListScreen, { resource: 'accounts' }))

    expect(screen.getByRole('button', { name: 'Системный счёт' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /открыть системный счёт/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /изменить системный счёт/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /архивировать системный счёт/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /удалить системный счёт/i })).toBeNull()
  })

  it('allows renaming the fund project but omits archive and delete', async () => {
    refine.rows = [{ id: 1, name: 'Фонд', isFund: true, retiredAt: null }]
    const { FinanceReferenceListScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceListScreen')

    render(React.createElement(FinanceReferenceListScreen, { resource: 'projects' }))

    expect(screen.getByRole('button', { name: 'Фонд' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /изменить фонд/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /архивировать фонд/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /удалить фонд/i })).toBeNull()
  })
})

/**
 * Owner remark on the live stand (Антон, 2026-09-17): «Зачем в справочниках две
 * разные кнопки "Открыть" и "Изменить", которые по сути ведут в одно и то же
 * место? Это плохой UX». Both row buttons led to the SAME record card — one in
 * `show` mode, one in `edit` mode — so the row offered two names for one
 * destination. The register now has ONE entry point per row: the record's NAME.
 */
describe('finance reference register — one entry point per row (#479, owner UX remark 2026-09-17)', () => {
  it('opens the editable record from its name and offers no second route to the same card', async () => {
    refine.rows = [{ id: 7, name: 'Аренда зала', allocable: true, retiredAt: null }]
    const { FinanceReferenceListScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceListScreen')

    render(React.createElement(FinanceReferenceListScreen, { resource: 'categories' }))

    expect(screen.queryByRole('button', { name: /^открыть/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^изменить/i })).toBeNull()

    const entry = screen.getByRole('button', { name: 'Аренда зала' })
    fireEvent.click(entry)

    expect(refine.navigation.edit).toHaveBeenCalledWith('finance.categories', 7)
    expect(refine.navigation.show).not.toHaveBeenCalled()
  })

  it('leaves only the acts whose outcome differs — archive and delete', async () => {
    refine.rows = [{ id: 7, name: 'Аренда зала', allocable: true, retiredAt: null }]
    const { FinanceReferenceListScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceListScreen')

    render(React.createElement(FinanceReferenceListScreen, { resource: 'categories' }))

    const rowButtons = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '')
      .filter((label) => !/^добавить/i.test(label))

    expect(rowButtons).toEqual(['Аренда зала', 'Архивировать Аренда зала', 'Удалить Аренда зала'])
  })

  it('sends a record that cannot be edited to the read-only card instead', async () => {
    refine.rows = [{ id: 3, name: 'Старый проект', retiredAt: new Date('2026-01-01') }]
    const { FinanceReferenceListScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceListScreen')

    render(React.createElement(FinanceReferenceListScreen, { resource: 'projects' }))

    fireEvent.click(screen.getByRole('button', { name: 'Старый проект' }))

    expect(refine.navigation.show).toHaveBeenCalledWith('finance.projects', 3)
    expect(refine.navigation.edit).not.toHaveBeenCalled()
  })
})
