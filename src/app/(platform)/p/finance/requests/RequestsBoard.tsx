'use client'

import { FileText, GripVertical, Paperclip, Plus, RefreshCw } from 'lucide-react'
import React from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { Checkbox } from '@/ui/checkbox'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/ui/sheet'
import { Skeleton } from '@/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import { Textarea } from '@/ui/textarea'

import type {
  CreateRequestBody,
  RequestBoardItem,
  RequestBoardReferences,
  RequestsSnapshot,
} from './request-board-contract'
import {
  FINANCE_REQUEST_BOARD_STATUSES,
  formatRequestMoney,
  planRequestDrop,
  type FinanceRequestBoardAct,
  type FinanceRequestBoardStatus,
} from './request-board-model'

export type { RequestsSnapshot } from './request-board-contract'

const STATUS_LABELS: Record<FinanceRequestBoardStatus, string> = {
  submitted: 'Ждут',
  approved: 'Одобрены — ждут документа',
  posted: 'Проведены',
  refused: 'Отклонены',
}

const STATUS_BADGES: Record<FinanceRequestBoardStatus, string> = {
  submitted: 'ждёт решения',
  approved: 'одобрена, не проведена',
  posted: 'проведена',
  refused: 'отклонена',
}

const DOCUMENT_KIND_OPTIONS = [
  ['ru_invoice', 'Счёт РФ'],
  ['fiscal_receipt', 'Кассовый чек'],
  ['foreign_invoice', 'Иностранный инвойс'],
  ['payment_order', 'Платёжное поручение'],
  ['bank_screenshot', 'Скриншот банка'],
  ['bank_statement', 'Банковская выписка'],
  ['other', 'Другое'],
] as const

type RequestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type PendingUploadRecovery = {
  href: string
  file: File
  requestId: number
  submitAfterUpload: boolean
}

export type PendingProposalRecovery = {
  href: string
  purposeProposal: string
  requestId: number
}

export type RequestCreationOutcome =
  | { status: 'complete'; requestId: number; submitted: boolean; message: string }
  | {
      status: 'saved-draft'
      requestId: number
      stage: 'upload'
      message: string
      recovery: PendingUploadRecovery | null
    }
  | {
      status: 'saved-draft'
      requestId: number
      stage: 'proposal'
      message: string
      recovery: PendingProposalRecovery
    }
  | {
      status: 'saved-draft'
      requestId: number
      stage: 'submit'
      message: string
      recovery: null
    }

function apiMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

async function responseMessage(response: Response): Promise<string> {
  const text = await response.text()
  return text || `Запрос завершился с кодом ${response.status}.`
}

async function uploadRequestDocument(
  requestId: number,
  file: File,
  kind: string,
  fetcher: RequestFetch,
): Promise<{ recovery: PendingUploadRecovery | null; message: string | null }> {
  const form = new FormData()
  form.set('file', file)
  form.set('kind', kind)
  form.set('intakeItemId', String(requestId))
  const response = await fetcher('/p/finance/api/documents', { method: 'POST', body: form })
  if (response.ok) return { recovery: null, message: null }

  if (response.status === 503) {
    const pending = (await response.json().catch(() => null)) as {
      recovery?: { href?: unknown }
    } | null
    if (typeof pending?.recovery?.href === 'string') {
      return {
        recovery: {
          href: pending.recovery.href,
          file,
          requestId,
          submitAfterUpload: true,
        },
        message: 'Хранилище не завершило загрузку; те же байты можно безопасно отправить повторно.',
      }
    }
  }
  return { recovery: null, message: await responseMessage(response) }
}

export async function resumePendingUpload(
  recovery: PendingUploadRecovery,
  fetcher: RequestFetch = fetch,
): Promise<void> {
  const response = await fetcher(recovery.href, {
    method: 'PUT',
    headers: { 'content-type': recovery.file.type },
    body: recovery.file,
  })
  if (!response.ok) throw new Error(await responseMessage(response))
}

export async function resumePurposeProposal(
  recovery: PendingProposalRecovery,
  fetcher: RequestFetch = fetch,
): Promise<void> {
  const response = await fetcher(recovery.href, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ purposeProposal: recovery.purposeProposal }),
  })
  if (!response.ok) throw new Error(await responseMessage(response))
}

