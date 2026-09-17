'use client'

import { useDelete, useList, useNavigation, useUpdate, type HttpError } from '@refinedev/core'

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
  referenceErrorNotification,
  referenceSuccessNotification,
  type FinanceReferenceRow,
} from './reference-config'

function failure(error: HttpError | null | undefined, fallback: string) {
  return error?.message || fallback
}

/**
 * ONE ENTRY POINT PER ROW (owner remark on the live stand, Антон, 2026-09-17:
 * «Зачем в справочниках две разные кнопки "Открыть" и "Изменить", которые по
 * сути ведут в одно и то же место? Это плохой UX»).
 *
 * The row used to carry both: «Открыть» → the record card in `show` mode and
 * «Изменить» → the SAME card in `edit` mode, for all six registers — two names
 * for one destination, and the reader had to learn which of them did what. The
 * record's NAME is now that single entry point; the action column keeps only
 * the acts whose OUTCOME differs from opening it — «В архив» and «Удалить».
 * There is no read-only «view» screen distinct from the card, so nothing is
 * lost: a record the module owns (a system account) or one already archived is
 * not editable, and its name leads to the same card in its read-only mode.
 *
 * The control is the kit's own `Button variant="link"` (`@/ui/button`), not a
 * whole-row `onClick`: hanging navigation on the `TableRow` primitive is the
 * interaction-state defect `RequestsTable.tsx` names, and a named control is
 * reachable by pointer and by keyboard alike.
 */

export function FinanceReferenceListScreen({ resource }: { resource: FinanceReferenceResource }) {
  const config = financeReferenceUi[resource]
  const resourceName = financeResourceName(resource)
  const navigation = useNavigation()
  const update = useUpdate<FinanceReferenceRow, HttpError, { retire: true }>()
  const remove = useDelete<FinanceReferenceRow, HttpError>()
  const { query, result } = useList<FinanceReferenceRow, HttpError>({
    resource: resourceName,
    pagination: { currentPage: 1, pageSize: 100 },
  })

  // One feedback channel for the whole cabinet — the Refine notification
  // provider, in the table's own Russian (#479; `docs/design/ui-whitelist.md`
  // → Feedback). No inline notice duplicates the toast.
  function retire(row: FinanceReferenceRow) {
    update.mutate({
      resource: resourceName,
      id: row.id,
      values: { retire: true },
      successNotification: referenceSuccessNotification(resource, 'retire', row.name),
      errorNotification: referenceErrorNotification(resource, 'retire', row.name),
    })
  }

  function deleteRow(row: FinanceReferenceRow) {
    remove.mutate({
      resource: resourceName,
      id: row.id,
      successNotification: referenceSuccessNotification(resource, 'delete', row.name),
      errorNotification: referenceErrorNotification(resource, 'delete', row.name),
    })
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
                // The name leads where the row can actually be worked: the edit
                // card when the record is editable, the read-only card when the
                // module owns it or it is archived.
                const editable = active && !systemAccount
                return (
                  <TableRow key={String(row.id)}>
                    {config.columns.map((column) =>
                      column.key === 'name' ? (
                        <TableCell key={column.key} className="font-medium">
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 font-medium"
                            onClick={() =>
                              editable
                                ? navigation.edit(resourceName, row.id)
                                : navigation.show(resourceName, row.id)
                            }
                          >
                            {displayValue(row[column.key])}
                          </Button>
                        </TableCell>
                      ) : (
                        <TableCell key={column.key}>{displayValue(row[column.key])}</TableCell>
                      ),
                    )}
                    <TableCell>
                      <Badge variant={active ? 'secondary' : 'outline'}>
                        {active ? 'Активна' : 'В архиве'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
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
