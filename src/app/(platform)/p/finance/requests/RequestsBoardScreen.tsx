'use client'

import { useCustom, useCustomMutation, type HttpError } from '@refinedev/core'
import React from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { ListView } from '@/ui/refine-ui/views/list-view'
import { Skeleton } from '@/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import { cn } from '@/ui/utils'

import { errorMessage, formatDate, REQUESTS_ENDPOINT, REQUEST_STATUS_LABELS } from './constants'
import { LiabilityPanel } from './LiabilityPanel'
import { RequestCard } from './RequestCard'
import { RequestDetailsSheet, type RequestAct } from './RequestDetailsSheet'
import { RequestFormSheet } from './RequestFormSheet'
import type { RequestBoardItem, RequestsSnapshot } from './request-board-contract'
import {
  canDragRequest,
  currencyPrecision,
  formatRequestMoney,
  groupRequestsByStatus,
  ownRequests,
  planRequestDrop,
  REQUEST_BOARD_COLUMNS,
  type FinanceRequestBoardStatus,
} from './request-board-model'
import { toRequestBody, type RequestFormValue } from './request-form-model'

type SnapshotRecord = RequestsSnapshot & { id?: never }

const ACT_DONE: Record<RequestAct, string> = {
  approve: 'Заявка одобрена.',
  confirm: 'Операция проведена.',
  refuse: 'Заявка отклонена.',
  submit: 'Заявка подана.',
  cancel: 'Заявка отозвана.',
}

const ACT_FAILED: Record<RequestAct, string> = {
  approve: 'Не удалось одобрить заявку.',
  confirm: 'Не удалось провести операцию.',
  refuse: 'Не удалось отклонить заявку.',
  submit: 'Не удалось подать заявку.',
  cancel: 'Не удалось отозвать заявку.',
}

/**
 * `/p/finance/requests` — the approver board of spec 339 §C, layout D.
 *
 * COMPOSITION (the agent's call; the source is `fidelity: wireframe`, so it
 * fixes this and no look). ONE object dominates: the board. Four columns are
 * the four states an approver can act on, they get the full width, and
 * everything else recedes — the title block names whose money this is, the one
 * primary action sits at its right edge, and the two other views the surface
 * owes («Обязательства» EARS-527, «Мои заявки» EARS-502/509) are TABS beside
 * the board rather than panels competing with it. The columns are deliberately
 * NOT equal-weight boxes: «Ждут» is where a reader's decision lives and carries
 * the live cards, while «Проведены» and «Отклонены» are muted archives.
 *
 * DRAG INITIATES, NEVER DECIDES. `planRequestDrop` turns a drop into the ACT it
 * would open; the act itself happens in the details sheet, where the money, the
 * marking and the document are readable. An illegal drop moves nothing and says
 * so; a terminal card is not draggable in the first place. The server refuses
 * the same transitions regardless (EARS-524) — this is the affordance, not the
 * boundary.
 *
 * ONE READ, ONE MOMENT. The board, its reference tables, the reader's
 * permissions and the liability view arrive as ONE snapshot, so every part of
 * the screen shows the same instant of the ledger; each act re-reads it whole.
 */