export async function runRequestCreation(
  body: CreateRequestBody,
  file: File | null,
  kind = 'other',
  fetcher: RequestFetch = fetch,
): Promise<RequestCreationOutcome> {
  const response = await fetcher('/p/finance/api/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const responseBody = await response.text()
    const saved = (() => {
      try {
        return JSON.parse(responseBody) as {
          status?: unknown
          request?: { id?: unknown }
          message?: unknown
          recovery?: { href?: unknown; purposeProposal?: unknown }
        }
      } catch {
        return null
      }
    })()
    if (
      response.status === 503 &&
      saved?.status === 'saved-draft' &&
      typeof saved.request?.id === 'number' &&
      typeof saved.message === 'string' &&
      typeof saved.recovery?.href === 'string' &&
      typeof saved.recovery.purposeProposal === 'string'
    ) {
      return {
        status: 'saved-draft',
        requestId: saved.request.id,
        stage: 'proposal',
        message: `Черновик №${saved.request.id} сохранён. ${saved.message}`,
        recovery: {
          href: saved.recovery.href,
          purposeProposal: saved.recovery.purposeProposal,
          requestId: saved.request.id,
        },
      }
    }
    throw new Error(responseBody || `Запрос завершился с кодом ${response.status}.`)
  }
  const created = (await response.json()) as {
    request: { id: number }
    proposal: { id: number } | null
  }
  const requestId = created.request.id

  if (file !== null) {
    const upload = await uploadRequestDocument(requestId, file, kind, fetcher)
    if (upload.message !== null) {
      return {
        status: 'saved-draft',
        requestId,
        stage: 'upload',
        message: `Черновик №${requestId} сохранён. ${upload.message}`,
        recovery:
          upload.recovery === null
            ? null
            : { ...upload.recovery, submitAfterUpload: created.proposal === null },
      }
    }
  }

  if (created.proposal !== null) {
    return {
      status: 'complete',
      requestId,
      submitted: false,
      message: 'Черновик создан и ждёт решения по предложению назначения.',
    }
  }

  const submitted = await fetcher(`/p/finance/api/requests/${requestId}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ act: 'submit' }),
  })
  if (!submitted.ok) {
    return {
      status: 'saved-draft',
      requestId,
      stage: 'submit',
      message: `Черновик №${requestId} сохранён, но не отправлен: ${await responseMessage(submitted)}`,
      recovery: null,
    }
  }
  return {
    status: 'complete',
    requestId,
    submitted: true,
    message: 'Заявка создана и отправлена на одобрение.',
  }
}

async function fetchRequestsSnapshot(): Promise<RequestsSnapshot> {
  const response = await fetch('/p/finance/api/requests', { cache: 'no-store' })
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('Нет доступа к заявкам финансового контура.')
    }
    throw new Error(await responseMessage(response))
  }
  return (await response.json()) as RequestsSnapshot
}

function precisionFor(snapshot: RequestsSnapshot, currency: string): number {
  return snapshot.references.currencies.find((item) => item.code === currency)?.precision ?? 2
}

function requestTitle(item: RequestBoardItem): string {
  return item.purpose?.name ?? item.proposal?.text ?? 'Назначение ожидает решения'
}

function BoardCard({
  item,
  snapshot,
  canDrag,
  onOpen,
  onDrag,
}: {
  item: RequestBoardItem
  snapshot: RequestsSnapshot
  canDrag: boolean
  onOpen: () => void
  onDrag: () => void
}) {
  return (
    <button
      type="button"
      draggable={canDrag}
      onDragStart={onDrag}
      onClick={onOpen}
      aria-label={`${requestTitle(item)}, заявка №${item.id}`}
      className="group w-full rounded-lg border bg-card p-3 text-left text-card-foreground shadow-xs transition hover:border-foreground/25 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-heading text-lg font-semibold tabular-nums">
          {formatRequestMoney(item.amount, item.currency, precisionFor(snapshot, item.currency))}
        </span>
        {canDrag ? (
          <GripVertical className="mt-0.5 size-4 text-muted-foreground opacity-60 group-hover:opacity-100" />
        ) : null}
      </div>
      <p className="mt-1 font-medium">{requestTitle(item)}</p>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <p>{item.counterparty?.name ?? 'Контрагент не выбран'}</p>
        <p>
          {item.project.name}
          {item.product ? ` · ${item.product.name}` : ''}
        </p>
        <p>{item.account?.name ?? (item.personalFunds ? 'Свои средства' : 'Счёт не выбран')}</p>
        <p>Автор: {item.createdByName ?? `Участник #${item.createdBy ?? '—'}`}</p>
        {item.decidedByName ? <p>Решение: {item.decidedByName}</p> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="secondary">{STATUS_BADGES[item.status as FinanceRequestBoardStatus]}</Badge>
        {item.documents.length > 0 ? (
          <Badge variant="outline">
            <Paperclip data-icon="inline-start" /> {item.documents.length}
          </Badge>
        ) : item.status === 'approved' ? (
          <Badge variant="outline">нет документа</Badge>
        ) : null}
        {item.alreadyPaid ? <Badge variant="outline">уже потрачено</Badge> : null}
        {item.personalFunds ? <Badge variant="outline">свои деньги</Badge> : null}
      </div>
    </button>
  )
}

function RequestBoardLoading() {
  return (
    <section aria-label="Загружаем заявки" className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {FINANCE_REQUEST_BOARD_STATUSES.map((status) => (
          <Card key={status}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-28 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

function Classification({ item }: { item: RequestBoardItem }) {
  const rows = [
    ['Назначение', item.purpose?.name ?? 'Ожидает решения'],
    ['Статья', item.purpose?.categoryName ?? 'Не назначена'],
    ['Проект', item.project.name],
    ['Продукт', item.product?.name ?? 'Без продукта'],
    ['Счёт оплаты', item.account?.name ?? (item.personalFunds ? 'Свои средства' : 'Не выбран')],
    ['Контрагент', item.counterparty?.name ?? 'Не выбран'],
    ['Дата движения денег', item.occurredOn],
  ] as const
  return (
    <dl className="grid gap-x-4 gap-y-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 break-words text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RequestDetails({
  item,
  snapshot,
  open,
  promptedAct,
  pending,
  failure,
  onOpenChange,
  onAct,
  onEdit,
  onAttach,
}: {
  item: RequestBoardItem | null
  snapshot: RequestsSnapshot
  open: boolean
  promptedAct: FinanceRequestBoardAct | null
  pending: boolean
  failure: string | null
  onOpenChange: (open: boolean) => void
  onAct: (act: 'submit' | 'cancel' | FinanceRequestBoardAct, extra?: string) => Promise<void>
  onEdit: (body: CreateRequestBody) => Promise<void>
  onAttach: (file: File, kind: string) => Promise<void>
}) {
  const [reason, setReason] = React.useState('')
  const [actualDate, setActualDate] = React.useState(item?.occurredOn ?? '')
  const [attachmentKind, setAttachmentKind] = React.useState('other')
  const [editing, setEditing] = React.useState(false)
  const [operationOpen, setOperationOpen] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  if (item === null) return null
  const canApprove = snapshot.permissions.canApprove
  const mutable = ['draft', 'submitted', 'approved'].includes(item.status)
  const canMaintain = item.own || snapshot.permissions.canEnter
  const canEdit =
    (item.own && (item.status === 'draft' || item.status === 'submitted')) ||
    (snapshot.permissions.canEnter && mutable)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-bbm-ui className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>
            Заявка №{item.id} — {requestTitle(item)}
          </SheetTitle>
          <SheetDescription>
            {formatRequestMoney(item.amount, item.currency, precisionFor(snapshot, item.currency))}{' '}
            · {STATUS_BADGES[item.status as FinanceRequestBoardStatus] ?? item.status}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-4">
          {failure ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          {promptedAct ? (
            <Alert role="status">
              <AlertTitle>Перенос подготовил действие</AlertTitle>
              <AlertDescription>
                Проверьте данные и подтвердите действие. Статус ещё не изменён.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>Автор: {item.createdByName ?? `Участник #${item.createdBy ?? '—'}`}</span>
              {item.decidedByName ? <span>Решение: {item.decidedByName}</span> : null}
              {item.postedByName && item.postedByName !== item.decidedByName ? (
                <span>Провёл: {item.postedByName}</span>
              ) : null}
            </div>
            {canEdit ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? 'Закрыть редактирование' : 'Редактировать заявку'}
              </Button>
            ) : null}
          </div>

          {editing ? (
            <div className="rounded-lg border p-4">
              <RequestForm
                references={snapshot.references}
                pending={pending}
                initialItem={item}
                includeAttachment={false}
                submitLabel="Сохранить изменения"
                onCreate={async (body) => {
                  await onEdit(body)
                  setEditing(false)
                }}
              />
            </div>
          ) : null}

          <Classification item={item} />

          {item.operation ? (
            <section className="space-y-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOperationOpen((value) => !value)}
              >
                {operationOpen ? 'Закрыть операцию' : `Открыть операцию №${item.operation.id}`}
              </Button>
              {operationOpen ? (
                <div
                  role="region"
                  aria-label={`Операция №${item.operation.id}`}
                  className="space-y-2 rounded-lg border bg-muted/30 p-4"
                >
                  <p className="text-sm font-medium">
                    Операция №{item.operation.id} · {item.operation.occurredOn}
                  </p>
                  {item.operation.postings.map((posting, index) => (
                    <div
                      key={`${posting.accountName}-${posting.currency}-${index}`}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{posting.accountName}</span>
                      <span className="tabular-nums">
                        {formatRequestMoney(
                          posting.amount,
                          posting.currency,
                          precisionFor(snapshot, posting.currency),
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {item.paidAmount && item.paidCurrency ? (
            <div className="rounded-lg border p-4 text-sm">
              <p className="text-xs font-medium text-muted-foreground">Фактически списано</p>
              <p className="mt-1 font-heading text-lg font-semibold tabular-nums">
                {formatRequestMoney(
                  item.paidAmount,
                  item.paidCurrency,
                  precisionFor(snapshot, item.paidCurrency),
                )}
              </p>
            </div>
          ) : null}

          {item.note ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Комментарий</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{item.note}</p>
            </div>
          ) : null}

          <section aria-labelledby={`documents-${item.id}`} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id={`documents-${item.id}`} className="font-heading font-semibold">
                Документы
              </h3>
              {mutable && canMaintain ? (
                <div className="flex flex-wrap items-end justify-end gap-2">
                  <NativeSelect
                    id={`request-attachment-kind-${item.id}`}
                    label="Вид прикрепляемого документа"
                    value={attachmentKind}
                    disabled={pending}
                    onChange={setAttachmentKind}
                  >
                    {DOCUMENT_KIND_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                  <Label className="sr-only" htmlFor={`request-attachment-file-${item.id}`}>
                    Файл документа
                  </Label>
                  <input
                    ref={fileRef}
                    id={`request-attachment-file-${item.id}`}
                    className="sr-only"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void onAttach(file, attachmentKind)
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Paperclip /> Приложить документ
                  </Button>
                </div>
              ) : null}
            </div>
            {item.documents.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Подтверждающего документа пока нет. Без него заявка не проводится.
              </div>
            ) : (
              item.documents.map((document) => (
                <div key={document.id} className="overflow-hidden rounded-lg border">
                  <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <FileText className="size-4 shrink-0" />
                      <span className="truncate">{document.filename}</span>
                    </span>
                    <Button variant="ghost" size="sm" asChild>
                      <a
                        href={`/p/finance/api/documents/${document.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть
                      </a>
                    </Button>
                  </div>
                  {document.mime === 'application/pdf' ? (
                    <iframe
                      className="h-72 w-full bg-muted/20"
                      title={`Документ ${document.filename}`}
                      src={`/p/finance/api/documents/${document.id}?disposition=inline`}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- private authenticated bytes, no stable optimization URL.
                    <img
                      className="max-h-72 w-full object-contain"
                      alt={document.filename}
                      src={`/p/finance/api/documents/${document.id}`}
                    />
                  )}
                </div>
              ))
            )}
          </section>

          {canApprove && (item.status === 'submitted' || item.status === 'approved') ? (
            <div className="space-y-3 rounded-lg border p-4">
              {item.status === 'approved' ? (
                <div className="grid gap-2">
                  <Label htmlFor="request-actual-date">Фактическая дата движения денег</Label>
                  <Input
                    id="request-actual-date"
                    type="date"
                    value={actualDate}
                    disabled={pending}
                    onChange={(event) => setActualDate(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="request-refusal-reason">Причина отказа</Label>
                <Textarea
                  id="request-refusal-reason"
                  value={reason}
                  disabled={pending}
                  placeholder="Обязательна только при отказе"
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {item.status === 'submitted' ? (
                  <Button disabled={pending} onClick={() => void onAct('approve')}>
                    Одобрить
                  </Button>
                ) : (
                  <Button
                    disabled={pending || item.documents.length === 0 || !actualDate}
                    onClick={() => void onAct('confirm', actualDate)}
                  >
                    Подтвердить и провести
                  </Button>
                )}
                <Button
                  variant="destructive"
                  disabled={pending || reason.trim() === ''}
                  onClick={() => void onAct('refuse', reason)}
                >
                  Отклонить
                </Button>
              </div>
            </div>
          ) : null}

          {canMaintain && item.status === 'draft' ? (
            <Button
              disabled={pending || item.purpose === null}
              onClick={() => void onAct('submit')}
            >
              Отправить на одобрение
            </Button>
          ) : null}
          {item.own && item.status === 'submitted' ? (
            <Button variant="outline" disabled={pending} onClick={() => void onAct('cancel')}>
              Отозвать заявку
            </Button>
          ) : null}
          {item.status === 'refused' && item.refusalReason ? (
            <Alert variant="destructive">
              <AlertTitle>Причина отказа</AlertTitle>
              <AlertDescription>{item.refusalReason}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <SheetFooter className="border-t text-xs text-muted-foreground">
          Действия фиксируются с автором и временем. Проведённая заявка не редактируется.
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function parseMoney(value: string, precision: number): string | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const [integer, fraction = ''] = normalized.split('.')
  if (fraction.length > precision) return null
  return `${integer}${fraction.padEnd(precision, '0')}`.replace(/^0+(?=\d)/, '')
}

function minorUnitsInput(value: string, precision: number): string {
  if (precision === 0) return value
  const digits = value.padStart(precision + 1, '0')
  const integer = digits.slice(0, -precision)
  const fraction = digits.slice(-precision).replace(/0+$/, '')
  return fraction === '' ? integer : `${integer}.${fraction}`
}

function NativeSelect({
  id,
  label,
  value,
  disabled,
  children,
  onChange,
}: {
  id: string
  label: string
  value: string
  disabled?: boolean
  children: React.ReactNode
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </select>
    </div>
  )
}

export function RequestForm({
  references,
  pending,
  onCreate,
  initialItem,
  includeAttachment = true,
  submitLabel = 'Создать заявку',
}: {
  references: RequestBoardReferences
  pending: boolean
  onCreate: (body: CreateRequestBody, file: File | null, documentKind?: string) => Promise<void>
  initialItem?: RequestBoardItem
  includeAttachment?: boolean
  submitLabel?: string
}) {
  const firstCurrency = references.currencies[0]
  const initialCurrency = initialItem?.currency ?? firstCurrency?.code ?? ''
  const [amount, setAmount] = React.useState(() =>
    initialItem
      ? minorUnitsInput(
          initialItem.amount,
          references.currencies.find((item) => item.code === initialCurrency)?.precision ?? 2,
        )
      : '',
  )
  const [currency, setCurrency] = React.useState(initialCurrency)
  const [paidAmount, setPaidAmount] = React.useState(() =>
    initialItem?.paidAmount && initialItem.paidCurrency
      ? minorUnitsInput(
          initialItem.paidAmount,
          references.currencies.find((item) => item.code === initialItem.paidCurrency)?.precision ??
            2,
        )
      : '',
  )
  const [paidCurrency, setPaidCurrency] = React.useState(
    initialItem?.paidCurrency ?? firstCurrency?.code ?? '',
  )
  const [occurredOn, setOccurredOn] = React.useState(initialItem?.occurredOn ?? '')
  const [purposeId, setPurposeId] = React.useState(
    String(initialItem?.purpose?.id ?? references.purposes[0]?.id ?? ''),
  )
  const [purposeMissing, setPurposeMissing] = React.useState(
    initialItem !== undefined && initialItem.purpose === null,
  )
  const [purposeProposal, setPurposeProposal] = React.useState(initialItem?.proposal?.text ?? '')
  const [projectId, setProjectId] = React.useState(
    String(initialItem?.project.id ?? references.projects[0]?.id ?? ''),
  )
  const [productId, setProductId] = React.useState(
    String(initialItem?.product?.id ?? references.products[0]?.id ?? ''),
  )
  const [accountId, setAccountId] = React.useState(
    String(initialItem?.account?.id ?? references.accounts[0]?.id ?? ''),
  )
  const [counterpartyId, setCounterpartyId] = React.useState(
    String(initialItem?.counterparty?.id ?? references.counterparties[0]?.id ?? ''),
  )
  const [newCounterparty, setNewCounterparty] = React.useState(false)
  const [counterpartyName, setCounterpartyName] = React.useState('')
  const [note, setNote] = React.useState(initialItem?.note ?? '')
  const [alreadyPaid, setAlreadyPaid] = React.useState(initialItem?.alreadyPaid ?? false)
  const [personalFunds, setPersonalFunds] = React.useState(initialItem?.personalFunds ?? false)
  const [file, setFile] = React.useState<File | null>(null)
  const [documentKind, setDocumentKind] = React.useState('other')
  const [issues, setIssues] = React.useState<string[]>([])
  const account = references.accounts.find((item) => item.id === Number(accountId))
  const crossCurrency = personalFunds || (account !== undefined && account.currency !== currency)
  const selectedPurpose = purposeMissing
    ? undefined
    : references.purposes.find((item) => item.id === Number(purposeId))
  const productBinding = selectedPurpose?.productBinding ?? 'optional'
  const availableProducts = references.products.filter(
    (item) => !projectId || item.projectId === Number(projectId),
  )
  const effectiveProductId =
    !purposeMissing &&
    productBinding !== 'forbidden' &&
    availableProducts.some((product) => product.id === Number(productId))
      ? productId
      : ''

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const precision = references.currencies.find((item) => item.code === currency)?.precision ?? 2
    const amountMinor = parseMoney(amount, precision)
    const nextIssues: string[] = []
    if (amountMinor === null || BigInt(amountMinor || '0') <= 0n) nextIssues.push('Укажите сумму.')
    if (!occurredOn) nextIssues.push('Укажите дату движения денег.')
    if (!projectId) nextIssues.push('Выберите проект.')
    if (!purposeMissing && !purposeId) nextIssues.push('Выберите назначение.')
    if (purposeMissing && !purposeProposal.trim()) nextIssues.push('Опишите новое назначение.')
    if (!purposeMissing && productBinding === 'required' && !effectiveProductId) {
      nextIssues.push('Выберите продукт для этого назначения и проекта.')
    }
    if (!newCounterparty && !counterpartyId) nextIssues.push('Выберите контрагента.')
    if (newCounterparty && !counterpartyName.trim()) nextIssues.push('Назовите контрагента.')
    if (!personalFunds && !accountId) nextIssues.push('Выберите счёт оплаты.')
    if (personalFunds && !alreadyPaid) {
      nextIssues.push('Для оплаты своими средствами сначала отметьте «Деньги уже потрачены».')
    }
    let paidMinor: string | null = null
    if (crossCurrency) {
      const paidPrecision =
        references.currencies.find((item) => item.code === paidCurrency)?.precision ?? 2
      paidMinor = parseMoney(paidAmount, paidPrecision)
      if (paidMinor === null || BigInt(paidMinor || '0') <= 0n) {
        nextIssues.push('Укажите фактически списанную сумму.')
      }
      if (!paidCurrency) nextIssues.push('Выберите валюту списания.')
    }
    setIssues(nextIssues)
    if (nextIssues.length > 0 || amountMinor === null) return

    await onCreate(
      {
        occurredOn,
        accountId: personalFunds ? null : Number(accountId),
        amount: amountMinor,
        currency,
        paidAmount: crossCurrency ? paidMinor : null,
        paidCurrency: crossCurrency ? paidCurrency : null,
        purposeId: purposeMissing ? null : Number(purposeId),
        purposeProposal: purposeMissing ? purposeProposal.trim() : null,
        projectId: Number(projectId),
        productId:
          purposeMissing || productBinding === 'forbidden' || !effectiveProductId
            ? null
            : Number(effectiveProductId),
        counterpartyId: newCounterparty ? null : Number(counterpartyId),
        counterpartyName: newCounterparty ? counterpartyName.trim() : null,
        note: note.trim() || null,
        alreadyPaid,
        personalFunds,
      },
      file,
      documentKind,
    )
  }

  return (
    <form className="space-y-5" onSubmit={submit} noValidate>
      {issues.length > 0 ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {issues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div className="grid gap-2">
          <Label htmlFor="request-amount">Сумма документа</Label>
          <Input
            id="request-amount"
            inputMode="decimal"
            value={amount}
            disabled={pending}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <NativeSelect
          id="request-currency"
          label="Валюта документа"
          value={currency}
          disabled={pending}
          onChange={setCurrency}
        >
          {references.currencies.map((item) => (
            <option key={item.code} value={item.code}>
              {item.code}
            </option>
          ))}
        </NativeSelect>
      </div>

      {crossCurrency ? (
        <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[2fr_1fr]">
          <div className="grid gap-2">
            <Label htmlFor="request-paid-amount">Фактически списано</Label>
            <Input
              id="request-paid-amount"
              inputMode="decimal"
              value={paidAmount}
              disabled={pending}
              onChange={(event) => setPaidAmount(event.target.value)}
            />
          </div>
          <NativeSelect
            id="request-paid-currency"
            label="Валюта списания"
            value={paidCurrency}
            disabled={pending}
            onChange={setPaidCurrency}
          >
            {references.currencies.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <NativeSelect
          id="request-purpose"
          label="Назначение"
          value={purposeId}
          disabled={pending || purposeMissing}
          onChange={(value) => {
            setPurposeId(value)
            const nextBinding = references.purposes.find(
              (purpose) => purpose.id === Number(value),
            )?.productBinding
            if (nextBinding === 'forbidden') setProductId('')
          }}
        >
          <option value="">Выберите назначение</option>
          {references.purposes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          id="request-project"
          label="Проект"
          value={projectId}
          disabled={pending}
          onChange={(value) => {
            setProjectId(value)
            if (
              !references.products.some(
                (product) =>
                  product.id === Number(productId) && product.projectId === Number(value),
              )
            ) {
              setProductId('')
            }
          }}
        >
          {references.projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          id="request-purpose-missing"
          checked={purposeMissing}
          disabled={pending || initialItem !== undefined}
          onCheckedChange={(value) => setPurposeMissing(value === true)}
        />
        <span>Нужного назначения нет</span>
      </label>
      {purposeMissing ? (
        <div className="grid gap-2 rounded-lg border border-dashed p-4">
          <Label htmlFor="request-purpose-proposal">Предложение назначения</Label>
          <Textarea
            id="request-purpose-proposal"
            value={purposeProposal}
            disabled={pending || initialItem !== undefined}
            onChange={(event) => setPurposeProposal(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Черновик будет ждать решения администратора; свободный текст не попадёт в проводку.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <NativeSelect
          id="request-product"
          label="Продукт"
          value={effectiveProductId}
          disabled={pending || purposeMissing || productBinding === 'forbidden'}
          onChange={setProductId}
        >
          <option value="">Без продукта</option>
          {availableProducts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          id="request-account"
          label="Счёт оплаты"
          value={accountId}
          disabled={pending || personalFunds}
          onChange={setAccountId}
        >
          <option value="">Выберите счёт</option>
          {references.accounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.currency}
            </option>
          ))}
        </NativeSelect>
      </div>

      <NativeSelect
        id="request-counterparty"
        label="Контрагент"
        value={counterpartyId}
        disabled={pending || newCounterparty}
        onChange={setCounterpartyId}
      >
        <option value="">Выберите контрагента</option>
        {references.counterparties.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </NativeSelect>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          id="request-new-counterparty"
          checked={newCounterparty}
          disabled={pending}
          onCheckedChange={(value) => setNewCounterparty(value === true)}
        />
        <span>Добавить нового контрагента</span>
      </label>
      {newCounterparty ? (
        <div className="grid gap-2">
          <Label htmlFor="request-counterparty-name">Название нового контрагента</Label>
          <Input
            id="request-counterparty-name"
            value={counterpartyName}
            disabled={pending}
            onChange={(event) => setCounterpartyName(event.target.value)}
          />
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="request-occurred-on">Дата движения денег</Label>
        <Input
          id="request-occurred-on"
          type="date"
          value={occurredOn}
          disabled={pending}
          onChange={(event) => setOccurredOn(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Для будущей траты — ожидаемая дата; при проведении её заменят фактической.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="request-note">Комментарий</Label>
        <Textarea
          id="request-note"
          value={note}
          disabled={pending}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            id="request-already-paid"
            checked={alreadyPaid}
            disabled={pending}
            onCheckedChange={(value) => {
              const checked = value === true
              setAlreadyPaid(checked)
              if (!checked) setPersonalFunds(false)
            }}
          />
          <span>Деньги уже потрачены</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            id="request-personal-funds"
            checked={personalFunds}
            disabled={pending}
            onCheckedChange={(value) => setPersonalFunds(value === true)}
          />
          <span>Оплачено своими средствами</span>
        </label>
      </div>

      {includeAttachment ? (
        <div className="grid gap-4 rounded-lg border border-dashed p-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="request-document">Инвойс или чек</Label>
            <Input
              id="request-document"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={pending}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <NativeSelect
            id="request-document-kind"
            label="Вид документа"
            value={documentKind}
            disabled={pending || file === null}
            onChange={setDocumentKind}
          >
            {DOCUMENT_KIND_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Сохраняем…' : submitLabel}
      </Button>
    </form>
  )
}

export function RequestsBoard({ initialSnapshot }: { initialSnapshot?: RequestsSnapshot }) {
  const [snapshot, setSnapshot] = React.useState<RequestsSnapshot | null>(initialSnapshot ?? null)
  const [loading, setLoading] = React.useState(initialSnapshot === undefined)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [uploadRecovery, setUploadRecovery] = React.useState<PendingUploadRecovery | null>(null)
  const [proposalRecovery, setProposalRecovery] = React.useState<PendingProposalRecovery | null>(
    null,
  )
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [promptedAct, setPromptedAct] = React.useState<FinanceRequestBoardAct | null>(null)
  const [newOpen, setNewOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [dragged, setDragged] = React.useState<{
    id: number
    status: RequestBoardItem['status']
  } | null>(null)
  const [isNarrow, setIsNarrow] = React.useState(false)
  const [narrowStatus, setNarrowStatus] = React.useState<FinanceRequestBoardStatus>('submitted')
  const [activeTab, setActiveTab] = React.useState('board')

  const load = React.useCallback(async () => {
    setLoading(true)
    setFailure(null)
    try {
      setSnapshot(await fetchRequestsSnapshot())
    } catch (cause) {
      setFailure(apiMessage(cause, 'Не удалось загрузить заявки.'))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (initialSnapshot !== undefined) return
    let active = true
    void fetchRequestsSnapshot()
      .then((next) => {
        if (active) setSnapshot(next)
      })
      .catch((cause: unknown) => {
        if (active) setFailure(apiMessage(cause, 'Не удалось загрузить заявки.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [initialSnapshot])
  React.useEffect(() => {
    const media = window.matchMedia?.('(max-width: 639px)')
    if (!media) return
    const sync = () => setIsNarrow(media.matches)
    sync()
    media.addEventListener?.('change', sync)
    return () => media.removeEventListener?.('change', sync)
  }, [])

  if (loading && snapshot === null) return <RequestBoardLoading />
  if (snapshot === null) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>Заявки недоступны</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{failure ?? 'Не удалось прочитать финансовый контур.'}</p>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw /> Попробовать снова
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const selected = snapshot.requests.find((item) => item.id === selectedId) ?? null
  const visibleStatuses = isNarrow ? [narrowStatus] : [...FINANCE_REQUEST_BOARD_STATUSES]
  const outOfBoard = snapshot.requests.filter(
    (item) => !FINANCE_REQUEST_BOARD_STATUSES.includes(item.status as FinanceRequestBoardStatus),
  )

  async function mutateAction(act: 'submit' | 'cancel' | FinanceRequestBoardAct, extra?: string) {
    if (selected === null) return
    setPending(true)
    setFailure(null)
    try {
      const body =
        act === 'refuse'
          ? { act, reason: extra }
          : act === 'confirm'
            ? { act, occurredOn: extra }
            : { act }
      const response = await fetch(`/p/finance/api/requests/${selected.id}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await responseMessage(response))
      setNotice(
        act === 'approve'
          ? 'Заявка одобрена. Если документ уже был приложен, операция проведена.'
          : act === 'confirm'
            ? 'Документ подтверждён, операция проведена.'
            : act === 'refuse'
              ? 'Заявка отклонена с указанной причиной.'
              : act === 'cancel'
                ? 'Заявка отозвана.'
                : 'Заявка отправлена на одобрение.',
      )
      setSelectedId(null)
      setPromptedAct(null)
      await load()
    } catch (cause) {
      setFailure(apiMessage(cause, 'Действие не выполнено.'))
    } finally {
      setPending(false)
    }
  }

  async function attach(file: File, kind: string) {
    if (selected === null) return
    setPending(true)
    setFailure(null)
    try {
      const upload = await uploadRequestDocument(selected.id, file, kind, fetch)
      if (upload.message !== null) {
        setUploadRecovery(
          upload.recovery === null ? null : { ...upload.recovery, submitAfterUpload: false },
        )
        throw new Error(upload.message)
      }
      setNotice('Документ приложен к заявке.')
      await load()
    } catch (cause) {
      setFailure(apiMessage(cause, 'Документ не приложен.'))
    } finally {
      setPending(false)
    }
  }

  async function create(body: CreateRequestBody, file: File | null, kind = 'other') {
    setPending(true)
    setFailure(null)
    try {
      const outcome = await runRequestCreation(body, file, kind)
      setNotice(outcome.message)
      setNewOpen(false)
      await load()
      if (outcome.status === 'saved-draft') {
        setSelectedId(outcome.requestId)
        if (outcome.stage === 'upload') setUploadRecovery(outcome.recovery)
        if (outcome.stage === 'proposal') setProposalRecovery(outcome.recovery)
      }
    } catch (cause) {
      setFailure(apiMessage(cause, 'Заявка не создана.'))
    } finally {
      setPending(false)
    }
  }

  async function edit(body: CreateRequestBody) {
    if (selected === null) return
    const wasApproved = selected.status === 'approved'
    setPending(true)
    setFailure(null)
    try {
      const response = await fetch(`/p/finance/api/requests/${selected.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await responseMessage(response))
      const result = (await response.json()) as { status: string; bounced: boolean }
      setNotice(
        wasApproved && result.bounced
          ? 'Изменения сохранены: заявка вернулась на одобрение.'
          : 'Изменения заявки сохранены.',
      )
      await load()
    } catch (cause) {
      setFailure(apiMessage(cause, 'Изменения заявки не сохранены.'))
    } finally {
      setPending(false)
    }
  }

  async function retryPendingUpload() {
    if (uploadRecovery === null) return
    setPending(true)
    setFailure(null)
    try {
      await resumePendingUpload(uploadRecovery)
      if (uploadRecovery.submitAfterUpload) {
        const submitted = await fetch(
          `/p/finance/api/requests/${uploadRecovery.requestId}/actions`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ act: 'submit' }),
          },
        )
        if (!submitted.ok) throw new Error(await responseMessage(submitted))
      }
      setNotice(
        uploadRecovery.submitAfterUpload
          ? `Документ загружен, черновик №${uploadRecovery.requestId} отправлен на одобрение.`
          : 'Документ загружен.',
      )
      setUploadRecovery(null)
      await load()
    } catch (cause) {
      setFailure(apiMessage(cause, 'Загрузку не удалось возобновить; черновик сохранён.'))
    } finally {
      setPending(false)
    }
  }

  async function retryPurposeProposal() {
    if (proposalRecovery === null) return
    setPending(true)
    setFailure(null)
    try {
      await resumePurposeProposal(proposalRecovery)
      setNotice(
        `Предложение назначения сохранено для черновика №${proposalRecovery.requestId}; вторая заявка не создавалась.`,
      )
      setProposalRecovery(null)
      await load()
    } catch (cause) {
      setFailure(
        apiMessage(
          cause,
          `Предложение назначения для черновика №${proposalRecovery.requestId} не сохранено.`,
        ),
      )
    } finally {
      setPending(false)
    }
  }

  function drop(to: FinanceRequestBoardStatus) {
    if (dragged === null) return
    const plan = planRequestDrop(dragged.status, to)
    setDragged(null)
    if (plan.type === 'refused') {
      setNotice(plan.message)
      return
    }
    setSelectedId(dragged.id)
    setPromptedAct(plan.act)
  }

  return (
    <section aria-labelledby="finance-requests-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            id="finance-requests-heading"
            className="font-heading text-2xl font-semibold tracking-tight"
          >
            Заявки
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Расход от заявки до подтверждающего документа и операции в леджере.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus /> Новая заявка
        </Button>
      </div>

      {!snapshot.permissions.canApprove && !snapshot.permissions.canEnter ? (
        <Alert role="status">
          <AlertTitle>Ваши заявки</AlertTitle>
          <AlertDescription>
            Видны только свои заявки. Доска доступна только для чтения; подать, отозвать и приложить
            документ можно в карточке.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          Перетащите карточку к допустимой цели: откроется акт подтверждения, а статус сам не
          изменится.
        </p>
      )}
      {notice ? (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {uploadRecovery ? (
        <Alert role="status">
          <AlertTitle>Черновик сохранён</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>Повторная попытка продолжит загрузку тех же байтов и не создаст вторую заявку.</p>
            <Button variant="outline" disabled={pending} onClick={() => void retryPendingUpload()}>
              Повторить загрузку документа
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {proposalRecovery ? (
        <Alert role="status">
          <AlertTitle>Черновик №{proposalRecovery.requestId} сохранён</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Предложение назначения пока не сохранено. Повторная попытка дополнит этот черновик и
              не создаст вторую заявку.
            </p>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void retryPurposeProposal()}
            >
              Повторить сохранение предложения
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {failure ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line" aria-label="Разделы заявок">
          <TabsTrigger value="board" onClick={() => setActiveTab('board')}>
            Доска
          </TabsTrigger>
          <TabsTrigger value="liabilities" onClick={() => setActiveTab('liabilities')}>
            Обязательства
          </TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="space-y-4" aria-label="Доска">
          {snapshot.requests.length === 0 ? (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle>Заявок пока нет</CardTitle>
                <CardDescription>
                  Создайте первую заявку: она появится здесь сразу после отправки.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => setNewOpen(true)}>Создать первую заявку</Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {isNarrow ? (
                <NativeSelect
                  id="request-mobile-status"
                  label="Статус"
                  value={narrowStatus}
                  onChange={(value) => setNarrowStatus(value as FinanceRequestBoardStatus)}
                >
                  {FINANCE_REQUEST_BOARD_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {visibleStatuses.map((status) => {
                  const items = snapshot.requests.filter((item) => item.status === status)
                  const legalTarget =
                    dragged !== null && planRequestDrop(dragged.status, status).type === 'act'
                  return (
                    <section
                      key={status}
                      role="region"
                      aria-label={STATUS_LABELS[status]}
                      onDragOver={(event) => {
                        if (legalTarget) event.preventDefault()
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        drop(status)
                      }}
                      className={
                        legalTarget
                          ? 'min-h-48 rounded-xl border border-primary bg-primary/5 p-3 ring-2 ring-primary/20'
                          : 'min-h-48 rounded-xl border bg-muted/25 p-3'
                      }
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold">{STATUS_LABELS[status]}</h2>
                        <Badge variant="secondary">{items.length}</Badge>
                      </div>
                      <div className="space-y-3">
                        {items.length === 0 ? (
                          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                            В этом статусе ничего нет.
                          </p>
                        ) : (
                          items.map((item) => (
                            <BoardCard
                              key={item.id}
                              item={item}
                              snapshot={snapshot}
                              canDrag={
                                snapshot.permissions.canApprove &&
                                (item.status === 'submitted' || item.status === 'approved')
                              }
                              onDrag={() => setDragged({ id: item.id, status: item.status })}
                              onOpen={() => {
                                setSelectedId(item.id)
                                setPromptedAct(null)
                              }}
                            />
                          ))
                        )}
                      </div>
                    </section>
                  )
                })}
              </div>
              {outOfBoard.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Черновики и отозванные</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {outOfBoard.map((item) => (
                      <Button
                        key={item.id}
                        variant="outline"
                        onClick={() => setSelectedId(item.id)}
                      >
                        №{item.id} · {requestTitle(item)} · {item.status}
                      </Button>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </TabsContent>
        <TabsContent value="liabilities" aria-label="Обязательства">
          <Card>
            <CardHeader>
              <CardTitle>Кому BBM должен</CardTitle>
              <CardDescription>
                Непогашенные траты участников своими средствами, по человеку и валюте.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {snapshot.liabilities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Открытых обязательств сейчас нет.</p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {snapshot.liabilities.map((liability) => (
                    <div
                      key={`${liability.memberId}-${liability.currency}`}
                      className="flex items-center justify-between gap-4 px-4 py-3"
                    >
                      <span className="font-medium">{liability.memberName}</span>
                      <span className="font-heading text-lg font-semibold tabular-nums">
                        {formatRequestMoney(
                          (BigInt(liability.balance) < 0n
                            ? -BigInt(liability.balance)
                            : BigInt(liability.balance)
                          ).toString(),
                          liability.currency,
                          precisionFor(snapshot, liability.currency),
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RequestDetails
        key={selected?.id ?? 'closed'}
        item={selected}
        snapshot={snapshot}
        open={selected !== null}
        promptedAct={promptedAct}
        pending={pending}
        failure={failure}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null)
            setPromptedAct(null)
          }
        }}
        onAct={mutateAction}
        onEdit={edit}
        onAttach={attach}
      />

      <Sheet open={newOpen} onOpenChange={setNewOpen}>
        <SheetContent data-bbm-ui className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="border-b">
            <SheetTitle>Новая заявка</SheetTitle>
            <SheetDescription>
              Данные расхода вводятся один раз и после подтверждения становятся проводкой.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {failure ? (
              <Alert variant="destructive" role="alert" className="mb-4">
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            ) : null}
            <RequestForm references={snapshot.references} pending={pending} onCreate={create} />
          </div>
        </SheetContent>
      </Sheet>
    </section>
  )
}
