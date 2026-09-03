'use client'

import { XIcon } from 'lucide-react'
import React from 'react'

import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Label } from '@/ui/label'
import { Separator } from '@/ui/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/ui/sheet'
import { Textarea } from '@/ui/textarea'

import {
  documentHref,
  DOCUMENT_KIND_LABELS,
  formatDate,
  isInlineReadable,
  REQUEST_STATUS_LABELS,
} from './constants'
import type { RequestBoardItem, RequestBoardReferences } from './request-board-contract'
import { currencyPrecision, formatRequestMoney } from './request-board-model'
import type { FinanceRequestBoardAct } from './request-board-model'

export type RequestAct = FinanceRequestBoardAct | 'submit' | 'cancel'

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="truncate text-sm text-foreground">{value ?? '—'}</p>
    </div>
  )
}

/**
 * The details sheet — the RIGHT HALF of the picked layout D, and the place
 * where every act happens.
 *
 * THE ONE RULE OF THIS SURFACE (`design-source/finance/RequestBoard.html`): a
 * drag INITIATES an act and changes nothing by itself. That is why no card
 * carries a control and this sheet carries them all: the reader sees the money,
 * the marking and the document that justify the decision on the same screen as
 * the button that makes it.
 *
 * STATES THE WIREFRAME DOES NOT DRAW, decided here (owner ruling 2026-09-02):
 * an `approved` request WITHOUT a document offers no «Провести» at all and says
 * why (EARS-506/511) rather than offering a control the server would refuse; a
 * refusal is a modal with a mandatory reason (EARS-512), because a reason typed
 * into the same pane as the approve button is a reason typed by accident; a
 * `posted` request shows its ledger operation instead of controls, since the
 * ledger is immutable.
 */
