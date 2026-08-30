import { cleanup, render, screen } from '@testing-library/react'
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

    expect(screen.getByRole('button', { name: /открыть системный счёт/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /изменить системный счёт/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /архивировать системный счёт/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /удалить системный счёт/i })).toBeNull()
  })

  it('allows renaming the fund project but omits archive and delete', async () => {
    refine.rows = [{ id: 1, name: 'Фонд', isFund: true, retiredAt: null }]
    const { FinanceReferenceListScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceListScreen')

    render(React.createElement(FinanceReferenceListScreen, { resource: 'projects' }))

    expect(screen.getByRole('button', { name: /изменить фонд/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /архивировать фонд/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /удалить фонд/i })).toBeNull()
  })
})
