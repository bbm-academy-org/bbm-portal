'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { XIcon } from 'lucide-react'
import React from 'react'
import { useForm, useFormContext } from 'react-hook-form'
import { z } from 'zod'

import type { FinanceDocumentKind } from '@/lib/finance'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/ui/form'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
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
import { cn } from '@/ui/utils'

import { documentHref, DOCUMENT_KIND_LABELS, formatDate, isInlineReadable } from './constants'
import { useDisplayCurrency } from './display-currency-store'
import type { RequestBoardItem, RequestBoardReferences } from './request-board-contract'
import {
  currencyPrecision,
  DOCUMENT_UPLOAD_ACCEPT,
  documentUploadRefusal,
  emptyDocumentNote,
  formatRequestMoney,
  requestPurposeLabel,
} from './request-board-model'
import { formatOriginalMoney, queuePayee, queueRowTitle } from './request-queue-model'
import {
  createMarkPaidSchema,
  createReimburseSchema,
  debitedAmountMode,
  howToPay,
  initialSheetForm,
  lacksReceipt,
  markPaidDefaults,
  marketBlockView,
  mayAttachDocument,
  receiptRefusal,
  refundAccounts,
  refundCurrencyFixed,
  refundPrefill,
  reimburseDefaults,
  sheetActs,
  sheetAmount,
  sheetFee,
  sheetFormOf,
  sheetMeta,
  sheetTimeline,
  toMarkPaidBody,
  toReimburseBody,
  type MarkPaidFormValue,
  type ReceiptFields,
  type ReimburseFormValue,
  type SheetAct,
  type SheetForm,
} from './request-sheet-model'
import { RequestSourceLink } from './RequestSourceLink'
import { useSheetOverlayMark } from './sheet-overlay'

/** The act names the endpoint takes (`POST …/requests/:id/actions`). */
export type RequestAct =
  'approve' | 'confirm' | 'refuse' | 'submit' | 'cancel' | 'mark-paid' | 'mark-reimbursed'

/** An act's own fields besides its name — the reason, or the money facts with the EARS-548 token. */
export type RequestActPayload = Record<string, unknown>

/** A receipt the payment forms carry (optional, EARS-543/544) — attached once the act has posted. */
export type ActReceipt = { file: File; kind: FinanceDocumentKind }

/**
 * Which form the sheet opens with: the queue row act and the board's drop
 * onto «Проведены» ask for `pay`, a drop onto «Отклонены» for `refuse`; the
 * sheet resolves either to its stage's own form (`initialSheetForm`).
 */
export type SheetOpening = 'pay' | 'refuse' | null

// ── small parts ─────────────────────────────────────────────────────────────

/**
 * A section of the sheet: a plain heading over its content — type, not a box.
 * The heading is a LABEL (pre-acceptance UX pass, item 3): small tracked
 * capitals in the muted token, so it never reads as one more line of the body
 * and never competes with the amount or the primary act.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3
        data-section-label=""
        className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * «факт не внесён — укажите …» (§J, EARS-560/563): the state in the body
 * colour, then what to do about it (pre-acceptance UX pass, item 6). It asks
 * for an act, so it is not fine print.
 */
function MarketNote({ text }: { text: string }) {
  const [state, ...hint] = text.split(' — ')
  return (
    <p className="text-sm text-foreground">
      <span className="font-medium">{state}</span>
      {hint.length === 0 ? null : (
        <span className="text-muted-foreground">{` — ${hint.join(' — ')}`}</span>
      )}
    </p>
  )
}

/**
 * One fact of the request as a label / value pair. THE VALUE WRAPS, IT NEVER
 * TRUNCATES — a value carries the state, and a clipped state is a half-said
 * one (#388/#473).
 */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words whitespace-pre-wrap text-foreground">{children}</dd>
    </>
  )
}

