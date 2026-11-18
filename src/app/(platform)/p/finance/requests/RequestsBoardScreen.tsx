'use client'

import { useCustom, useCustomMutation, useInvalidate, type HttpError } from '@refinedev/core'
import React from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { ListView } from '@/ui/refine-ui/views/list-view'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import { cn } from '@/ui/utils'

import {
  DOCUMENTS_ENDPOINT,
  errorMessage,
  LIABILITIES_RESOURCE,
  REQUESTS_ENDPOINT,
  REQUESTS_RESOURCE,
} from './constants'
import { LiabilityPanel } from './LiabilityPanel'
import { RequestCard } from './RequestCard'
import { BulkMarkPaidSheet } from './BulkMarkPaidSheet'
import {
  RequestDetailsSheet,
  type ActReceipt,
  type RequestAct,
  type RequestActPayload,
  type SheetOpening,
} from './RequestDetailsSheet'
import { RequestFormSheet } from './RequestFormSheet'
import type { RequestBoardItem, RequestsSnapshot } from './request-board-contract'
import {
  BOARD_READ_QUERY_OPTIONS,
  canDragRequest,
  currencyPrecision,
  filedRequestNotification,
  groupRequestsByStatus,
  planRequestDrop,
  REQUEST_BOARD_COLUMNS,
  type FinanceRequestBoardStatus,
} from './request-board-model'
import { toRequestBody, type RequestFormValue } from './request-form-model'
import type { QueueAct } from './request-queue-model'
import {
  bulkResultMessage,
  type BulkBody,
  type BulkGroup,
  type BulkPreview,
} from './request-sheet-model'
import { RequestsQueue } from './RequestsQueue'
import { RequestsSkeleton } from './RequestsSkeleton'
import {
  canToggleRequestsView,
  REQUESTS_VIEW_STORAGE_KEY,
  requestsLoadingView,
  resolveRequestsView,
} from './request-table-model'

type SnapshotRecord = RequestsSnapshot & { id?: never }

/**
 * THE CHOSEN VIEW AS AN EXTERNAL STORE (decision 35).
 *
 * `localStorage` is exactly that — state that lives outside React, is absent on
 * the server, and can be changed by another tab. `useSyncExternalStore` is the
 * shape React has for it: no copy in component state, no effect to keep the
 * copy in step, and a declared server snapshot instead of a hydration guess.
 * The write notifies this tab (a `storage` event fires only in the OTHERS).
 */
const storedViewListeners = new Set<() => void>()

function readStoredView(): string | null {
  try {
    return window.localStorage.getItem(REQUESTS_VIEW_STORAGE_KEY)
  } catch {
    // A browser that refuses storage (private mode, blocked site data) gets the
    // default view, not a broken screen.
    return null
  }
}

/** The server has no browser storage, and says so rather than guessing. */
function serverStoredView(): string | null {
  return null
}

function writeStoredView(next: string): void {
  try {
    window.localStorage.setItem(REQUESTS_VIEW_STORAGE_KEY, next)
  } catch {
    // The choice still holds for this visit; only its memory is refused — and
    // the listeners below still fire, so the screen switches either way.
  }
  for (const listener of storedViewListeners) listener()
}

