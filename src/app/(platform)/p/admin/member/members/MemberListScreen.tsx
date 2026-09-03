'use client'

import { useNavigation, useUpdate, type HttpError } from '@refinedev/core'
import { useTable } from '@refinedev/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import React from 'react'

import type { MemberRecord, MemberUpdateInput } from '@/lib/member'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { DataTable } from '@/ui/refine-ui/data-table/data-table'
import { ListView } from '@/ui/refine-ui/views/list-view'

import { errorMessage, MEMBER_RESOURCE } from './constants'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

function useDebouncedValue(value: string): string {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [value])
  return debounced
}

/**
 * The members register (#316), rebuilt on the kit's `data-table` block (#434).
 *
 * WHAT CHANGED. The screen used to hand-roll the whole list: `useList` for the
 * data, a literal `<Table>` for the rows, its own `page` state, its own
 * «N–M из T» counter and its own two pager buttons. All four are now the
 * block's: `useTable` (`@refinedev/react-table`) owns paging and sorting, and
 * `DataTable` renders the head, the rows, the loading skeleton, the empty state
 * and the pager. The column set below is the only part that is this screen's.
 *
 * COMPOSITION (the agent's call, owner ruling 2026-09-02). One dominant object
 * on the screen — the register — so the page gives it the full width and only
 * two things sit above it: the title block, which says whose data this is, and
 * the search field, which is the single act a reader performs before reading.
 * The primary action («Добавить участника») is at the title's right edge, the
 * one place on the screen that is not the table. Row actions stay inside the
 * row, right-aligned and secondary — a register is read far more often than it
 * is edited.
 *
 * FEEDBACK. Toggling a status is a mutation, so its success and failure both
 * come back as toasts from the shell's notification provider. The Alert below
 * is only for a register that could not be READ — a state the reader must keep
 * looking at, because there is nothing else on the screen while it holds.
 */
export function MemberListScreen() {
  const [search, setSearch] = React.useState('')
  const debouncedSearch = useDebouncedValue(search)
  const { create, show } = useNavigation()
  const update = useUpdate<MemberRecord, HttpError, MemberUpdateInput>()

  const toggleStatus = React.useCallback(
    (member: MemberRecord) => {
      const next = member.status === 'active' ? 'inactive' : 'active'
      update.mutate({
        resource: MEMBER_RESOURCE,
        id: member.id,
        values: { status: next },
        successNotification: {
          type: 'success',
          message: next === 'active' ? 'Участник активирован.' : 'Участник деактивирован.',
          description: member.name,
        },
        errorNotification: (error) => ({
          type: 'error',
          message: 'Не удалось изменить статус участника.',
          description: errorMessage(error, member.name),
        }),
      })
    },
    [update],
  )

  const columns = React.useMemo<ColumnDef<MemberRecord>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Имя',
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      { id: 'email', accessorKey: 'email', header: 'Email' },
      {
        id: 'role',
        accessorKey: 'role',
        header: 'Роль',
        cell: ({ row }) => row.original.role ?? '—',
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Статус',
        size: 140,
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'active' ? 'secondary' : 'outline'}>
            {row.original.status === 'active' ? 'Активен' : 'Неактивен'}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Действия</span>,
        size: 260,
        enableSorting: false,
        cell: ({ row }) => {
          const member = row.original
          return (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label={`Открыть ${member.name}`}
                onClick={() => show(MEMBER_RESOURCE, member.id)}
              >
                Открыть
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={update.mutation.isPending}
                aria-label={`${member.status === 'active' ? 'Деактивировать' : 'Активировать'} ${member.name}`}
                onClick={() => toggleStatus(member)}
              >
                {member.status === 'active' ? 'Деактивировать' : 'Активировать'}
              </Button>
            </div>
          )
        },
      },
    ],
    [show, toggleStatus, update.mutation.isPending],
  )

  const table = useTable<MemberRecord, HttpError>({
    columns,
    refineCoreProps: {
      resource: MEMBER_RESOURCE,
      pagination: { pageSize: PAGE_SIZE },
      sorters: { initial: [{ field: 'name', order: 'asc' }] },
      // PERMANENT, not `setFilters`. `@refinedev/react-table` mirrors the
      // tanstack `columnFilters` state into Refine's filters on every render, so
      // a filter pushed imperatively from an effect is overwritten by the empty
      // column state before the query runs — observed as an unfiltered register
      // with the search box full. A permanent filter is outside that mirror and
      // is exactly what this search is: a query-level narrowing the reader
      // cannot clear per column.
      filters: {
        permanent: debouncedSearch
          ? [{ field: 'q', operator: 'contains', value: debouncedSearch }]
          : [],
      },
    },
  })

  const { setCurrentPage, tableQuery } = table.refineCore

  // A new query is a new register: page 2 of the previous one means nothing.
  React.useEffect(() => {
    setCurrentPage(1)

    // re-created on every render by the hook; depending on it would reset the
    // page on every render instead of on every new query.
  }, [debouncedSearch])

  return (
    <ListView>
      <section aria-labelledby="members-heading" className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 id="members-heading" className="font-heading text-2xl font-semibold tracking-tight">
              Участники
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Профили, доступ и внешние идентификаторы команды BBM.
            </p>
          </div>
          <Button onClick={() => create(MEMBER_RESOURCE)}>Добавить участника</Button>
        </div>

        <Input
          type="search"
          role="searchbox"
          aria-label="Поиск участников"
          placeholder="Имя или email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-md"
        />

        {tableQuery.error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {errorMessage(tableQuery.error, 'Не удалось прочитать реестр участников.')}
            </AlertDescription>
          </Alert>
        ) : (
          <DataTable
            table={table}
            emptyTitle="Участников пока нет"
            emptyDescription="Создайте первый профиль — алиасы можно добавить после сохранения."
          />
        )}
      </section>
    </ListView>
  )
}