/**
 * AN ACT OPENED FROM THIS SCREEN — a SECTION of the details sheet, never a
 * second overlay (owner go, Антон, 2026-09-15, #388; `docs/design/ui-whitelist.md`
 * → «One overlay shape per screen»). It takes focus and scrolls itself into
 * view on mount, which is what a modal would have done for free.
 */
function ActSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLElement>(null)
  React.useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
    ref.current?.focus()
  }, [])
  return (
    <section
      ref={ref}
      aria-label={title}
      tabIndex={-1}
      className="space-y-3 rounded-lg border bg-muted/30 p-4 outline-none"
    >
      <div className="space-y-1">
        <h3 className="font-heading text-base font-semibold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

/** The act's own action row — the SAME grammar as the sheet footer: the primary act, then its way out. */
function ActFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-row flex-wrap items-center gap-2 pt-1">{children}</div>
}

/** What the server answered, verbatim, where the reader is still looking (EARS-543/548). */
function ActFailure({ message }: { message?: string }) {
  if (message === undefined) return null
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function KindSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <FormControl>
        <SelectTrigger className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        {Object.entries(DOCUMENT_KIND_LABELS).map(([kind, label]) => (
          <SelectItem key={kind} value={kind}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AccountSelect({
  accounts,
  value,
  onChange,
  disabled,
}: {
  accounts: RequestBoardReferences['accounts']
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <Select value={value === '' ? undefined : value} onValueChange={onChange} disabled={disabled}>
      <FormControl>
        <SelectTrigger className="w-full min-w-0">
          <SelectValue placeholder="Выберите счёт" />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={String(account.id)}>
            {account.name} · {account.currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── the receipt field the payment forms share ───────────────────────────────

/**
 * The optional receipt of «Отметить оплату» / «Отметить возврат» (EARS-543/544).
 * It is attached AFTER the act posts, to the posted request (EARS-545) — so a
 * refused act leaves no orphan document, and the act's snapshot is the one the
 * owner saw.
 */
function ReceiptField({ pending }: { pending: boolean }) {
  // The two payment forms share these two fields; their other fields differ,
  // so the field reads the enclosing form through its context.
  const form = useFormContext<ReceiptFields>()
  return (
    <div className="grid gap-3">
      <FormField
        control={form.control}
        name="receipt"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Чек или скриншот оплаты</FormLabel>
            <FormControl>
              <Input
                type="file"
                accept={DOCUMENT_UPLOAD_ACCEPT}
                disabled={pending}
                className="h-auto cursor-pointer py-1.5 file:mr-2 file:cursor-pointer file:rounded-md file:bg-secondary file:px-2 file:transition-colors hover:file:bg-secondary/70"
                onChange={(event) => {
                  form.clearErrors('receipt')
                  field.onChange(event.target.files)
                }}
              />
            </FormControl>
            <FormDescription>Необязательно — чек можно приложить и позже.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      {form.watch('receipt')?.[0] ? (
        <FormField
          control={form.control}
          name="receiptKind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Вид документа</FormLabel>
              <KindSelect
                value={field.value ?? 'payment_order'}
                onChange={field.onChange}
                disabled={pending}
              />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  )
}

/** The chosen receipt; `null` — refused (the message is set on its field); `undefined` — none. */
function takeReceipt(
  files: FileList | null,
  kind: string,
  refuse: (message: string) => void,
): ActReceipt | null | undefined {
  const file = files?.[0] ?? null
  if (file === null) return undefined
  const refusal = receiptRefusal(file)
  if (refusal !== null) {
    refuse(refusal)
    return null
  }
  return { file, kind: kind as FinanceDocumentKind }
}

// ── «Отметить оплату» (EARS-543) ────────────────────────────────────────────

function MarkPaidSection({
  request,
  references,
  today,
  approving,
  pending,
  failure,
  onConfirm,
  onCancel,
}: {
  request: RequestBoardItem
  references: RequestBoardReferences
  today: string
  approving: boolean
  pending: boolean
  failure?: string
  onConfirm: (payload: RequestActPayload, receipt?: ActReceipt) => void
  onCancel: () => void
}) {
  const schema = React.useMemo(
    () => createMarkPaidSchema(request, references),
    [references, request],
  )
  const form = useForm<MarkPaidFormValue>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...markPaidDefaults(request, references, today),
      receipt: null,
      receiptKind: 'payment_order',
    },
  })
  const mode = debitedAmountMode(request, references, form.watch('accountId'))

  return (
    <ActSection
      title={approving ? 'Одобрить и отметить оплату' : 'Отметить оплату'}
      description={
        approving
          ? 'Одобрение и оплата одним актом: когда и с какого счёта ушли деньги.'
          : 'Когда и с какого счёта ушли деньги. Чек необязателен.'
      }
    >
      <Form {...form}>
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((value) => {
            const receipt = takeReceipt(
              form.getValues('receipt') ?? null,
              form.getValues('receiptKind') ?? 'other',
              (message) => form.setError('receipt', { message }),
            )
            if (receipt === null) return
            onConfirm(toMarkPaidBody(value, request, references), receipt)
          })}
        >
          <FormField
            control={form.control}
            name="occurredOn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Дата оплаты</FormLabel>
                <FormControl>
                  <Input {...field} type="date" disabled={pending} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="accountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Откуда</FormLabel>
                <AccountSelect
                  accounts={references.accounts}
                  value={field.value}
                  onChange={field.onChange}
                  disabled={pending}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          {mode.mode === 'same' ? (
            <FormItem>
              <FormLabel>Списано фактически</FormLabel>
              <Input value={mode.value} readOnly disabled aria-readonly />
              <FormDescription>Счёт в валюте заявки — списана её сумма.</FormDescription>
            </FormItem>
          ) : mode.mode === 'asked' ? (
            <FormField
              control={form.control}
              name="paidAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Списано фактически, {mode.currency}</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" placeholder="0,00" disabled={pending} />
                  </FormControl>
                  <FormDescription>
                    Заявка в {request.currency}, счёт в {mode.currency}: сумма — факт со списания,
                    по курсу она не считается.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
          <ReceiptField pending={pending} />
          <ActFailure message={failure} />
          <ActFooter>
            <Button
              type="submit"
              disabled={
                pending || (mode.mode === 'asked' && form.watch('paidAmount').trim() === '')
              }
            >
              {pending ? 'Отмечаем…' : 'Оплачено'}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
              Отмена
            </Button>
          </ActFooter>
        </form>
      </Form>
    </ActSection>
  )
}

// ── «Отметить возврат» (EARS-544) ───────────────────────────────────────────

function ReimburseSection({
  request,
  references,
  today,
  pending,
  failure,
  onConfirm,
  onCancel,
}: {
  request: RequestBoardItem
  references: RequestBoardReferences
  today: string
  pending: boolean
  failure?: string
  onConfirm: (payload: RequestActPayload, receipt?: ActReceipt) => void
  onCancel: () => void
}) {
  const schema = React.useMemo(
    () => createReimburseSchema(request, references),
    [references, request],
  )
  const form = useForm<ReimburseFormValue>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...reimburseDefaults(request, references, today),
      receipt: null,
      receiptKind: 'payment_order',
    },
  })
  const accounts = refundAccounts(request, references)
  const fixed = refundCurrencyFixed(request)
  const accountId = form.watch('accountId')
  const account = accounts.find((row) => String(row.id) === accountId) ?? null

  return (
    <ActSection
      title="Отметить возврат"
      description={`Сколько, когда и с какого счёта вернули ${request.memberName ?? request.createdByName ?? 'сотруднику'}. Долг закрывается этим же актом.`}
    >
      <Form {...form}>
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((value) => {
            const receipt = takeReceipt(
              form.getValues('receipt') ?? null,
              form.getValues('receiptKind') ?? 'other',
              (message) => form.setError('receipt', { message }),
            )
            if (receipt === null) return
            onConfirm(toReimburseBody(value, request, references), receipt)
          })}
        >
          <FormField
            control={form.control}
            name="occurredOn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Дата возврата</FormLabel>
                <FormControl>
                  <Input {...field} type="date" disabled={pending} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="accountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Откуда</FormLabel>
                <AccountSelect
                  accounts={accounts}
                  value={field.value}
                  onChange={(next) => {
                    field.onChange(next)
                    // The required sum follows the account where the request fixes it.
                    const prefill = refundPrefill(request, references, next)
                    if (prefill !== '' || form.getValues('amount') === '') {
                      form.setValue('amount', prefill)
                    }
                  }}
                  disabled={pending || accounts.length === 0}
                />
                {fixed === null ? null : (
                  <FormDescription>
                    Долг записан в {fixed} — возврат со счёта в этой валюте.
                  </FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Сумма возврата{account === null ? '' : `, ${account.currency}`}
                </FormLabel>
                <FormControl>
                  <Input {...field} inputMode="decimal" placeholder="0,00" disabled={pending} />
                </FormControl>
                <FormDescription>
                  {account !== null && account.currency !== request.currency && fixed === null
                    ? `Заявка в ${request.currency}, возврат в ${account.currency}: сумма — факт, столько ушло сотруднику.`
                    : 'Весь долг по заявке, с комиссией, если она записана.'}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <ReceiptField pending={pending} />
          <ActFailure message={failure} />
          <ActFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Отмечаем…' : 'Возвращено'}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
              Отмена
            </Button>
          </ActFooter>
        </form>
      </Form>
    </ActSection>
  )
}

// ── «Отклонить» / «Отозвать» (EARS-512/542) ─────────────────────────────────

const reasonSchema = z.object({
  reason: z.string().trim().min(1, 'Укажите причину.'),
})

function ReasonSection({
  revoke,
  pending,
  failure,
  onConfirm,
  onCancel,
}: {
  revoke: boolean
  pending: boolean
  failure?: string
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const form = useForm<z.infer<typeof reasonSchema>>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '' },
  })
  return (
    <ActSection
      title={revoke ? 'Отозвать одобрение' : 'Отклонить заявку'}
      description={
        revoke
          ? 'Одобрение снимается, заявка закрывается как отклонённая. Причина обязательна — её видит подавший.'
          : 'Причина обязательна: она остаётся у заявки и её видит подавший.'
      }
    >
      <Form {...form}>
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((value) => onConfirm(value.reason.trim()))}
        >
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Причина</FormLabel>
                <FormControl>
                  <Textarea {...field} autoFocus disabled={pending} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <ActFailure message={failure} />
          <ActFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {revoke ? 'Отозвать' : 'Отклонить'}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
              Отмена
            </Button>
          </ActFooter>
        </form>
      </Form>
    </ActSection>
  )
}

// ── attaching a document (EARS-511/545) ─────────────────────────────────────

type AttachValue = { kind: FinanceDocumentKind; file: FileList | null }

/**
 * CHOOSING IS ATTACHING — there is no second control (#388 defect G): the
 * file input's `change` uploads at once. The picker is PUT AWAY until the
 * reader asks for it with «Прикрепить файл» (pre-acceptance UX pass, item 4):
 * the block above already lists the files or says «Нет файлов.», and an open
 * dropzone under it read as a step still missing. On a posted request with no
 * receipt the button wears the primary fill and carries the reason it is
 * there, because attaching is what that state waits for (EARS-545/546).
 */
function AttachDocumentForm({
  pending,
  failure,
  attached,
  emphasis,
  onAttach,
}: {
  pending: boolean
  failure?: string
  attached: number
  emphasis: boolean
  onAttach: (file: File, kind: FinanceDocumentKind) => void
}) {
  const form = useForm<AttachValue>({ defaultValues: { file: null, kind: 'fiscal_receipt' } })
  const [uploadingName, setUploadingName] = React.useState<string | null>(null)
  // Initialised, not synchronised: the sheet is re-keyed on the document
  // count, so a landed upload mounts the put-away state (#473 item 6).
  const [adding, setAdding] = React.useState(false)

  const choose = (files: FileList | null) => {
    form.clearErrors('file')
    const file = files?.[0] ?? null
    if (file === null) return
    const refusal = documentUploadRefusal(file)
    if (refusal !== null) {
      form.setError('file', { message: refusal })
      return
    }
    setUploadingName(file.name)
    onAttach(file, form.getValues('kind'))
  }

  if (!adding) {
    return (
      <div data-emphasis={emphasis ? 'primary' : 'default'} className="space-y-2">
        {emphasis ? (
          <p className="text-sm text-foreground">
            Оплата отмечена без чека. Приложите чек — отметка «без чека» уйдёт.
          </p>
        ) : null}
        <Button
          type="button"
          variant={emphasis ? 'default' : 'outline'}
          size="sm"
          onClick={() => setAdding(true)}
        >
          {attached === 0 ? 'Прикрепить файл' : 'Прикрепить ещё файл'}
        </Button>
      </div>
    )
  }

  return (
    <Form {...form}>
      <div data-emphasis={emphasis ? 'primary' : 'default'} className="grid gap-3">
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Вид документа</FormLabel>
              <KindSelect value={field.value} onChange={field.onChange} disabled={pending} />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="file"
          render={() => (
            <FormItem>
              <FormLabel>{emphasis ? 'Прикрепить чек' : 'Подтверждающий документ'}</FormLabel>
              <FormControl>
                <Input
                  type="file"
                  accept={DOCUMENT_UPLOAD_ACCEPT}
                  disabled={pending}
                  className="h-auto cursor-pointer py-1.5 file:mr-2 file:cursor-pointer file:rounded-md file:bg-secondary file:px-2 file:transition-colors hover:file:bg-secondary/70"
                  onChange={(event) => choose(event.target.files)}
                />
              </FormControl>
              <FormDescription>
                {attached === 0
                  ? 'Файл прикладывается сразу после выбора.'
                  : 'Файл прикладывается сразу после выбора и добавится к уже приложенным.'}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {pending && uploadingName !== null ? (
          <p className="text-sm text-muted-foreground" role="status">
            Загружаем «{uploadingName}»…
          </p>
        ) : null}
        {failure ? (
          <p className="text-sm text-destructive" role="alert">
            {failure}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setAdding(false)}
          >
            Не прикреплять
          </Button>
        </div>
      </div>
    </Form>
  )
}

// ── the sheet ───────────────────────────────────────────────────────────────

/**
 * THE DETAILS SHEET of the owner's payment queue (spec 339 §I EARS-542…546,
 * §J EARS-563; issue #551).
 *
 * LAYOUT is the owner-approved prototype `design-source/finance/RequestPaymentQueue.html`
 * (`fidelity: wireframe`, «Го» on BBMP-281, Антон, 2026-11-17): the request's
 * number and stage, what it is, the amount large with the original and the
 * rate under it, the facts as label / value pairs, «Как оплатить», the files,
 * the timeline, and the acts of its stage. The LOOK is the stock shadcn/Refine
 * theme (`Design-fidelity: GO — Антон, 2026-09-03`). Additions the prototype
 * does not draw, recorded in the PR's UX-record: the §J «Курс против рынка»
 * block (EARS-563), «без чека», the reimburse form and the posted operation.
 *
 * EVERY DECISION IS THE MODEL'S (`request-sheet-model.ts`), read off the
 * request's EARS-535 stage — the same one the queue groups by. The sheet
 * computes no money: the amounts, the rates and the §J figures come from the
 * server (EARS-553/563).
 *
 * THE TOKEN. Every money act carries the EARS-548 snapshot token of the LIST
 * row this sheet was opened on (lead note on #551) — the single-request read
 * does not carry one, and a request changed since is refused, verbatim, in the
 * form that sent it.
 */
export function RequestDetailsSheet({
  request,
  references,
  canApprove,
  canEnter,
  today,
  pending,
  opening,
  actFailure,
  uploading,
  uploadFailure,
  onAct,
  onAttach,
  onEdit,
  onClose,
}: {
  request: RequestBoardItem | null
  references: RequestBoardReferences
  canApprove: boolean
  canEnter: boolean
  /** Today in Moscow — the default date of a payment form. */
  today: string
  pending: boolean
  opening: SheetOpening
  /** The last act's refusal, verbatim — shown in the form that sent it. */
  actFailure?: string
  uploading: boolean
  uploadFailure?: string
  onAct: (act: RequestAct, payload?: RequestActPayload, receipt?: ActReceipt) => void
  onAttach: (file: File, kind: FinanceDocumentKind) => void
  onEdit: () => void
  onClose: () => void
}) {
  useSheetOverlayMark()
  const currency = useDisplayCurrency()
  // Initialised, not synchronised: the screen re-keys this component on the
  // request and its opening, so a row act MOUNTS the sheet with its form open.
  const [form, setForm] = React.useState<SheetForm | null>(() =>
    request === null ? null : initialSheetForm(request, opening, { canApprove }),
  )
  const [approving, setApproving] = React.useState(
    () => request !== null && opening === 'pay' && request.stage === 'decide',
  )

  if (request === null) return null

  const permissions = { canApprove, canEnter }
  const acts = sheetActs(request, { canApprove })
  const amount = sheetAmount(request, currency, references)
  const fee = sheetFee(request, references)
  const how = howToPay(request, references)
  const market = marketBlockView(request, currency, references)
  const timeline = sheetTimeline(request)
  const payee = queuePayee(request)
  // The SAME identifying line as the queue row (review of #564, UX 4): what the
  // author wrote — the note's first line — else the purpose. When the note
  // took the heading, the purpose follows it as the secondary line; the
  // author's words stay in full under «Комментарий».
  const heading = queueRowTitle(request)
  const purpose = requestPurposeLabel(request)
  const secondary = heading.title === purpose || purpose === '—' ? null : purpose
  const noReceipt = lacksReceipt(request)
  const mayAttach = mayAttachDocument(request, permissions)

  const money = (value: { amount: string; currency: string }) =>
    formatOriginalMoney(
      value.amount,
      value.currency,
      currencyPrecision(references.currencies, value.currency),
    )
  // While a payment form is open its own «Чек или скриншот оплаты» is the one
  // upload control (review of #564, UX 2): two pickers at once leave the
  // owner guessing which one counts.
  const paymentFormOpen = form === 'mark-paid' || form === 'mark-reimbursed'

  const start = (act: SheetAct) => {
    const next = sheetFormOf(act)
    if (next !== null) {
      setApproving(act === 'approve-and-pay')
      setForm(next)
      return
    }
    if (act === 'edit') onEdit()
    else if (act === 'approve' || act === 'submit' || act === 'cancel') onAct(act)
  }

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader className="gap-1 pr-12">
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <span>{sheetMeta(request)}</span>
            {noReceipt ? <Badge variant="outline">без чека</Badge> : null}
            {request.purpose === null && request.proposal ? (
              <Badge variant="destructive">назначение ждёт админа</Badge>
            ) : null}
          </SheetDescription>
          <SheetTitle className="font-heading text-xl font-semibold tracking-tight break-words">
            {heading.title}
          </SheetTitle>
          {secondary === null ? null : (
            <p className="text-sm break-words text-muted-foreground">{secondary}</p>
          )}
          <div className="pt-2">
            <p className="font-heading text-3xl font-semibold tracking-tight tabular-nums">
              {amount.main}
            </p>
            {amount.note === null ? null : (
              <p className="text-sm text-muted-foreground">{amount.note}</p>
            )}
            {fee === null ? null : <p className="text-sm text-muted-foreground">{fee}</p>}
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3">
              <XIcon />
              <span className="sr-only">Закрыть</span>
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-4">
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <Fact label="От кого">{request.createdByName ?? '—'}</Fact>
            <Fact label="Кому платим">
              {payee.name}
              {payee.paidSelf ? (
                <span className="block text-muted-foreground">заплатил(а) сам(а)</span>
              ) : null}
            </Fact>
            <Fact label="Проект">
              {request.project.name}
              {request.product === null ? '' : ` · ${request.product.name}`}
            </Fact>
            {request.note ? <Fact label="Комментарий">{request.note}</Fact> : null}
            {request.sourceRef === null ? null : (
              <Fact label="Источник">
                <RequestSourceLink request={request} />
              </Fact>
            )}
            {request.refusalReason ? (
              <Fact label="Причина отказа">{request.refusalReason}</Fact>
            ) : null}
          </dl>

          {how === null ? null : (
            <Section title="Как оплатить">
              {how.kind === 'reimburse' ? (
                <Alert role="status">
                  <AlertDescription>
                    <p>
                      {how.member} заплатил(а)
                      {how.paidOn === null ? '' : ` ${formatDate(how.paidOn)}`} из своих денег.{' '}
                      {how.refund.kind === 'fixed'
                        ? `${how.booked ? 'Долг записан, вернуть' : 'Вернуть'}: ${money(how.refund.due)}.`
                        : how.refund.same === null
                          ? 'Вернуть: сумму, фактически списанную с карты, — в валюте счёта возврата.'
                          : `Вернуть: ${money(how.refund.same)} со счёта в ${how.refund.same.currency}; со счёта в другой валюте — сумму, фактически списанную с карты.`}
                    </p>
                    {how.refund.original === null ||
                    (how.refund.kind === 'by-account' && how.refund.same !== null) ? null : (
                      <p className="text-xs">заявлено {money(how.refund.original)}</p>
                    )}
                  </AlertDescription>
                </Alert>
              ) : how.kind === 'paid' ? (
                <Alert role="status">
                  <AlertDescription>
                    Уже оплачено{how.paidOn === null ? '' : ` ${formatDate(how.paidOn)}`} — осталось
                    отметить оплату.
                  </AlertDescription>
                </Alert>
              ) : how.kind === 'details' ? (
                <Alert role="status">
                  <AlertDescription>
                    {how.source === 'note'
                      ? 'Реквизиты есть в комментарии к заявке.'
                      : 'Реквизиты — в приложенном документе.'}
                  </AlertDescription>
                </Alert>
              ) : (
                // A quiet inline note, not an error box louder than the acts
                // (pre-acceptance UX pass, item 5). The ask goes where the
                // request was filed — its thread — when there is one.
                <p role="status" className="text-sm text-muted-foreground">
                  <span className="text-foreground">Реквизитов или ссылки на оплату нет</span>
                  {' · '}
                  {request.sourceUrl === null ? (
                    <span>Запросить у автора — {request.createdByName ?? 'подавшего заявку'}</span>
                  ) : (
                    <>
                      <Button asChild variant="link" className="h-auto p-0 align-baseline">
                        <a href={request.sourceUrl} target="_blank" rel="noopener noreferrer">
                          Запросить у автора
                        </a>
                      </Button>
                      {request.createdByName ? ` — ${request.createdByName}` : null}
                    </>
                  )}
                </p>
              )}
            </Section>
          )}

          {market === null ? null : (
            <Section title="Курс против рынка">
              {market.kind === 'note' ? (
                <MarketNote text={market.text} />
              ) : (
                <div className="space-y-2">
                  <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                    {market.lines.map((line) => (
                      <Fact key={line.label} label={line.label}>
                        <span
                          className={cn(
                            'font-medium tabular-nums',
                            line.label === 'Переплата' && 'text-base',
                          )}
                        >
                          {line.value}
                        </span>
                        {line.note === '' ? null : (
                          <span className="block text-muted-foreground">{line.note}</span>
                        )}
                      </Fact>
                    ))}
                  </dl>
                  {market.pending === null ? null : (
                    <p className="text-sm text-muted-foreground">{market.pending}</p>
                  )}
                </div>
              )}
            </Section>
          )}

          <Section title="Файлы">
            {request.documents.length > 0 ? (
              request.documents.map((document) => (
                <div key={document.id} className="space-y-1.5">
                  <p className="text-sm break-all text-foreground">
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
                        className="text-sm break-all underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        Скачать {document.filename}
                      </a>
                    </object>
                  ) : (
                    <a
                      href={documentHref(document.id, false)}
                      className="inline-block text-sm break-all underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      Скачать {document.filename}
                    </a>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                {request.hasDocument
                  ? 'Документ виден подавшему заявку и финансовой роли.'
                  : emptyDocumentNote(request, canEnter, canApprove)}
              </p>
            )}
            {mayAttach && !paymentFormOpen ? (
              <AttachDocumentForm
                key={request.documents.length}
                pending={uploading}
                failure={uploadFailure}
                attached={request.documents.length}
                emphasis={noReceipt}
                onAttach={onAttach}
              />
            ) : null}
          </Section>

          <Section title="Ход заявки">
            <ol className="space-y-1.5 text-sm">
              {timeline.map((step) => (
                <li key={step.label} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full border',
                      step.done ? 'border-foreground bg-foreground' : 'border-muted-foreground',
                    )}
                  />
                  <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>
                    <span className="font-medium">{step.label}</span> · {step.detail}
                    <span className="sr-only">{step.done ? ' (сделано)' : ' (впереди)'}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          {request.status === 'posted' && request.operation ? (
            <Section
              title={`Проводка №${request.operation.id} · ${formatDate(request.operation.occurredOn)}`}
            >
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {request.operation.postings.map((posting, index) => (
                  <li key={index} className="tabular-nums">
                    {posting.accountName} ·{' '}
                    {formatRequestMoney(
                      posting.amount,
                      posting.currency,
                      currencyPrecision(references.currencies, posting.currency),
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {form === 'mark-paid' ? (
            <MarkPaidSection
              request={request}
              references={references}
              today={today}
              approving={approving}
              pending={pending}
              failure={actFailure}
              onConfirm={(payload, receipt) => onAct('mark-paid', payload, receipt)}
              onCancel={() => setForm(null)}
            />
          ) : form === 'mark-reimbursed' ? (
            <ReimburseSection
              request={request}
              references={references}
              today={today}
              pending={pending}
              failure={actFailure}
              onConfirm={(payload, receipt) => onAct('mark-reimbursed', payload, receipt)}
              onCancel={() => setForm(null)}
            />
          ) : form === 'refuse' || form === 'revoke' ? (
            <ReasonSection
              revoke={form === 'revoke'}
              pending={pending}
              failure={actFailure}
              onConfirm={(reason) => onAct('refuse', { reason })}
              onCancel={() => setForm(null)}
            />
          ) : null}
        </div>

        {form !== null || acts.length === 0 ? null : (
          <SheetFooter className="flex-row flex-wrap items-center gap-2">
            {acts.map((button) => (
              <Button
                key={button.act}
                variant={button.variant}
                disabled={pending}
                onClick={() => start(button.act)}
              >
                {button.label}
              </Button>
            ))}
          </SheetFooter>
        )}
        {form === null && actFailure !== undefined ? (
          <div className="px-4 pb-4">
            <ActFailure message={actFailure} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