function subscribeStoredView(listener: () => void): () => void {
  storedViewListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    storedViewListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

const ACT_DONE: Record<RequestAct, string> = {
  approve: 'Заявка одобрена.',
  confirm: 'Операция проведена.',
  refuse: 'Заявка отклонена.',
  submit: 'Заявка подана.',
  cancel: 'Заявка отменена.',
  'mark-paid': 'Оплата отмечена.',
  'mark-reimbursed': 'Возврат отмечен.',
}

const ACT_FAILED: Record<RequestAct, string> = {
  approve: 'Не удалось одобрить заявку.',
  confirm: 'Не удалось провести операцию.',
  refuse: 'Не удалось отклонить заявку.',
  submit: 'Не удалось подать заявку.',
  cancel: 'Не удалось отменить заявку.',
  'mark-paid': 'Оплата не отмечена.',
  'mark-reimbursed': 'Возврат не отмечен.',
}

/** What a board drop opens in the sheet — the drag initiates, it never decides. */
function openingOfDrop(act: 'approve' | 'confirm' | 'refuse'): SheetOpening {
  if (act === 'refuse') return 'refuse'
  return act === 'confirm' ? 'pay' : null
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
  const { query } = useCustom<SnapshotRecord, HttpError>({
    url: REQUESTS_ENDPOINT,
    method: 'get',
    // A READ THAT FAILS IS REPORTED, NOT RETRIED IN SILENCE (#473 item 2).
    // Why these numbers and not react-query's default backoff:
    // `BOARD_READ_QUERY_OPTIONS` in `request-board-model.ts`.
    queryOptions: BOARD_READ_QUERY_OPTIONS,
  })
  const { mutate, mutation } = useCustomMutation<
    Record<string, never>,
    HttpError,
    Record<string, unknown>
  >()
  /**
   * The register is a RESOURCE since #388: the table's rows arrive through
   * `useTable`, which caches per page, per order and per scope. Re-reading the
   * chrome's snapshot therefore no longer refreshes the rows — the act has to
   * say that the list is stale, and Refine's own invalidation is how.
   */
  const invalidate = useInvalidate()
  const refreshRegister = React.useCallback(
    () =>
      // BOTH registers, because an act moves both: the request leaves the queue
      // and the debt it created is settled. «Обязательства» has its own list
      // cache, and its rows are refreshed today only because Radix `Tabs`
      // unmounts inactive content — an accident of the container, not a refresh
      // this screen ever stated (#388 round 7).
      Promise.all(
        [REQUESTS_RESOURCE, LIABILITIES_RESOURCE].map((resource) =>
          invalidate({ resource, invalidates: ['list'] }),
        ),
      ),
    [invalidate],
  )

  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [opening, setOpening] = React.useState<SheetOpening>(null)
  const [actFailure, setActFailure] = React.useState<string | undefined>(undefined)
  const [bulk, setBulk] = React.useState<{ group: BulkGroup; rows: RequestBoardItem[] } | null>(
    null,
  )
  const [bulkFailure, setBulkFailure] = React.useState<string | undefined>(undefined)
  const [formFor, setFormFor] = React.useState<'new' | number | null>(null)
  const [formFailure, setFormFailure] = React.useState<string | undefined>(undefined)
  const [uploading, setUploading] = React.useState(false)
  const [uploadFailure, setUploadFailure] = React.useState<string | undefined>(undefined)
  /**
   * WHICH COLUMN THE POINTER IS OVER, and nothing more. A native HTML5 drag
   * paints a ghost of the card and gives the TARGET no treatment at all, so a
   * drag that works is indistinguishable from one that does not — the owner
   * read exactly that as «drag does not work» (#388). This is feedback, never
   * a decision: the drop still only opens the act `planRequestDrop` names.
   */
  const [dragOver, setDragOver] = React.useState<FinanceRequestBoardStatus | null>(null)
  /**
   * WHICH VIEW THIS BROWSER LAST CHOSE (decision 35) — the raw stored string,
   * subscribed to rather than copied into state. The server has no
   * `localStorage`, so the server snapshot is `null` and the first painted
   * frame is the default table, which is what every reader without a stored
   * choice gets anyway; React then re-renders with the stored value after
   * hydration. Copying it in with `useState` + `useEffect` says the same thing
   * with a render nobody needs and a second source of truth to keep in step.
   */
  const storedView = React.useSyncExternalStore(
    subscribeStoredView,
    readStoredView,
    serverStoredView,
  )

  /**
   * READ THE QUERY, NOT `result`. `useCustom`'s `result.data` is
   * `queryResponse.data?.data || EMPTY_OBJECT` (@refinedev/core@5.0.12) — a
   * frozen, TRUTHY `{}` while the snapshot is loading and after it fails, so a
   * `?? null` on it can never be null and would make the skeleton and both
   * Alerts below dead code. `query.data` is the provider's own
   * `{ data: snapshot }` and stays `undefined` until the read actually
   * succeeds.
   */
  const snapshot = (query.data?.data ?? null) as RequestsSnapshot | null
  const refetch = query.refetch

  const closeSheets = React.useCallback(() => {
    setSelectedId(null)
    setOpening(null)
    setFormFor(null)
    setUploadFailure(undefined)
    setActFailure(undefined)
    setBulk(null)
    setBulkFailure(undefined)
  }, [])

  /**
   * Attaching the confirming document (EARS-506/511) — a multipart POST to the
   * document endpoint, through the SAME provider and therefore the same
   * notification channel as every act.
   *
   * POST-SUBMIT IS THE DECISION HERE: unlike an act, a successful upload does
   * NOT close the sheet. The board re-reads itself, the document appears in
   * the pane above the picker and a posted request loses its «без чека»
   * (EARS-545/546) on the screen the reader is looking at. It is also the
   * second step of a payment form that carried a receipt: the act posts, then
   * the receipt is attached to the posted request.
   */
  const attachDocument = React.useCallback(
    (request: RequestBoardItem, file: File, kind: string) => {
      setUploadFailure(undefined)
      setUploading(true)
      const body = new FormData()
      body.append('file', file)
      body.append('kind', kind)
      body.append('intakeItemId', String(request.id))
      mutate(
        {
          url: DOCUMENTS_ENDPOINT,
          method: 'post',
          values: body as unknown as Record<string, unknown>,
          successNotification: {
            type: 'success',
            message: 'Документ приложен.',
            description: `Заявка №${request.id}`,
          },
          errorNotification: (error: unknown) => ({
            type: 'error' as const,
            message: 'Не удалось приложить документ.',
            description: errorMessage(error, `Заявка №${request.id}`),
          }),
        },
        {
          onSuccess: () => {
            setUploading(false)
            void refetch()
            void refreshRegister()
          },
          onError: (error: unknown) => {
            setUploading(false)
            setUploadFailure(errorMessage(error, 'Не удалось приложить документ.'))
          },
        },
      )
    },
    [mutate, refetch, refreshRegister],
  )

  /**
   * An act from the sheet. Its refusal is kept where the reader is still
   * looking — the form that sent it — as well as in the toast (EARS-543/548
   * want the server's own words), and the board re-reads itself so a stale
   * snapshot is replaced by the request as it now is.
   *
   * A RECEIPT FOLLOWS THE ACT. The payment forms' optional receipt is uploaded
   * once the act has posted, linked to the now-posted request (EARS-545): a
   * refused act leaves no orphan file, and the act's token is the one the
   * owner saw.
   */
  const runAct = React.useCallback(
    (
      request: RequestBoardItem,
      act: RequestAct,
      payload?: RequestActPayload,
      receipt?: ActReceipt,
    ) => {
      setActFailure(undefined)
      mutate(
        {
          url: `${REQUESTS_ENDPOINT}/${request.id}/actions`,
          method: 'post',
          values: { act, ...(payload ?? {}) },
          successNotification: {
            type: 'success',
            message:
              act === 'mark-paid' && request.status === 'submitted'
                ? 'Заявка одобрена, оплата отмечена.'
                : ACT_DONE[act],
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
            if (receipt !== undefined) attachDocument(request, receipt.file, receipt.kind)
            void refetch()
            void refreshRegister()
          },
          onError: (error: unknown) => {
            setActFailure(errorMessage(error, ACT_FAILED[act]))
            void refetch()
          },
        },
      )
    },
    [attachDocument, closeSheets, mutate, refetch, refreshRegister],
  )

  /** The bulk act's PLAN — `preview: true` writes nothing, so it raises no toast. */
  const previewBulk = React.useCallback(
    (body: BulkBody) =>
      new Promise<BulkPreview>((resolve, reject) => {
        mutate(
          {
            url: `${REQUESTS_ENDPOINT}/bulk-mark-paid`,
            method: 'post',
            values: body as unknown as Record<string, unknown>,
            successNotification: false,
            errorNotification: false,
          },
          {
            onSuccess: (response) => resolve((response as unknown as { data: BulkPreview }).data),
            onError: (error: unknown) =>
              reject(new Error(errorMessage(error, 'Не удалось получить план отметки.'))),
          },
        )
      }),
    [mutate],
  )

  /** The confirmed batch (EARS-547): all or nothing; the toast counts what posted and what did not. */
  const confirmBulk = React.useCallback(
    (body: BulkBody) => {
      setBulkFailure(undefined)
      mutate(
        {
          url: `${REQUESTS_ENDPOINT}/bulk-mark-paid`,
          method: 'post',
          values: body as unknown as Record<string, unknown>,
          successNotification: (response: unknown) => ({
            type: 'success' as const,
            message: bulkResultMessage(
              (response as { data: { posted: unknown[]; excluded: unknown[] } }).data,
            ),
            description: 'Пакетная отметка оплаты',
          }),
          errorNotification: (error: unknown) => ({
            type: 'error' as const,
            message: 'Пакет не отмечен.',
            description: errorMessage(error, 'Ничего не проведено.'),
          }),
        },
        {
          onSuccess: () => {
            closeSheets()
            void refetch()
            void refreshRegister()
          },
          onError: (error: unknown) => {
            setBulkFailure(errorMessage(error, 'Пакет не отмечен — ничего не проведено.'))
            void refetch()
          },
        },
      )
    },
    [closeSheets, mutate, refetch, refreshRegister],
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
          values: toRequestBody(value, snapshot.references, {
            canNameCompanyAccount: snapshot.permissions.canEnter || snapshot.permissions.canApprove,
          }) as unknown as Record<string, unknown>,
          successNotification:
            editingId === null
              ? // The status the endpoint really kept, read back (EARS-509/526).
                (data: unknown) => ({ type: 'success' as const, ...filedRequestNotification(data) })
              : {
                  type: 'success',
                  message: 'Заявка сохранена.',
                  description: 'Изменения ушли в машину статусов.',
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
            void refreshRegister()
          },
          onError: (error: unknown) =>
            setFormFailure(errorMessage(error, 'Не удалось подать заявку.')),
        },
      )
    },
    [closeSheets, formFor, mutate, refetch, refreshRegister, snapshot],
  )

  if (query.isLoading && snapshot === null) {
    // THE SKELETON PROMISES THE VIEW THAT IS COMING (#388 defect C). The role
    // has not arrived yet, so the stored choice is taken at its word here;
    // `requestsLoadingView` says why that is the honest reading while loading.
    return <RequestsSkeleton view={requestsLoadingView(storedView)} />
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

  const { permissions, references, requests, liabilities, fx } = snapshot
  const groups = groupRequestsByStatus(requests)
  const view = resolveRequestsView(storedView, permissions.canApprove)
  const selected = requests.find((request) => request.id === selectedId) ?? null
  const editing = typeof formFor === 'number' ? requests.find((r) => r.id === formFor) : undefined

  /** The chosen view, remembered for THIS browser and nowhere else. */
  function chooseView(next: string) {
    writeStoredView(next)
  }

  /**
   * THE QUEUE ROW'S PRIMARY ACT (EARS-541). «Одобрить» is complete in itself —
   * approval never posts since #549 (EARS-510 revised) — and runs from the row.
   * «Отметить оплату» / «Отметить возврат» need the money facts and, since
   * #549, the EARS-548 snapshot token, which only the LIST row carries: they
   * open the details sheet ON THAT ROW (the very object the list answered
   * with), whose pay-mode form is #551's.
   */
  function runQueueAct(request: RequestBoardItem, act: QueueAct) {
    if (act === 'approve') {
      runAct(request, 'approve')
      return
    }
    setFormFor(null)
    setActFailure(undefined)
    setOpening('pay')
    setSelectedId(request.id)
  }

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
      setActFailure(undefined)
      setSelectedId(request.id)
      setOpening(openingOfDrop(plan.act))
    }
  }

  /** The approve role's view toggle (decision 35) — the board stays as it is. */
  const viewToggle = canToggleRequestsView(permissions.canApprove) ? (
    <Tabs value={view} onValueChange={chooseView}>
      <TabsList aria-label="Вид">
        <TabsTrigger value="table">Очередь</TabsTrigger>
        <TabsTrigger value="board">Доска</TabsTrigger>
      </TabsList>
    </Tabs>
  ) : null

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
              {/* The subtitle says what THIS reader is looking at. «Перенос
                  карточки» is the board's sentence, and a member who has no
                  board was being told how to use one (live pass, 2026-09-14). */}
              {view === 'board'
                ? 'Расходы BBM от подачи до проводки. Перенос карточки открывает акт — сам по себе статус он не меняет.'
                : 'Что ждёт вашего решения, что пора оплатить и кому вернуть деньги.'}
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

        <Tabs defaultValue="requests" className="gap-6">
          <TabsList>
            <TabsTrigger value="requests">Заявки</TabsTrigger>
            <TabsTrigger value="liabilities">Обязательства</TabsTrigger>
          </TabsList>

          <TabsContent value="requests">
            <section aria-label="Список заявок" className="space-y-4">
              {view === 'board' ? (
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <p className="hidden min-w-0 truncate text-sm text-muted-foreground sm:block">
                    Доска: четыре состояния машины статусов. Перенос карточки открывает акт.
                  </p>
                  {viewToggle}
                </div>
              ) : null}

              {view === 'board' ? (
                requests.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-10 text-center">
                    <p className="font-heading text-base font-medium">Заявок пока нет</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Первая заявка появится здесь, как только кто-нибудь её подаст.
                    </p>
                  </div>
                ) : (
                  // `dragend` fires on the card and BUBBLES, so one handler here
                  // clears the treatment however the drag ended — dropped on a
                  // column, dropped outside one, or abandoned with Escape.
                  <div className="grid gap-3 lg:grid-cols-4" onDragEnd={() => setDragOver(null)}>
                    {REQUEST_BOARD_COLUMNS.map((column) => {
                      const cards = groups[column.status]
                      const archived = column.status === 'posted' || column.status === 'refused'
                      return (
                        <section
                          key={column.status}
                          aria-label={column.title}
                          // `preventDefault` on EVERY dragover is what makes the
                          // column a drop target at all — without it the browser
                          // never fires `drop`.
                          onDragOver={(event) => {
                            event.preventDefault()
                            if (dragOver !== column.status) setDragOver(column.status)
                          }}
                          onDragLeave={(event) => {
                            // `dragleave` also fires when the pointer crosses onto a
                            // CHILD of the column; only a leave that really lands
                            // outside it clears the treatment.
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                              setDragOver((current) => (current === column.status ? null : current))
                            }
                          }}
                          onDrop={(event) => {
                            setDragOver(null)
                            onDrop(column.status)(event)
                          }}
                          data-drag-over={dragOver === column.status ? 'true' : undefined}
                          className={cn(
                            'flex min-h-40 flex-col gap-2 rounded-xl border p-3 transition-colors',
                            archived ? 'bg-muted/30' : 'bg-card',
                            dragOver === column.status ? 'border-ring bg-accent/40' : undefined,
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
                                setOpening(null)
                                setActFailure(undefined)
                                setSelectedId(request.id)
                              }}
                            />
                          ))}
                        </section>
                      )
                    })}
                  </div>
                )
              ) : (
                <RequestsQueue
                  requests={requests}
                  references={references}
                  canApprove={permissions.canApprove}
                  fx={fx}
                  toolbarEnd={viewToggle}
                  onOpen={(request) => {
                    setOpening(null)
                    setActFailure(undefined)
                    setSelectedId(request.id)
                  }}
                  onAct={runQueueAct}
                  onBulk={(group, rows) => {
                    setBulkFailure(undefined)
                    setBulk({ group, rows })
                  }}
                />
              )}
            </section>
          </TabsContent>

          <TabsContent value="liabilities">
            <LiabilityPanel liabilities={liabilities} references={references} />
          </TabsContent>
        </Tabs>
      </section>

      {formFor !== null ? (
        <RequestFormSheet
          references={references}
          request={editing}
          canNameCompanyAccount={permissions.canEnter || permissions.canApprove}
          pending={mutation.isPending}
          failure={formFailure}
          onSubmit={fileRequest}
          onClose={() => setFormFor(null)}
        />
      ) : null}

      {formFor === null && selected !== null ? (
        <RequestDetailsSheet
          // The document count is part of the identity: when an upload lands,
          // the re-read brings a request that carries it, and re-keying resets
          // the attach picker instead of leaving the just-sent file in it.
          key={`${selected.id}-${opening ?? 'none'}-${selected.documents.length}`}
          request={selected}
          references={references}
          canApprove={permissions.canApprove}
          canEnter={permissions.canEnter}
          today={fx.today}
          pending={mutation.isPending}
          opening={opening}
          actFailure={actFailure}
          uploading={uploading}
          uploadFailure={uploadFailure}
          onAct={(act, payload, receipt) => runAct(selected, act, payload, receipt)}
          onAttach={(file, kind) => attachDocument(selected, file, kind)}
          onEdit={() => setFormFor(selected.id)}
          onClose={closeSheets}
        />
      ) : null}

      {bulk === null ? null : (
        <BulkMarkPaidSheet
          group={bulk.group}
          rows={bulk.rows}
          references={references}
          pending={mutation.isPending}
          failure={bulkFailure}
          onPreview={previewBulk}
          onConfirm={confirmBulk}
          onClose={closeSheets}
        />
      )}
    </ListView>
  )
}
