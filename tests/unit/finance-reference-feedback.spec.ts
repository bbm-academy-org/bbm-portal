import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The reference cabinet's feedback channel (#479 UX-sanity round). Two defects
// the live stand showed on `/p/admin/finance/purposes/<id>`:
//   1. no `successNotification` was passed, so Refine raised its untranslated
//      default toast («Successfully updated finance.purpose»);
//   2. the saved state ALSO rendered an inline `Alert` — muted text in a
//      bordered box that reads as an empty input, and a duplicate of the
//      transient toast, which `docs/design/ui-whitelist.md` → Feedback settles
//      against.
// Both are asserted at the SHARED point, so every reference table inherits it.

const refine = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  row: { id: 7, name: 'Продажи курса', categoryId: 3, productBinding: 'required', retiredAt: null },
  rows: [] as Array<Record<string, unknown>>,
  navigation: { create: vi.fn(), show: vi.fn(), edit: vi.fn(), list: vi.fn() },
}))

vi.mock('@refinedev/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@refinedev/core')>()
  return {
    ...actual,
    useList: () => ({
      query: { isLoading: false, error: null },
      result: { data: refine.rows, total: refine.rows.length },
    }),
    useOne: () => ({ query: { isLoading: false, error: null }, result: refine.row }),
    useCreate: () => ({
      mutate: refine.createMutate,
      mutation: { isPending: false, error: null },
    }),
    useUpdate: () => ({
      mutate: refine.updateMutate,
      mutation: { isPending: false, error: null },
    }),
    useDelete: () => ({
      mutate: refine.deleteMutate,
      mutation: { isPending: false, error: null },
    }),
    useNavigation: () => refine.navigation,
  }
})

beforeEach(() => {
  refine.createMutate.mockReset()
  refine.updateMutate.mockReset()
  refine.deleteMutate.mockReset()
  refine.rows = []
})

afterEach(cleanup)

type Notification = { type: string; message: string; description?: string }
type MutateArgs = {
  successNotification?: Notification | ((...args: unknown[]) => Notification)
  errorNotification?: Notification | ((...args: unknown[]) => Notification)
}

function resolve(
  value: Notification | ((...args: unknown[]) => Notification) | undefined,
  arg?: unknown,
): Notification | undefined {
  return typeof value === 'function' ? value(arg) : value
}

const CYRILLIC = /[а-яё]/i
const LATIN_WORD = /\b(successful|successfully|error|updated|created|deleted)\b/i

function expectRussian(notification: Notification | undefined) {
  expect(notification).toBeTruthy()
  expect(notification?.message).toMatch(CYRILLIC)
  expect(notification?.message).not.toMatch(LATIN_WORD)
}

describe('finance reference cabinet — save feedback (#479)', () => {
  it('names the record in Russian when an edit is saved', async () => {
    const { FinanceReferenceRecordScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceScreens')

    render(
      React.createElement(FinanceReferenceRecordScreen, {
        resource: 'purposes',
        id: '7',
        mode: 'edit',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /сохранить изменения/i }))

    expect(refine.updateMutate).toHaveBeenCalledTimes(1)
    const args = refine.updateMutate.mock.calls[0][0] as MutateArgs
    const success = resolve(args.successNotification)
    expectRussian(success)
    expect(success?.message).toMatch(/назначени/i)
    expectRussian(resolve(args.errorNotification, new Error('boom')))
  })

  it('names the record in Russian when a new one is created', async () => {
    const { FinanceReferenceCreateScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceScreens')

    render(React.createElement(FinanceReferenceCreateScreen, { resource: 'categories' }))
    fireEvent.change(screen.getByLabelText(/название/i), { target: { value: 'Маркетинг' } })
    fireEvent.click(screen.getByRole('button', { name: /^сохранить$/i }))

    expect(refine.createMutate).toHaveBeenCalledTimes(1)
    const args = refine.createMutate.mock.calls[0][0] as MutateArgs
    const success = resolve(args.successNotification)
    expectRussian(success)
    expect(success?.message).toMatch(/стать/i)
    expectRussian(resolve(args.errorNotification, new Error('boom')))
  })

  it('names the record in Russian when a row is archived or deleted from the list', async () => {
    refine.rows = [{ id: 4, name: 'Старый проект', retiredAt: null }]
    const { FinanceReferenceListScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceListScreen')

    render(React.createElement(FinanceReferenceListScreen, { resource: 'projects' }))
    fireEvent.click(screen.getByRole('button', { name: /архивировать старый проект/i }))

    expect(refine.updateMutate).toHaveBeenCalledTimes(1)
    const args = refine.updateMutate.mock.calls[0][0] as MutateArgs
    expectRussian(resolve(args.successNotification))
    expectRussian(resolve(args.errorNotification, new Error('boom')))
  })

  it('keeps the outcome in the toast alone — no inline status box duplicates it', async () => {
    const { FinanceReferenceRecordScreen } =
      await import('@/app/(platform)/p/admin/finance/FinanceReferenceScreens')

    render(
      React.createElement(FinanceReferenceRecordScreen, {
        resource: 'purposes',
        id: '7',
        mode: 'edit',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /сохранить изменения/i }))
    const onSuccess = refine.updateMutate.mock.calls[0][1] as { onSuccess?: () => void } | undefined
    act(() => onSuccess?.onSuccess?.())

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/изменения сохранены/i)).toBeNull()
  })
})
