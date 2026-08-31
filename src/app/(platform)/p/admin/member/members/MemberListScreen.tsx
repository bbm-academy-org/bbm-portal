'use client'

import { useList, useNavigation, useUpdate, type HttpError } from '@refinedev/core'
import React from 'react'

import type { MemberRecord, MemberUpdateInput } from '@/lib/member'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card'
import { Input } from '@/ui/input'
import { Skeleton } from '@/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'

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

export function MemberListScreen() {
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const debouncedSearch = useDebouncedValue(search)
  const { create, show } = useNavigation()
  const update = useUpdate<MemberRecord, HttpError, MemberUpdateInput>()
  const { query, result } = useList<MemberRecord, HttpError>({
    resource: MEMBER_RESOURCE,
    pagination: { currentPage: page, pageSize: PAGE_SIZE },
    sorters: [{ field: 'name', order: 'asc' }],
    filters: debouncedSearch ? [{ field: 'q', operator: 'contains', value: debouncedSearch }] : [],
  })
  const total = result.total ?? result.data.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function toggleStatus(member: MemberRecord) {
    update.mutate({
      resource: MEMBER_RESOURCE,
      id: member.id,
      values: { status: member.status === 'active' ? 'inactive' : 'active' },
    })
  }

  return (
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
        onChange={(event) => {
          setSearch(event.target.value)
          setPage(1)
        }}
        className="max-w-md"
      />

      {query.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {errorMessage(query.error, 'Не удалось прочитать реестр участников.')}
          </AlertDescription>
        </Alert>
      ) : null}
      {update.mutation.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {errorMessage(update.mutation.error, 'Не удалось изменить статус участника.')}
          </AlertDescription>
        </Alert>
      ) : null}

      {query.isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Загружаем участников…</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ) : !query.error && result.data.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Участников пока нет</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Создайте первый профиль — алиасы можно добавить после сохранения.
          </CardContent>
        </Card>
      ) : !query.error ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Имя</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{member.name}</TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>{member.role ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={member.status === 'active' ? 'secondary' : 'outline'}>
                        {member.status === 'active' ? 'Активен' : 'Неактивен'}
                      </Badge>
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <nav
            aria-label="Страницы участников"
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <span className="text-muted-foreground">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} из {total}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Предыдущая страница"
              disabled={page <= 1 || query.isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Назад
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Следующая страница"
              disabled={page >= pageCount || query.isLoading}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            >
              Вперёд
            </Button>
          </nav>
        </div>
      ) : null}
    </section>
  )
}
