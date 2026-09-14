'use client'

import { useCustom, useCustomMutation, type HttpError } from '@refinedev/core'
import React from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { ListView } from '@/ui/refine-ui/views/list-view'
import { Skeleton } from '@/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import { cn } from '@/ui/utils'

import { DOCUMENTS_ENDPOINT, errorMessage, REQUESTS_ENDPOINT } from './constants'
import { LiabilityPanel } from './LiabilityPanel'
import { RequestCard } from './RequestCard'
import { RequestDetailsSheet, type RequestAct, type RequestActPayload } from './RequestDetailsSheet'
import { RequestFormSheet } from './RequestFormSheet'
import type { RequestBoardItem, RequestsSnapshot } from './request-board-contract'
import {
  canDragRequest,
  currencyPrecision,
  filedRequestNotification,
  groupRequestsByStatus,
  planRequestDrop,
  postingActNeedsMoneyFacts,
  REQUEST_BOARD_COLUMNS,
  type FinanceRequestBoardAct,
  type FinanceRequestBoardStatus,
} from './request-board-model'
import { toRequestBody, type RequestFormValue } from './request-form-model'
import { RequestsTable } from './RequestsTable'
import {
  canToggleRequestsView,
  DEFAULT_REQUEST_TABLE_SCOPE,
  requestTableRows,
  REQUESTS_VIEW_STORAGE_KEY,
  REQUEST_TABLE_SCOPES,
  resolveRequestsView,
  type RequestTableScope,
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
  const { query } = useCustom<SnapshotRecord, HttpError>({
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
  const [scope, setScope] = React.useState<RequestTableScope>(DEFAULT_REQUEST_TABLE_SCOPE)
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
    setPendingAct(null)
    setFormFor(null)
    setUploadFailure(undefined)
  }, [])

  /**
   * Attaching the confirming document (EARS-506/511) — a multipart POST to the
   * document endpoint, through the SAME provider and therefore the same
   * notification channel as every act.
   *
   * POST-SUBMIT IS THE DECISION HERE: unlike an act, a successful upload does
   * NOT close the sheet. The whole point of attaching is what it unlocks — the
   * board re-reads itself, the document appears in the pane above the picker,
   * and «Провести» becomes available one click away in the same footer. Closing
   * would send the approver back to the board to find the card again.
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
          },
          onError: (error: unknown) => {
            setUploading(false)
            setUploadFailure(errorMessage(error, 'Не удалось приложить документ.'))
          },
        },
      )
    },
    [mutate, refetch],
  )

  const runAct = React.useCallback(
    (request: RequestBoardItem, act: RequestAct, payload?: RequestActPayload) => {
      mutate(
        {
          url: `${REQUESTS_ENDPOINT}/${request.id}/actions`,
          method: 'post',
          // The act's own fields travel with it: EARS-512's reason, and the
          // EARS-533 money facts the posting act enters. An act that names none
          // sends none — an absent fact is not a null the server has to read.
          values: { act, ...(payload ?? {}) },
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
  const view = resolveRequestsView(storedView, permissions.canApprove)
  const rows = requestTableRows(requests, scope)
  const selected = requests.find((request) => request.id === selectedId) ?? null
  const editing = typeof formFor === 'number' ? requests.find((r) => r.id === formFor) : undefined

  /** The chosen view, remembered for THIS browser and nowhere else. */
  function chooseView(next: string) {
    writeStoredView(next)
  }

  /**
   * A ROW ACT INITIATES THE SAME ACT THE BOARD'S DRAG DOES (decision 35). An
   * approval that only AUTHORISES is complete in itself and runs from the row;
   * a refusal needs its mandatory reason (EARS-512) and an approval that would
   * POST needs the money facts (EARS-533), and both of those are asked in the
   * details sheet — so the row opens the sheet ARMED with the act instead of
   * growing a second copy of those dialogs.
   */
  function runRowAct(request: RequestBoardItem, act: FinanceRequestBoardAct) {
    if (act === 'refuse' || postingActNeedsMoneyFacts(request, act)) {
      setFormFor(null)
      setSelectedId(request.id)
      setPendingAct(act)
      return
    }
    runAct(request, act)
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

        <Tabs defaultValue="requests" className="gap-6">
          <TabsList>
            <TabsTrigger value="requests">Заявки</TabsTrigger>
            <TabsTrigger value="liabilities">Обязательства</TabsTrigger>
          </TabsList>

          <TabsContent value="requests">
            <section aria-label="Список заявок" className="space-y-4">
              {/* THE TOOLBAR IS THE TWO QUESTIONS, and only the ones this
                  reader may answer: whose requests (everyone), and in which
                  view (the approve role only — decision 35). The scope filter
                  belongs to the table: the board is a queue of decisions, and
                  «мои» over a decision queue is a filter on somebody else's
                  work. */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {view === 'table' ? (
                  <Tabs value={scope} onValueChange={(next) => setScope(next as RequestTableScope)}>
                    <TabsList aria-label="Чьи заявки">
                      {REQUEST_TABLE_SCOPES.map((option) => (
                        <TabsTrigger key={option.value} value={option.value}>
                          {option.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Доска: четыре состояния машины статусов. Перенос карточки открывает акт.
                  </p>
                )}
                {canToggleRequestsView(permissions.canApprove) ? (
                  <Tabs value={view} onValueChange={chooseView}>
                    <TabsList aria-label="Вид">
                      <TabsTrigger value="table">Таблица</TabsTrigger>
                      <TabsTrigger value="board">Доска</TabsTrigger>
                    </TabsList>
                  </Tabs>
                ) : null}
              </div>

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
                                setPendingAct(null)
                                setSelectedId(request.id)
                              }}
                            />
                          ))}
                        </section>
                      )
                    })}
                  </div>
                )
              ) : rows.length === 0 ? (
                <div className="rounded-lg border border-dashed p-10 text-center">
                  <p className="font-heading text-base font-medium">
                    {scope === 'mine' ? 'Вы ещё не подавали заявок' : 'Заявок пока нет'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {scope === 'mine'
                      ? 'Всё, что вы подадите, появится здесь — включая черновики и отозванное.'
                      : 'Первая заявка появится здесь, как только кто-нибудь её подаст.'}
                  </p>
                </div>
              ) : (
                <RequestsTable
                  rows={rows}
                  references={references}
                  canApprove={permissions.canApprove}
                  onOpen={(request) => {
                    setPendingAct(null)
                    setSelectedId(request.id)
                  }}
                  onAct={runRowAct}
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
          key={`${selected.id}-${pendingAct ?? 'none'}-${selected.documents.length}`}
          request={selected}
          references={references}
          canApprove={permissions.canApprove}
          canEnter={permissions.canEnter}
          pending={mutation.isPending}
          pendingAct={pendingAct}
          uploading={uploading}
          uploadFailure={uploadFailure}
          onAct={(act, payload) => runAct(selected, act, payload)}
          onAttach={(file, kind) => attachDocument(selected, file, kind)}
          onEdit={() => setFormFor(selected.id)}
          onClose={closeSheets}
        />
      ) : null}
    </ListView>
  )
}
