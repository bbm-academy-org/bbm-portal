import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
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
  // Список переехал на `useTable` + блок `DataTable` (#434): фикстура ниже —
  // это то, что подставляется в РЕАЛЬНУЮ tanstack-таблицу, а не заглушка вывода.
  table: {
    rows: [] as unknown[],
    total: 0,
    isLoading: false,
    error: null as unknown,
    currentPage: 1,
    pageSize: 50,
    setCurrentPage: vi.fn(),
    setPageSize: vi.fn(),
    setFilters: vi.fn(),
  },
  one: {} as Record<string, unknown>,
  create: {} as Record<string, unknown>,
  update: {} as Record<string, unknown>,
  navigation: {
    create: vi.fn(),
    show: vi.fn(),
    edit: vi.fn(),
    list: vi.fn(),
  },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@refinedev/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@refinedev/core')>()
  return {
    ...actual,
    useOne: () => refine.one,
    useCreate: () => refine.create,
    useUpdate: () => refine.update,
    useNavigation: () => refine.navigation,
  }
})

vi.mock('@refinedev/react-table', async () => {
  const { getCoreRowModel, useReactTable } = await import('@tanstack/react-table')
  return {
    useTable: <TData>({ columns }: { columns: ColumnDef<TData>[] }) => {
      const state = refine.table
      const reactTable = useReactTable<TData>({
        data: state.rows as TData[],
        columns,
        getCoreRowModel: getCoreRowModel(),
        manualPagination: true,
        manualSorting: true,
        manualFiltering: true,
      })
      return {
        reactTable,
        refineCore: {
          tableQuery: {
            isLoading: state.isLoading,
            error: state.error,
            data: { data: state.rows, total: state.total },
          },
          currentPage: state.currentPage,
          setCurrentPage: state.setCurrentPage,
          pageCount: Math.max(1, Math.ceil(state.total / state.pageSize)),
          pageSize: state.pageSize,
          setPageSize: state.setPageSize,
          setFilters: state.setFilters,
        },
      }
    },
  }
})

vi.mock('sonner', () => ({ toast: refine.toast }))