export function RequestDetailsSheet({
  request,
  references,
  canApprove,
  pending,
  pendingAct,
  onAct,
  onEdit,
  onClose,
}: {
  request: RequestBoardItem | null
  references: RequestBoardReferences
  canApprove: boolean
  pending: boolean
  pendingAct: RequestAct | null
  onAct: (act: RequestAct, reason?: string) => void
  onEdit: () => void
  onClose: () => void
}) {
  // Initialised, not synchronised: the screen re-keys this component on
  // `${request.id}-${pendingAct}`, so a drag onto «Отклонены» opens the reason
  // dialog by MOUNTING with it open. An effect that pushed `pendingAct` into
  // state would render the sheet once without it and then correct itself — a
  // flash, and `react-hooks/set-state-in-effect`.
  const [refusing, setRefusing] = React.useState(pendingAct === 'refuse')
  const [reason, setReason] = React.useState('')
  const [reasonError, setReasonError] = React.useState<string | null>(null)

  if (request === null) return null

  const precision = currencyPrecision(references.currencies, request.currency)
  const hasDocument = request.documents.length > 0
  const canConfirm = canApprove && request.status === 'approved' && hasDocument
  const canApproveNow = canApprove && request.status === 'submitted'
  const canRefuse = canApprove && (request.status === 'submitted' || request.status === 'approved')
  const canCancel = request.own && request.status === 'submitted'
  const canSubmit = request.own && request.status === 'draft'
  const canEdit = request.own && (request.status === 'draft' || request.status === 'submitted')

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        data-bbm-ui
        side="right"
        showCloseButton={false}
        className="w-full gap-0 overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader className="gap-2 pr-12">
          <SheetTitle className="font-heading text-xl font-semibold tracking-tight tabular-nums">
            {formatRequestMoney(request.amount, request.currency, precision)}
            {request.note ? ` — ${request.note}` : ''}
          </SheetTitle>
          <SheetDescription>
            {[
              request.createdByName,
              `подана ${formatDate(request.occurredOn)}`,
              REQUEST_STATUS_LABELS[request.status],
            ]
              .filter(Boolean)
              .join(' · ')}
          </SheetDescription>
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3">
              <XIcon />
              <span className="sr-only">Закрыть</span>
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Контрагент" value={request.counterparty?.name ?? '—'} />
            <Field
              label="Счёт списания"
              value={
                request.personalFunds ? 'Свои средства участника' : (request.account?.name ?? '—')
              }
            />
            <Field label="Дата движения денег" value={formatDate(request.occurredOn)} />
            <Field
              label="Назначение"
              value={request.purpose?.name ?? request.proposal?.text ?? '—'}
            />
            <Field label="Проект" value={request.project.name} />
            <Field label="Продукт" value={request.product?.name ?? '—'} />
            {request.paidAmount !== null && request.paidCurrency !== null ? (
              <Field
                label="Списано со счёта"
                value={formatRequestMoney(
                  request.paidAmount,
                  request.paidCurrency,
                  currencyPrecision(references.currencies, request.paidCurrency),
                )}
              />
            ) : null}
            {request.purpose === null && request.proposal ? (
              <Field
                label="Предложение назначения"
                value={<Badge variant="destructive">ждёт админа</Badge>}
              />
            ) : null}
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              Документ — читается прямо тут
            </p>
            {hasDocument ? (
              request.documents.map((document) => (
                <div key={document.id} className="space-y-1.5">
                  <p className="text-sm text-foreground">
                    {DOCUMENT_KIND_LABELS[document.kind] ?? 'Документ'} · {document.filename}
                  </p>
                  {isInlineReadable(document.mime) ? (
                    <object
                      data={documentHref(document.id, true)}
                      type={document.mime}
                      title={document.filename}
                      className="h-64 w-full rounded-md border bg-muted/30"
                    >
                      <a
                        href={documentHref(document.id, false)}
                        className="text-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        Скачать {document.filename}
                      </a>
                    </object>
                  ) : (
                    <a
                      href={documentHref(document.id, false)}
                      className="inline-block text-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      Скачать {document.filename}
                    </a>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Документ не приложен.</p>
            )}
          </div>

          {request.status === 'refused' && request.refusalReason ? (
            <Alert variant="destructive" role="status">
              <AlertDescription>
                Отклонена{request.decidedByName ? ` — ${request.decidedByName}` : ''}: «
                {request.refusalReason}». Проводки нет, документы остаются.
              </AlertDescription>
            </Alert>
          ) : null}

          {request.status === 'posted' && request.operation ? (
            <div className="space-y-1 rounded-lg border p-3">
              <p className="text-sm font-medium">
                Операция №{request.operation.id} · {formatDate(request.operation.occurredOn)}
              </p>
              {request.operation.postings.map((posting, index) => (
                <p key={index} className="text-sm text-muted-foreground">
                  {posting.accountName} ·{' '}
                  {formatRequestMoney(
                    posting.amount,
                    posting.currency,
                    currencyPrecision(references.currencies, posting.currency),
                  )}
                </p>
              ))}
            </div>
          ) : null}

          {canApprove && request.status === 'approved' && !hasDocument ? (
            <Alert role="status">
              <AlertDescription>
                Без подтверждающего документа карточка отсюда не уезжает: одобрение уже авторизовало
                трату, проводка появится одним актом на приложенном документе.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <SheetFooter className="flex-row flex-wrap items-center gap-2">
          {canApproveNow ? (
            <Button disabled={pending} onClick={() => onAct('approve')}>
              Одобрить
            </Button>
          ) : null}
          {canConfirm ? (
            <Button disabled={pending} onClick={() => onAct('confirm')}>
              Провести
            </Button>
          ) : null}
          {canRefuse ? (
            <Button variant="destructive" disabled={pending} onClick={() => setRefusing(true)}>
              Отклонить…
            </Button>
          ) : null}
          {canSubmit ? (
            <Button disabled={pending} onClick={() => onAct('submit')}>
              Подать
            </Button>
          ) : null}
          {canCancel ? (
            <Button variant="outline" disabled={pending} onClick={() => onAct('cancel')}>
              Отозвать
            </Button>
          ) : null}
          {canEdit ? (
            <Button variant="outline" disabled={pending} onClick={onEdit}>
              Редактировать
            </Button>
          ) : null}
        </SheetFooter>

        <Dialog open={refusing} onOpenChange={setRefusing}>
          <DialogContent data-bbm-ui>
            <DialogHeader>
              <DialogTitle>Отклонить заявку</DialogTitle>
              <DialogDescription>
                Причина обязательна: она остаётся у заявки и её видит подавший.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="refusal-reason">Причина отказа</Label>
              <Textarea
                id="refusal-reason"
                value={reason}
                aria-invalid={reasonError !== null}
                onChange={(event) => {
                  setReason(event.target.value)
                  if (reasonError !== null) setReasonError(null)
                }}
              />
              {reasonError !== null ? (
                <p className="text-sm text-destructive" role="alert">
                  {reasonError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRefusing(false)}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  if (reason.trim() === '') {
                    setReasonError('Укажите причину отказа.')
                    return
                  }
                  onAct('refuse', reason.trim())
                }}
              >
                Отклонить заявку
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  )
}
