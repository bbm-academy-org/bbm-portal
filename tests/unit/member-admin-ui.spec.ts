import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}

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

vi.mock('@/app/(platform)/p/admin/member/members/alias-actions', () => ({
  validateAliasResponse: async (_envelope: string, payload: { data?: unknown }) => ({
    success: true,
    data: payload.data,
  }),
}))

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

  it('toggles active and inactive members from the accepted list actions', async () => {
    const inactive = {
      ...member,
      id: 8,
      name: 'Борис',
      email: 'boris@bbm.local',
      status: 'inactive' as const,
    }
    refine.list = {
      query: { isLoading: false, error: null },
      result: { data: [member, inactive], total: 2 },
    }
    const mutate = vi.fn()
    refine.update = { mutate, mutation: { isPending: false, error: null } }
    const { MemberListScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberListScreen')
    render(React.createElement(MemberListScreen))

    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать Анна' }))
    expect(mutate).toHaveBeenCalledWith({
      resource: 'member.members',
      id: 7,
      values: { status: 'inactive' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Активировать Борис' }))
    expect(mutate).toHaveBeenLastCalledWith({
      resource: 'member.members',
      id: 8,
      values: { status: 'active' },
    })
  })

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

  it('EARS-443: uses a curated timezone selector and preserves an unlisted saved zone', async () => {
    const submit = vi.fn()
    const { MemberForm, memberFormValue } =
      await import('@/app/(platform)/p/admin/member/members/MemberForm')
    render(
      React.createElement(MemberForm, {
        initial: memberFormValue({ ...member, timezone: 'America/New_York' }),
        emailReadOnly: true,
        submitLabel: 'Сохранить профиль',
        pending: false,
        onSubmit: submit,
      }),
    )

    const timezone = screen.getByLabelText('Часовой пояс')
    expect(timezone.getAttribute('role')).toBe('combobox')
    expect(timezone.textContent).toContain('Сохранённый пояс — America/New_York')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }))
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({ timezone: 'America/New_York' }),
    )

    fireEvent.pointerDown(timezone, { button: 0 })
    expect(screen.getByRole('option', { name: 'Москва — Europe/Moscow' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Новосибирск — Asia/Novosibirsk' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Бангкок — Asia/Bangkok' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Тбилиси — Asia/Tbilisi' })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: 'Бангкок — Asia/Bangkok' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }))
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ timezone: 'Asia/Bangkok' }))
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
    const aliasKind = screen.getByLabelText('Тип алиаса')
    expect(aliasKind.getAttribute('role')).toBe('combobox')
    fireEvent.pointerDown(aliasKind, { button: 0 })
    expect(screen.getByRole('option', { name: 'Телефон' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Telegram' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Instagram' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Mattermost — логин' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Mattermost — email' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Zoom — идентификатор' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Личный email' })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: 'Mattermost — логин' }))
    fireEvent.change(screen.getByLabelText('Значение алиаса'), { target: { value: 'boris' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить алиас' }))
    await waitFor(() =>
      expect(screen.getByText('Алиас уже принадлежит участнику «Борис».')).toBeTruthy(),
    )
  })

  it('EARS-444: preserves an unlisted saved alias kind during an unrelated edit', async () => {
    const legacy = {
      id: 11,
      memberId: 7,
      kind: 'mattermost',
      value: 'anna',
      note: null,
    }
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: [legacy], total: 1 }))
      .mockResolvedValueOnce(Response.json({ data: { ...legacy, note: 'Основной аккаунт' } }))
    const { AliasPanel } = await import('@/app/(platform)/p/admin/member/members/AliasPanel')
    render(React.createElement(AliasPanel, { memberId: 7, editable: true }))
    await waitFor(() => expect(screen.getByText('anna', { exact: true })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Изменить алиас anna' }))

    const aliasKind = screen.getByLabelText('Тип алиаса')
    expect(aliasKind.getAttribute('role')).toBe('combobox')
    expect(aliasKind.textContent).toContain('Сохранённый тип — mattermost')
    fireEvent.change(screen.getByLabelText('Примечание'), {
      target: { value: 'Основной аккаунт' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить алиас' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const request = fetchMock.mock.calls[1]?.[1]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      kind: 'mattermost',
      value: 'anna',
      note: 'Основной аккаунт',
    })
  })
})