vi.mock('@/app/(platform)/p/admin/member/members/alias-actions', () => ({
  validateAliasResponse: async (
    _resource: string,
    envelope: string,
    payload: { data?: unknown },
  ) => {
    if (
      envelope === 'one' &&
      (!payload.data ||
        typeof payload.data !== 'object' ||
        typeof (payload.data as { id?: unknown }).id !== 'number')
    ) {
      return { success: false, issues: 'data.id: expected number' }
    }

    return { success: true, data: payload }
  },
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
  refine.table.rows = [member]
  refine.table.total = 1
  refine.table.isLoading = false
  refine.table.error = null
  refine.table.currentPage = 1
  refine.table.pageSize = 50
  refine.table.setCurrentPage.mockReset()
  refine.table.setPageSize.mockReset()
  refine.table.setFilters.mockReset()
  refine.one = { query: { isLoading: false, error: null }, result: member }
  refine.create = { mutate: vi.fn(), mutation: { isPending: false, error: null } }
  refine.update = { mutate: vi.fn(), mutation: { isPending: false, error: null } }
  Object.values(refine.navigation).forEach((mock) => mock.mockReset())
  Object.values(refine.toast).forEach((mock) => mock.mockReset())
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
  vi.useRealTimers()
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

  // Раньше проверялся собственный счётчик «N–M из T» и две кнопки «Назад»/«Вперёд».
  // Их больше нет: пагинацию рисует блок `DataTablePagination` (#434), поэтому тот же
  // контракт — «за первой полусотней есть следующая страница» — читается по его контролам.
  it('pages through every member beyond the first 50 records via the block pager', async () => {
    refine.table.total = 101
    const { MemberListScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberListScreen')
    render(React.createElement(MemberListScreen))

    expect(screen.getByText('Всего записей: 101')).toBeTruthy()
    expect(screen.getByText('Страница 1 из 3')).toBeTruthy()
    expect(screen.getByText('Строк на странице')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Первая страница' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Предыдущая страница' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('button', { name: 'Последняя страница' })).toHaveProperty(
      'disabled',
      false,
    )

    refine.table.setCurrentPage.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }))
    expect(refine.table.setCurrentPage).toHaveBeenCalledWith(2)
  })

  // Тот же контракт, что и раньше, но возврат на первую страницу теперь виден через
  // `setCurrentPage` таблицы, а фильтр — через её `setFilters`, а не через аргументы `useList`.
  it('debounces member search and returns to the first page for a new query', async () => {
    vi.useFakeTimers()
    refine.table.total = 101
    const { MemberListScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberListScreen')
    render(React.createElement(MemberListScreen))
    refine.table.setFilters.mockClear()
    refine.table.setCurrentPage.mockClear()

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'anna' },
    })
    expect(refine.table.setFilters).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(refine.table.setCurrentPage).toHaveBeenCalledWith(1)
    expect(refine.table.setFilters).toHaveBeenLastCalledWith(
      [{ field: 'q', operator: 'contains', value: 'anna' }],
      'replace',
    )
    vi.useRealTimers()
  })

  // Раньше проверялся только аргумент мутации. Теперь тот же клик обязан ещё и
  // назвать читателю результат — успех и отказ уехали в тосты shell'а (#434).
  it('toggles active and inactive members and names the outcome for the shell toast', async () => {
    const inactive = {
      ...member,
      id: 8,
      name: 'Борис',
      email: 'boris@bbm.local',
      status: 'inactive' as const,
    }
    refine.table.rows = [member, inactive]
    refine.table.total = 2
    const mutate = vi.fn()
    refine.update = { mutate, mutation: { isPending: false, error: null } }
    const { MemberListScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberListScreen')
    render(React.createElement(MemberListScreen))

    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать Анна' }))
    expect(mutate.mock.lastCall?.[0]).toMatchObject({
      resource: 'member.members',
      id: 7,
      values: { status: 'inactive' },
      successNotification: { message: 'Участник деактивирован.' },
    })
    expect(typeof mutate.mock.lastCall?.[0]?.errorNotification).toBe('function')

    fireEvent.click(screen.getByRole('button', { name: 'Активировать Борис' }))
    expect(mutate.mock.lastCall?.[0]).toMatchObject({
      resource: 'member.members',
      id: 8,
      values: { status: 'active' },
      successNotification: { message: 'Участник активирован.' },
    })
  })

  // Карточка «Загружаем участников…» ушла вместе с рукописным списком: блок рисует
  // скелетные строки и спиннер, поэтому загрузка читается по ним.
  it('renders loading, empty and readable list-error states', async () => {
    const { MemberListScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberListScreen')
    refine.table.rows = []
    refine.table.total = 0
    refine.table.isLoading = true
    const { container, rerender } = render(React.createElement(MemberListScreen))
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"]')).toHaveLength(50)
    expect(screen.queryByText('Участников пока нет')).toBeNull()

    refine.table.isLoading = false
    rerender(React.createElement(MemberListScreen))
    expect(screen.getByText('Участников пока нет')).toBeTruthy()
    expect(
      screen.getByText('Создайте первый профиль — алиасы можно добавить после сохранения.'),
    ).toBeTruthy()

    refine.table.error = { message: 'Реестр временно недоступен' }
    rerender(React.createElement(MemberListScreen))
    expect(screen.getByText('Реестр временно недоступен')).toBeTruthy()
  })

  it('keeps create to the profile only and exposes validation/pending failure states', async () => {
    const { MemberCreateScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberCreateScreen')
    render(React.createElement(MemberCreateScreen))
    expect(screen.getByRole('heading', { name: 'Новый участник' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Алиасы' })).toBeNull()
    expect(screen.queryByLabelText('Статус')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Создать участника' }))
    // Валидация react-hook-form асинхронна: без ожидания утверждения гонятся с резолвером.
    expect(await screen.findByText('Укажите имя.')).toBeTruthy()
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
        canEditStatus: true,
        submitLabel: 'Сохранить профиль',
        pending: false,
        onSubmit: submit,
      }),
    )

    const timezone = screen.getByLabelText('Часовой пояс')
    expect(timezone.getAttribute('role')).toBe('combobox')
    expect(timezone.textContent).toContain('Сохранённый пояс — America/New_York')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.lastCall?.[0]).toMatchObject({ timezone: 'America/New_York' })

    fireEvent.keyDown(timezone, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Москва — Europe/Moscow' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Новосибирск — Asia/Novosibirsk' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Бангкок — Asia/Bangkok' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Тбилиси — Asia/Tbilisi' })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: 'Бангкок — Asia/Bangkok' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }))
    await waitFor(() =>
      expect(submit.mock.lastCall?.[0]).toMatchObject({ timezone: 'Asia/Bangkok' }),
    )
  })

  it('renders profile left and aliases right, stacking narrowly; existing email is read-only', async () => {
    const { MemberRecordScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberRecordScreen')
    const { container } = render(React.createElement(MemberRecordScreen, { id: 7, mode: 'edit' }))
    expect(screen.getByRole('heading', { name: 'Профиль' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Алиасы' })).toBeTruthy()
    expect(screen.getByDisplayValue('anna@bbm.local')).toHaveProperty('readOnly', true)
    expect(screen.getByLabelText('Статус')).toBeTruthy()
    expect(container.querySelector('[data-member-composition]')?.className).toContain('grid-cols-1')
    await waitFor(() => expect(screen.getByText('mattermost')).toBeTruthy())
  })

  // Было: «acknowledges a saved profile and clears the acknowledgement after a change» —
  // проверялась инлайновая плашка «Профиль сохранён.» и её сброс при правке. Плашки больше
  // нет: подтверждение уехало в тост shell'а, поэтому экран отвечает за то, ЧТО он просит
  // показать, а не за рендер сообщения.
  it('EARS-472: hands the saved-profile acknowledgement to the shell notification channel', async () => {
    const mutate = vi.fn()
    refine.update = { mutate, mutation: { isPending: false, error: null } }
    const { MemberRecordScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberRecordScreen')
    render(React.createElement(MemberRecordScreen, { id: 7, mode: 'edit' }))

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }))
    await waitFor(() => expect(mutate).toHaveBeenCalled())

    const variables = mutate.mock.lastCall?.[0]
    expect(variables).toMatchObject({
      resource: 'member.members',
      id: 7,
      successNotification: { type: 'success', message: 'Профиль сохранён.' },
    })
    expect(typeof variables?.errorNotification).toBe('function')
    expect(screen.queryByText('Профиль сохранён.')).toBeNull()
  })

  it('EARS-472: keeps a FAILED save inline, next to the form being fixed', async () => {
    refine.update = {
      mutate: vi.fn(),
      mutation: { isPending: false, error: { message: 'Реестр отказал в записи' } },
    }
    const { MemberRecordScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberRecordScreen')
    render(React.createElement(MemberRecordScreen, { id: 7, mode: 'edit' }))

    expect(screen.getByText('Реестр отказал в записи')).toBeTruthy()
  })

  it('creates a member and hands the acknowledgement to the shell notification channel', async () => {
    const mutate = vi.fn()
    refine.create = { mutate, mutation: { isPending: false, error: null } }
    const { MemberCreateScreen } =
      await import('@/app/(platform)/p/admin/member/members/MemberCreateScreen')
    render(React.createElement(MemberCreateScreen))

    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Борис' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'boris@bbm.local' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать участника' }))
    await waitFor(() => expect(mutate).toHaveBeenCalled())

    const variables = mutate.mock.lastCall?.[0]
    expect(variables).toMatchObject({
      resource: 'member.members',
      values: { name: 'Борис', email: 'boris@bbm.local' },
      successNotification: { type: 'success', message: 'Участник создан.' },
    })
    expect(typeof variables?.errorNotification).toBe('function')
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
    // Форма живёт в диалоге (#434): она появляется только после «Добавить алиас».
    expect(screen.queryByLabelText('Значение алиаса')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить алиас' }))
    const aliasKind = await screen.findByLabelText('Тип алиаса')
    expect(aliasKind.getAttribute('role')).toBe('combobox')
    fireEvent.keyDown(aliasKind, { key: 'ArrowDown' })
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

  it('names each missing alias field under the field itself', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(Response.json({ data: [], total: 0 }))
    const { AliasPanel } = await import('@/app/(platform)/p/admin/member/members/AliasPanel')
    render(React.createElement(AliasPanel, { memberId: 7, editable: true }))
    await waitFor(() => expect(screen.getByText('Алиасов пока нет')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Добавить алиас' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить алиас' }))
    expect(await screen.findByText('Выберите тип алиаса.')).toBeTruthy()
    expect(screen.getByText('Укажите значение алиаса.')).toBeTruthy()
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

    const aliasKind = await screen.findByLabelText('Тип алиаса')
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

  it('EARS-444: resets the alias form when editing moves from alias A to alias B', async () => {
    const aliasA = { id: 11, memberId: 7, kind: 'telegram', value: 'anna_a', note: null }
    const aliasB = { id: 12, memberId: 7, kind: 'zoom_id', value: 'anna_b', note: null }
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: [aliasA, aliasB], total: 2 }))
      .mockResolvedValueOnce(Response.json({ data: { ...aliasB, note: 'Рабочий' } }))
    const { AliasPanel } = await import('@/app/(platform)/p/admin/member/members/AliasPanel')
    render(React.createElement(AliasPanel, { memberId: 7, editable: true }))
    await waitFor(() => expect(screen.getByText('anna_a', { exact: true })).toBeTruthy())

    // Открытый диалог прячет список от a11y-дерева, поэтому вторая строка берётся
    // по aria-label, а не по роли.
    fireEvent.click(screen.getByLabelText('Изменить алиас anna_a'))
    await screen.findByLabelText('Значение алиаса')
    fireEvent.click(screen.getByLabelText('Изменить алиас anna_b'))

    await waitFor(() =>
      expect(screen.getByLabelText('Тип алиаса').textContent).toContain('Zoom — идентификатор'),
    )
    expect(screen.getByLabelText('Значение алиаса')).toHaveProperty('value', 'anna_b')
    fireEvent.change(screen.getByLabelText('Примечание'), { target: { value: 'Рабочий' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить алиас' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/p/member/admin/members/7/aliases/12')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      kind: 'zoom_id',
      value: 'anna_b',
      note: 'Рабочий',
    })
  })

  it('EARS-444: resets the alias form when add changes to edit', async () => {
    const alias = { id: 11, memberId: 7, kind: 'telegram', value: 'anna', note: null }
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(Response.json({ data: [alias], total: 1 }))
    const { AliasPanel } = await import('@/app/(platform)/p/admin/member/members/AliasPanel')
    render(React.createElement(AliasPanel, { memberId: 7, editable: true }))
    await waitFor(() => expect(screen.getByText('anna', { exact: true })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Добавить алиас' }))
    fireEvent.change(await screen.findByLabelText('Значение алиаса'), {
      target: { value: 'draft' },
    })
    fireEvent.click(screen.getByLabelText('Изменить алиас anna'))

    await waitFor(() =>
      expect(screen.getByLabelText('Тип алиаса').textContent).toContain('Telegram'),
    )
    expect(screen.getByLabelText('Значение алиаса')).toHaveProperty('value', 'anna')
  })

  // Кнопка строки «Удалить алиас <value>» теперь только ОТКРЫВАЕТ подтверждение (#434);
  // сам вызов делает кнопка «Удалить алиас» в `AlertDialog`.
  it('EARS-436: keeps an alias and reports a readable failure for malformed delete success', async () => {
    const alias = { id: 11, memberId: 7, kind: 'telegram', value: 'anna', note: null }
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: [alias], total: 1 }))
      .mockResolvedValueOnce(Response.json({ data: { broken: true } }))
    const { AliasPanel } = await import('@/app/(platform)/p/admin/member/members/AliasPanel')
    render(React.createElement(AliasPanel, { memberId: 7, editable: true }))
    await waitFor(() => expect(screen.getByText('anna', { exact: true })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Удалить алиас anna' }))
    expect(await screen.findByText('Удалить алиас?')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить алиас' }))

    expect(
      await screen.findByText(/Ответ «member\.aliases» не соответствует схеме модуля/),
    ).toBeTruthy()
    expect(screen.getByText('anna', { exact: true })).toBeTruthy()
  })
})