export function RequestsBoardScreen() {
  const { query, result } = useCustom<SnapshotRecord, HttpError>({
    url: REQUESTS_ENDPOINT,
    method: 'get',
  })
  const { mutate, mutation } = useCustomMutation<
    Record<string, never>,
    HttpError,
    Record<string, unknown>
  >()

  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [pendingAct, setPendingAct] = React.useState<RequestAct | null>(null)
  const [formFor, setFormFor] = React.useState<'new' | number | null>(null)
  const [formFailure, setFormFailure] = React.useState<string | undefined>(undefined)

  const snapshot = (result?.data ?? null) as RequestsSnapshot | null
  const refetch = query.refetch

  const closeSheets = React.useCallback(() => {
    setSelectedId(null)
    setPendingAct(null)
    setFormFor(null)
  }, [])

  const runAct = React.useCallback(
    (request: RequestBoardItem, act: RequestAct, reason?: string) => {
      mutate(
        {
          url: `${REQUESTS_ENDPOINT}/${request.id}/actions`,
          method: 'post',
          values: reason === undefined ? { act } : { act, reason },
          successNotification: {
            type: 'success',
            message: ACT_DONE[act],
            description: `Заявка №${request.id}`,
          },
          errorNotification: (error: unknown) => ({
            type: 'error' as const,
            message: ACT_FAILED[act],
            description: errorMessage(error, `Заявка №${request.id}`),
          }),
        },
        {
          onSuccess: () => {
            closeSheets()
            void refetch()
          },
        },
      )
    },
    [closeSheets, mutate, refetch],
  )

  const fileRequest = React.useCallback(
    (value: RequestFormValue) => {
      if (snapshot === null) return
      setFormFailure(undefined)
      // Editing an existing request is the same contract at a different address
      // (EARS-524: an edit in `approved` bounces the item back to `submitted`,
      // which the API decides — the form does not pretend to).
      const editingId = typeof formFor === 'number' ? formFor : null
      mutate(
        {
          url: editingId === null ? REQUESTS_ENDPOINT : `${REQUESTS_ENDPOINT}/${editingId}`,
          method: editingId === null ? 'post' : 'patch',
          values: toRequestBody(value, snapshot.references) as unknown as Record<string, unknown>,
          successNotification: {
            type: 'success',
            message: editingId === null ? 'Заявка подана.' : 'Заявка сохранена.',
            description:
              editingId === null
                ? 'Она встала в колонку «Ждут».'
                : 'Изменения ушли в машину статусов.',
          },
          errorNotification: (error: unknown) => ({
            type: 'error' as const,
            message:
              editingId === null ? 'Не удалось подать заявку.' : 'Не удалось сохранить заявку.',
            description: errorMessage(error, 'Проверьте поля формы.'),
          }),
        },
        {
          onSuccess: () => {
            closeSheets()
            void refetch()
          },
          onError: (error: unknown) =>
            setFormFailure(errorMessage(error, 'Не удалось подать заявку.')),
        },
      )
    },
    [closeSheets, formFor, mutate, refetch, snapshot],
  )

  if (query.isLoading && snapshot === null) {
    return (
      <div aria-label="Загружаем заявки" className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-3 lg:grid-cols-4">
          {REQUEST_BOARD_COLUMNS.map((column) => (
            <Skeleton key={column.status} className="h-64 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (snapshot === null) {
    const refused = (query.error as HttpError | null)?.statusCode === 403
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>{refused ? 'Заявки недоступны' : 'Доска не открылась'}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{errorMessage(query.error, 'Не удалось прочитать доску заявок.')}</p>
          {refused ? null : (
            <Button variant="outline" onClick={() => void refetch()}>
              Попробовать снова
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  const { permissions, references, requests, liabilities } = snapshot
  const groups = groupRequestsByStatus(requests)
  const mine = ownRequests(requests)
  const selected = requests.find((request) => request.id === selectedId) ?? null
  const editing = typeof formFor === 'number' ? requests.find((r) => r.id === formFor) : undefined

  function onDrop(status: FinanceRequestBoardStatus) {
    return (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault()
      const id = Number(event.dataTransfer.getData('text/plain'))
      const request = requests.find((candidate) => candidate.id === id)
      if (request === undefined || !canDragRequest(request, permissions.canApprove)) return
      const plan = planRequestDrop(request.status, status)
      if (plan.type === 'refused') {
        toast.error('Перенос не выполнен.', { description: plan.message })
        return
      }
      setSelectedId(request.id)
      setPendingAct(plan.act)
    }
  }

  return (
    <ListView>
      <section aria-labelledby="requests-heading" className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              id="requests-heading"
              className="font-heading text-2xl font-semibold tracking-tight"
            >
              Заявки
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Расходы BBM от подачи до проводки. Перенос карточки открывает акт — сам по себе статус
              он не меняет.
            </p>
          </div>
          <Button
            onClick={() => {
              setFormFailure(undefined)
              setFormFor('new')
            }}
          >
            Новая заявка
          </Button>
        </div>

        <Tabs defaultValue="board" className="gap-6">
          <TabsList>
            <TabsTrigger value="board">Доска</TabsTrigger>
            <TabsTrigger value="liabilities">Обязательства</TabsTrigger>
            <TabsTrigger value="mine">Мои заявки</TabsTrigger>
          </TabsList>

          <TabsContent value="board">
            {requests.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <p className="font-heading text-base font-medium">Заявок пока нет</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Первая заявка появится здесь, как только кто-нибудь её подаст.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-4">
                {REQUEST_BOARD_COLUMNS.map((column) => {
                  const cards = groups[column.status]
                  const archived = column.status === 'posted' || column.status === 'refused'
                  return (
                    <section
                      key={column.status}
                      aria-label={column.title}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={onDrop(column.status)}
                      className={cn(
                        'flex min-h-40 flex-col gap-2 rounded-xl border p-3',
                        archived ? 'bg-muted/30' : 'bg-card',
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <h2
                          className={cn(
                            'font-heading text-sm font-semibold',
                            archived ? 'text-muted-foreground' : 'text-foreground',
                          )}
                        >
                          {column.title}
                        </h2>
                        <Badge variant="outline">{cards.length}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{column.hint}</p>
                      {cards.map((request) => (
                        <RequestCard
                          key={request.id}
                          request={request}
                          canApprove={permissions.canApprove}
                          precision={currencyPrecision(references.currencies, request.currency)}
                          onOpen={() => {
                            setPendingAct(null)
                            setSelectedId(request.id)
                          }}
                        />
                      ))}
                    </section>
                  )
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="liabilities">
            <LiabilityPanel liabilities={liabilities} references={references} />
          </TabsContent>

          <TabsContent value="mine">
            <section aria-label="Мои заявки" className="space-y-3">
              <div>
                <h2 className="font-heading text-lg font-semibold tracking-tight">Мои заявки</h2>
                <p className="text-sm text-muted-foreground">
                  Всё, что вы подали, — включая черновики и отозванное.
                </p>
              </div>
              {mine.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Вы ещё не подавали заявок.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Что</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>
                        <span className="sr-only">Действия</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mine.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell className="tabular-nums">
                          {formatDate(request.occurredOn)}
                        </TableCell>
                        <TableCell>{request.note ?? request.purpose?.name ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatRequestMoney(
                            request.amount,
                            request.currency,
                            currencyPrecision(references.currencies, request.currency),
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{REQUEST_STATUS_LABELS[request.status]}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Открыть заявку №${request.id}`}
                            onClick={() => {
                              setPendingAct(null)
                              setSelectedId(request.id)
                            }}
                          >
                            Открыть
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </section>

      {formFor !== null ? (
        <RequestFormSheet
          references={references}
          request={editing}
          pending={mutation.isPending}
          failure={formFailure}
          onSubmit={fileRequest}
          onClose={() => setFormFor(null)}
        />
      ) : null}

      {formFor === null && selected !== null ? (
        <RequestDetailsSheet
          key={`${selected.id}-${pendingAct ?? 'none'}`}
          request={selected}
          references={references}
          canApprove={permissions.canApprove}
          pending={mutation.isPending}
          pendingAct={pendingAct}
          onAct={(act, reason) => runAct(selected, act, reason)}
          onEdit={() => setFormFor(selected.id)}
          onClose={closeSheets}
        />
      ) : null}
    </ListView>
  )
}
