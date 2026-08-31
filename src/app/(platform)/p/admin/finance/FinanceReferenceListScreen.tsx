'use client'

import { useDelete, useList, useNavigation, useUpdate, type HttpError } from '@refinedev/core'
import React from 'react'

import type { FinanceReferenceResource } from '@/lib/finance'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'

import {
  displayValue,
  financeReferenceUi,
  financeResourceName,
  type FinanceReferenceRow,
} from './reference-config'

function failure(error: HttpError | null | undefined, fallback: string) {
  return error?.message || fallback
}

export function FinanceReferenceListScreen({ resource }: { resource: FinanceReferenceResource }) {
  const config = financeReferenceUi[resource]
  const resourceName = financeResourceName(resource)
  const navigation = useNavigation()
  const update = useUpdate<FinanceReferenceRow, HttpError, { retire: true }>()
  const remove = useDelete<FinanceReferenceRow, HttpError>()
  const [notice, setNotice] = React.useState('')
  const { query, result } = useList<FinanceReferenceRow, HttpError>({
    resource: resourceName,
    pagination: { currentPage: 1, pageSize: 100 },
  })

  function retire(row: FinanceReferenceRow) {
    update.mutate(
      { resource: resourceName, id: row.id, values: { retire: true } },
      { onSuccess: () => setNotice(`«${row.name}» отправлено в архив.`) },
    )
  }

  function deleteRow(row: FinanceReferenceRow) {
    remove.mutate(
      { resource: resourceName, id: row.id },
      { onSuccess: () => setNotice(`«${row.name}» удалено.`) },
    )
  }

  return (
    <section aria-labelledby="finance-reference-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            id="finance-reference-heading"
            className="font-heading text-2xl font-semibold tracking-tight"
          >
            {config.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{config.description}</p>
        </div>
        <Button onClick={() => navigation.create(resourceName)}>Добавить {config.singular}</Button>
      </div>

      {notice ? (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {query.error || update.mutation.error || remove.mutation.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {failure(
              query.error ?? update.mutation.error ?? remove.mutation.error,
              'Операцию со справочником выполнить не удалось.',
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {query.isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Загружаем справочник…</CardTitle>
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
            <CardTitle className="text-base">{config.empty}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Новая запись появится здесь сразу после сохранения.
          </CardContent>
        </Card>
      ) : !query.error ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {config.columns.map((column) => (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ))}
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((row) => {
                const systemAccount =
                  resource === 'accounts' && (row.isSystem === true || row.kind === 'system')
                const fund = resource === 'projects' && row.isFund === true
                const active = row.retiredAt === null
                return (
                  <TableRow key={String(row.id)}>
                    {config.columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={column.key === 'name' ? 'font-medium' : undefined}
                      >
                        {displayValue(row[column.key])}
                      </TableCell>
                    ))}
                    <TableCell>
                      <Badge variant={active ? 'secondary' : 'outline'}>
                        {active ? 'Активна' : 'В архиве'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Открыть ${row.name}`}
                          onClick={() => navigation.show(resourceName, row.id)}
                        >
                          Открыть
                        </Button>
                        {active && !systemAccount ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Изменить ${row.name}`}
                            onClick={() => navigation.edit(resourceName, row.id)}
                          >
                            Изменить
                          </Button>
                        ) : null}
                        {active && !systemAccount && !fund ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={update.mutation.isPending || remove.mutation.isPending}
                              aria-label={`Архивировать ${row.name}`}
                              onClick={() => retire(row)}
                            >
                              В архив
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={update.mutation.isPending || remove.mutation.isPending}
                              aria-label={`Удалить ${row.name}`}
                              onClick={() => deleteRow(row)}
                            >
                              Удалить
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  )
}
