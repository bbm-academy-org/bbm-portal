import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refine = vi.hoisted(() => ({
  list: {} as Record<string, unknown>,
  one: {} as Record<string, unknown>,
  create: {} as Record<string, unknown>,
  update: {} as Record<string, unknown>,
  navigation: {
    create: vi.fn(),
    show: vi.fn(),
    edit: vi.fn(),
    list: vi.fn(),
  },
}))

vi.mock('@refinedev/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@refinedev/core')>()
  return {
    ...actual,
    useList: () => refine.list,
    useOne: () => refine.one,
    useCreate: () => refine.create,
    useUpdate: () => refine.update,
    useNavigation: () => refine.navigation,
  }
})

const member = {
  id: 7,
  slug: 'anna',
  email: 'anna@bbm.local',
  name: 'Анна',
  role: 'Куратор',
  status: 'active' as const,
  timezone: 'Europe/Moscow',
  createdAt: '2026-08-29T06:00:00.000Z',
  updatedAt: '2026-08-29T06:00:00.000Z',
}

beforeEach(() => {
  refine.list = {
    query: { isLoading: false, error: null },
    result: { data: [member], total: 1 },
  }
  refine.one = { query: { isLoading: false, error: null }, result: member }
  refine.create = { mutate: vi.fn(), mutation: { isPending: false, error: null } }
  refine.update = { mutate: vi.fn(), mutation: { isPending: false, error: null } }
  Object.values(refine.navigation).forEach((mock) => mock.mockReset())
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        data: [{ id: 11, memberId: 7, kind: 'mattermost', value: 'anna', note: null }],
        total: 1,
      }),
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('members cabinet UI (owner Option A, spec 311 EARS-441..445)', () => {
  it('renders the owner-picked searchable list with open/deactivate and no delete', async () => {
    const { MemberListScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberListScreen')
    render(React.createElement(MemberListScreen))

    expect(screen.getByRole('heading', { name: 'Участники' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Поиск участников' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Добавить участника' })).toBeTruthy()
    expect(screen.getByText('anna@bbm.local')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Открыть Анна' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Деактивировать Анна' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Удалить участника/ })).toBeNull()
  }, 15_000)

  it('renders loading, empty and readable list-error states', async () => {
    const { MemberListScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberListScreen')
    refine.list = { query: { isLoading: true, error: null }, result: { data: [], total: 0 } }
    const view = render(React.createElement(MemberListScreen))
    expect(screen.getByText('Загружаем участников…')).toBeTruthy()

    refine.list = { query: { isLoading: false, error: null }, result: { data: [], total: 0 } }
    view.rerender(React.createElement(MemberListScreen))
    expect(screen.getByText('Участников пока нет')).toBeTruthy()

    refine.list = {
      query: { isLoading: false, error: { message: 'Реестр временно недоступен' } },
      result: { data: [], total: 0 },
    }
    view.rerender(React.createElement(MemberListScreen))
    expect(screen.getByText('Реестр временно недоступен')).toBeTruthy()
  })

  it('keeps create to the profile only and exposes validation/pending failure states', async () => {
    const { MemberCreateScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberCreateScreen')
    render(React.createElement(MemberCreateScreen))
    expect(screen.getByRole('heading', { name: 'Новый участник' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Алиасы' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Создать участника' }))
    expect(screen.getByText('Укажите имя.')).toBeTruthy()
    expect(screen.getByText('Укажите корректный email.')).toBeTruthy()
  })

  it('renders profile left and aliases right, stacking narrowly; existing email is read-only', async () => {
    const { MemberRecordScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberRecordScreen')
    const { container } = render(React.createElement(MemberRecordScreen, { id: 7, mode: 'edit' }))
    expect(screen.getByRole('heading', { name: 'Профиль' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Алиасы' })).toBeTruthy()
    expect(screen.getByDisplayValue('anna@bbm.local')).toHaveProperty('readOnly', true)
    expect(container.querySelector('[data-member-composition]')?.className).toContain('grid-cols-1')
    await waitFor(() => expect(screen.getByText('mattermost')).toBeTruthy())
  })

  it('supports alias add/edit/delete controls and names a duplicate refusal', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(Response.json({ data: [], total: 0 })).mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'conflict',
            message: 'Алиас уже принадлежит участнику «Борис».',
          },
        },
        { status: 409 },
      ),
    )
    const { AliasPanel } = await import('@/app/(platform)/p/admin/member/members/AliasPanel')
    render(React.createElement(AliasPanel, { memberId: 7, editable: true }))
    await waitFor(() => expect(screen.getByText('Алиасов пока нет')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Добавить алиас' }))
    fireEvent.change(screen.getByLabelText('Тип алиаса'), { target: { value: 'mattermost' } })
    fireEvent.change(screen.getByLabelText('Значение алиаса'), { target: { value: 'boris' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить алиас' }))
    await waitFor(() =>
      expect(screen.getByText('Алиас уже принадлежит участнику «Борис».')).toBeTruthy(),
    )
  })
})
