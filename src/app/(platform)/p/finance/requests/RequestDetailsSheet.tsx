'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { XIcon } from 'lucide-react'
import React from 'react'
import { useForm } from 'react-hook-form'

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
import { Label } from '@/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
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
import { cn } from '@/ui/utils'

import {
  documentHref,
  DOCUMENT_KIND_LABELS,
  formatDate,
  isInlineReadable,
  REQUEST_STATUS_LABELS,
} from './constants'
import type { RequestBoardItem, RequestBoardReferences } from './request-board-contract'
import { useSheetOverlayMark } from './sheet-overlay'
import {
  canAttachDocument,
  currencyPrecision,
  DOCUMENT_UPLOAD_ACCEPT,
  documentUploadRefusal,
  emptyDocumentNote,
  formatRequestMoney,
  postingActNeedsMoneyFacts,
} from './request-board-model'
import type { FinanceRequestBoardAct } from './request-board-model'
import {
  createPostingFormSchema,
  postingFormDefaults,
  toPostingBody,
  type PostingFormValue,
} from './request-form-model'

export type RequestAct = FinanceRequestBoardAct | 'submit' | 'cancel'

/**
 * What an act carries besides its name.
 *
 * `reason` is EARS-512's mandatory refusal reason; the four money fields are
 * EARS-533's — the facts a request cannot know, entered by the finance role in
 * the same act that posts. They travel WITH the act rather than as a prior
 * edit, which is what keeps the write inside the posting transaction (the
 * status machine's one sanctioned in-`approved` write).
 */
export type RequestActPayload = {
  reason?: string
  accountId?: number | null
  occurredOn?: string
  paidAmount?: string | null
  paidCurrency?: string | null
}

/**
 * One read-only fact of the request.
 *
 * THE VALUE WRAPS, IT NEVER TRUNCATES. A field here carries the STATE, not a
 * label the reader can guess from context — «вводится при проведении» clipped
 * to «вводится при пр…» takes away exactly the sentence the field exists to
 * say, and «Операционные расходы» clipped to «Операционные …» stops naming
 * which расходы. An extra line is cheap; a half-said state is not (stage-5 UX
 * sanity pass on #388, steps 26 and 30; the desktop half of the same clipping
 * is #473 item 3, and it is the same line of CSS).
 */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="text-sm break-words text-foreground">{value ?? '—'}</p>
    </div>
  )
}

/**
 * AN ACT OPENED FROM THIS SCREEN — as a SECTION of the details sheet, never as
 * a second overlay (owner go, Антон, 2026-09-15, #388; the rule is
 * `docs/design/ui-whitelist.md` → «One overlay shape per screen»).
 *
 * WHY IT CAN LOOK LIKE A MODAL WITHOUT BEING ONE. What a modal gave this screen
 * was three things: the act is named, the act's own fields are separated from
 * the record, and the reader's attention moves to it. A bordered, titled
 * section inside the same sheet gives all three — and does not give the fourth
 * thing the owner objected to, a second footer grammar. Attention is moved
 * explicitly: the section takes focus and scrolls itself into view on mount,
 * which is what the previous `Dialog` did for free.
 */
function ActSection({
  label,
  title,
  description,
  children,
}: {
  label: string
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
      aria-label={label}
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

/**
 * The act's own action row — the SAME grammar as `SheetFooter`'s: the primary
 * act first, its way out beside it, both on one line. That sameness is the
 * whole point of the rule this section exists to satisfy.
 */
function ActFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-row flex-wrap items-center gap-2 pt-1">{children}</div>
}

type AttachValue = { file: FileList | null; kind: FinanceDocumentKind }

/**
 * Attaching the confirming document — the act that turns an authorised spend
 * into a postable one (EARS-511), and the reason spec 339's acceptance
 * scenario 3 can be walked from this screen at all.
 *
 * CHOOSING IS ATTACHING — there is no second control (#388 defect G, owner on
 * the live stand 2026-09-16). This block used to end in an `outline` button
 * «Приложить документ»: picking a file changed nothing a reader could read as
 * «attached» — the empty-state line still said «Документ не приложен.», the
 * gate Alert stayed, and the only committing control sat INSIDE the dashed
 * block, secondary next to the footer's acts. The owner picked a PNG, read the
 * sheet as done, found no «Провести», and reported the screen as unable to
 * post. The transport had been fine the whole time; the composition lied. A
 * louder button would only have decorated that lie, so the button is gone: the
 * file input's `change` runs the same path (`documentUploadRefusal` → upload)
 * immediately, and no half-chosen state exists to misread. Every line the block
 * shows is then TRUE at the moment it is shown.
 *
 * COMPOSITION. It sits INSIDE the document section, under the reading pane, and
 * not in the footer: attaching is not a decision about the request, it is what
 * the document block is for. The kind comes FIRST — it is DATA the upload
 * carries (EARS-515), not a gate, but the file's `change` is now the commit, so
 * a select standing after the picker would be a question asked too late.
 *
 * THE SERVER IS THE GATE. `documentUploadRefusal` only spares the reader an
 * upload that `POST /p/finance/api/documents` would refuse anyway (EARS-514);
 * a refusal the client did not foresee comes back from the server and lands
 * under the same field, with the toast on the one notification channel. Either
 * way the picker comes back live — a refused pick is repeated, not mourned.
 */
function AttachDocumentForm({
  pending,
  failure,
  attached,
  emphasis,
  gateNote,
  onAttach,
}: {
  pending: boolean
  failure?: string
  attached: number
  /**
   * `primary` where attaching is what the STATE is waiting for — an approved
   * request with no document (#473 item 5). The block then carries the reason
   * it is waiting and the picker wears the primary fill, because the only
   * other control of that state is the destructive «Отклонить…» and a screen
   * whose strongest control is the one nobody should press by default is
   * composed backwards.
   */
  emphasis: 'primary' | 'default'
  /** The sentence that explains the wait — shown HERE, and then nowhere else. */
  gateNote?: string
  onAttach: (file: File, kind: FinanceDocumentKind) => void
}) {
  const form = useForm<AttachValue>({
    defaultValues: { file: null, kind: 'fiscal_receipt' },
  })
  // The file whose bytes are in flight — what the block says out loud while it
  // waits. It is read only under `pending`, so it needs no clearing.
  const [uploadingName, setUploadingName] = React.useState<string | null>(null)
  /**
   * IS THE PICKER OUT? (#473 item 6.)
   *
   * Choosing is attaching, and the picker used to stay live after the upload
   * landed — so a second click on a sheet that already showed the receipt
   * attached the same file again, silently. Request #69 on the #388 stand
   * carries two `receipt-388.pdf` for exactly that reason. A second document
   * is legitimate (a receipt AND an invoice), so the block does not forbid
   * one: it puts the picker away, says what is already there, and asks.
   *
   * Initialised, not synchronised — the caller re-keys this component on the
   * document count, so a landed upload MOUNTS the collapsed state instead of
   * correcting itself in an effect.
   */
  const [adding, setAdding] = React.useState(attached === 0)

  const choose = (files: FileList | null) => {
    form.clearErrors('file')
    form.setValue('file', files)
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

  return (
    <section
      aria-label="Приложить документ"
      data-emphasis={emphasis}
      className={cn(
        'space-y-3 rounded-lg border p-3',
        emphasis === 'primary' ? 'border-primary/40 bg-primary/5' : 'border-dashed',
      )}
    >
      {gateNote === undefined ? null : <p className="text-sm text-foreground">{gateNote}</p>}
      {adding ? null : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Документ уже приложен — он читается выше. Второй файл ДОБАВИТСЯ к нему, а не заменит
            его.
          </p>
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            Приложить ещё документ
          </Button>
        </div>
      )}
      {adding ? (
        <Form {...form}>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Вид документа</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={pending}>
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(DOCUMENT_KIND_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="file"
                render={() => (
                  <FormItem>
                    <FormLabel>Подтверждающий документ</FormLabel>
                    <FormControl>
                      <Input
                        type="file"
                        accept={DOCUMENT_UPLOAD_ACCEPT}
                        disabled={pending}
                        // The picker IS the act here, so where the state is
                        // waiting for it, it wears the primary fill (#473 item 5).
                        className={cn(
                          'h-auto cursor-pointer py-1.5 file:mr-2 file:cursor-pointer file:rounded-md file:px-2 file:transition-colors',
                          emphasis === 'primary'
                            ? 'file:bg-primary file:text-primary-foreground hover:file:bg-primary/80'
                            : 'file:bg-secondary hover:file:bg-secondary/70',
                        )}
                        onChange={(event) => choose(event.target.files)}
                      />
                    </FormControl>
                    <FormDescription>Файл прикладывается сразу после выбора.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
          </div>
        </Form>
      ) : null}
    </section>
  )
}

/**
 * «Провести» — the POSTING act's own three questions (EARS-533).
 *
 * ONE OVERLAY SHAPE, AND IT IS THE SHEET (owner go, Антон, 2026-09-15, #388;
 * the rule itself is `docs/design/ui-whitelist.md` → «One overlay shape per
 * screen»). This used to be a `Dialog` opened from inside a `Sheet`, and the
 * owner read the result as two different footers for the same kind of act —
 * `DialogFooter` and `SheetFooter` stack and align differently in the stock
 * kit. It is now a SECTION of the details sheet: same surface, same footer
 * grammar, one Escape.
 *
 * STILL AN ACT, NOT AN EDIT. A request is an intent (owner ruling, Антон,
 * 2026-09-03), so the paying account and the date money moved are not
 * properties of the request — they are what the finance role asserts in the act
 * of posting. They therefore appear only once the act is STARTED, in the act's
 * own section, never as editable fields standing on an approved card.
 *
 * WHAT IT ASKS AND WHAT IT DOES NOT. The account, unless the spend was made
 * from the member's own card (EARS-513 — then there is no company account to
 * name, and the field is absent rather than disabled); the date; and the
 * account-side amount only where the chosen account is in another currency than
 * the document — which is why the schema is rebuilt as the account changes.
 * Everything the request already said is NOT re-asked (EARS-511).
 */
function PostingSection({
  request,
  references,
  act,
  pending,
  onConfirm,
  onCancel,
}: {
  request: RequestBoardItem
  references: RequestBoardReferences
  act: FinanceRequestBoardAct
  pending: boolean
  onConfirm: (payload: RequestActPayload) => void
  onCancel: () => void
}) {
  const schema = React.useMemo(
    () => createPostingFormSchema(references, request),
    [references, request],
  )
  const form = useForm<PostingFormValue>({
    resolver: zodResolver(schema),
    defaultValues: postingFormDefaults(references, request),
    mode: 'onSubmit',
  })
  const accountId = form.watch('accountId')
  const account = references.accounts.find((row) => String(row.id) === accountId) ?? null
  const crossCurrency = account !== null && account.currency !== request.currency

  return (
    <ActSection
      label={`Провести заявку №${request.id}`}
      title={`Провести заявку №${request.id}`}
      description={
        act === 'approve'
          ? 'Одобрение и проводка одним актом: назовите, откуда и когда ушли деньги.'
          : 'Заявка была намерением. Назовите, откуда и когда деньги ушли на самом деле.'
      }
    >
      <Form {...form}>
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((value) =>
            onConfirm(toPostingBody(value, references, request)),
          )}
        >
          {request.personalFunds ? (
            <Alert role="status">
              <AlertDescription>
                Оплачено своими средствами: счёта компании у этой траты нет — встречной ногой станет
                обязательство перед участником.
              </AlertDescription>
            </Alert>
          ) : (
            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Счёт списания</FormLabel>
                  <Select
                    value={field.value === '' ? undefined : field.value}
                    disabled={pending}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full min-w-0">
                        <SelectValue placeholder="Выберите счёт" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent data-bbm-ui>
                      {references.accounts.map((row) => (
                        <SelectItem key={row.id} value={String(row.id)}>
                          {row.name} · {row.currency}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="occurredOn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Дата движения денег</FormLabel>
                <FormControl>
                  <Input {...field} type="date" disabled={pending} />
                </FormControl>
                <FormDescription>
                  День, когда деньги действительно ушли, — не дата документа.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {crossCurrency ? (
            <FormField
              control={form.control}
              name="paidAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Списано со счёта, {account.currency}</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" disabled={pending} placeholder="0,00" />
                  </FormControl>
                  <FormDescription>
                    Счёт в {account.currency}, документ в {request.currency} — нужна фактически
                    списанная сумма.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          <ActFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Проводим…' : 'Провести'}
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
 * ledger is immutable; a pre-spend request shows «вводится при проведении» in
 * place of the account and the date it genuinely does not have (EARS-533 —
 * «no surface shall render either emptiness as a value»), and the act that
 * posts asks for them in its own dialog; and the missing document is not merely REPORTED but
 * fixable here — «Приложить документ» (EARS-511) sits in the document block for
 * everyone allowed to add one, which is what lets the pre-spend path reach
 * `posted` without leaving the screen.
 */
export function RequestDetailsSheet({
  request,
  references,
  canApprove,
  canEnter,
  pending,
  pendingAct,
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
  pending: boolean
  pendingAct: RequestAct | null
  uploading: boolean
  uploadFailure?: string
  onAct: (act: RequestAct, payload?: RequestActPayload) => void
  onAttach: (file: File, kind: FinanceDocumentKind) => void
  onEdit: () => void
  onClose: () => void
}) {
  // Initialised, not synchronised: the screen re-keys this component on
  // `${request.id}-${pendingAct}`, so a drag onto «Отклонены» opens the reason
  // dialog by MOUNTING with it open. An effect that pushed `pendingAct` into
  // state would render the sheet once without it and then correct itself — a
  // flash, and `react-hooks/set-state-in-effect`.
  // An overlay owns the bottom of the screen while this sheet is up, so the
  // notification channel steps over its footer (#473 item 1).
  useSheetOverlayMark()
  const [refusing, setRefusing] = React.useState(pendingAct === 'refuse')
  const [reason, setReason] = React.useState('')
  const [reasonError, setReasonError] = React.useState<string | null>(null)
  // Same «initialised, not synchronised» rule as the refusal dialog above: a
  // drag onto «Проведены» mounts this component with the posting act already
  // chosen, so its dialog opens with the sheet rather than after it.
  const [posting, setPosting] = React.useState<FinanceRequestBoardAct | null>(
    request !== null &&
      (pendingAct === 'confirm' || pendingAct === 'approve') &&
      postingActNeedsMoneyFacts(request, pendingAct)
      ? pendingAct
      : null,
  )

  if (request === null) return null

  /**
   * An act that POSTS and finds the money facts missing asks for them first
   * (EARS-533); every other act runs straight away. The board never sends the
   * facts with an act that only authorises — the server refuses them there.
   */
  const startAct = (act: FinanceRequestBoardAct) => {
    if (postingActNeedsMoneyFacts(request, act)) setPosting(act)
    else onAct(act)
  }

  const preSpendPending = request.occurredOn === null
  const undecidedMoney = <span className="text-muted-foreground">вводится при проведении</span>

  const precision = currencyPrecision(references.currencies, request.currency)
  const hasDocument = request.documents.length > 0
  /**
   * THE STATE THAT IS WAITING FOR A DOCUMENT (#473 item 5) — approved, nothing
   * attached. Its next step is attaching, and that is what the document block
   * is given the weight for; the sentence explaining the wait lives in that
   * block, and the standalone Alert below is only for the reader who may NOT
   * attach and can therefore only read the explanation.
   */
  const awaitingDocument = request.status === 'approved' && !hasDocument
  const mayAttach = canAttachDocument(request, canEnter)
  const documentGateNote =
    'Без подтверждающего документа карточка отсюда не уезжает: одобрение уже авторизовало ' +
    'трату, проводка появится одним актом на приложенном документе.'
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
          {/* THE TITLE IS A VALUE TOO (#473 item 3). It carries the request's
              note, which is free text of any length, and the register above
              clips its own free-text column precisely because «the full text
              is one «Открыть» away» — a promise this line has to keep. */}
          <SheetTitle className="font-heading text-xl font-semibold tracking-tight break-words tabular-nums">
            {formatRequestMoney(request.amount, request.currency, precision)}
            {request.note ? ` — ${request.note}` : ''}
          </SheetTitle>
          <SheetDescription>
            {[
              request.createdByName,
              request.occurredOn === null
                ? 'деньги ещё не двигались'
                : `деньги ушли ${formatDate(request.occurredOn)}`,
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
          {/* One column below `sm`: the sheet is `w-full` there, so two columns
              leave ~180 px a cell on a 390 px screen and the longest values are
              precisely the ones that carry the state. Two columns from `sm` up,
              where the sheet is `sm:max-w-lg` and the pairing reads. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Контрагент" value={request.counterparty?.name ?? '—'} />
            <Field
              label="Счёт списания"
              value={
                request.personalFunds
                  ? 'Свои средства участника'
                  : request.account !== null
                    ? request.account.name
                    : preSpendPending
                      ? undecidedMoney
                      : '—'
              }
            />
            <Field
              label="Дата движения денег"
              value={request.occurredOn === null ? undecidedMoney : formatDate(request.occurredOn)}
            />
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
                  {/* A filename is the one value with no spaces to wrap at,
                      so it breaks inside the word rather than pushing the
                      reading pane sideways (#473 item 3). */}
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
                {emptyDocumentNote(request, canEnter, canApprove)}
              </p>
            )}
            {mayAttach ? (
              <AttachDocumentForm
                // A LANDED document remounts the block: the count has just
                // grown, so the picker puts itself away with no effect to
                // notice the upload finished (#473 item 6).
                key={request.documents.length}
                pending={uploading}
                failure={uploadFailure}
                attached={request.documents.length}
                emphasis={awaitingDocument ? 'primary' : 'default'}
                gateNote={awaitingDocument ? documentGateNote : undefined}
                onAttach={onAttach}
              />
            ) : null}
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

          {/* The same sentence, for the reader who can only READ it: an
              approver without the entry role is offered no attach block, so
              the explanation has nowhere else to live. Never both — one
              string in two slots is the defect #473 item 7 closed. */}
          {canApprove && awaitingDocument && !mayAttach ? (
            <Alert role="status">
              <AlertDescription>{documentGateNote}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        {posting === null ? null : (
          <PostingSection
            request={request}
            references={references}
            act={posting}
            pending={pending}
            onConfirm={(payload) => onAct(posting, payload)}
            onCancel={() => setPosting(null)}
          />
        )}

        {refusing ? (
          <ActSection
            label="Отклонить заявку"
            title="Отклонить заявку"
            description="Причина обязательна: она остаётся у заявки и её видит подавший."
          >
            <div className="space-y-2">
              <Label htmlFor="refusal-reason">Причина отказа</Label>
              <Textarea
                id="refusal-reason"
                autoFocus
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
            <ActFooter>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  if (reason.trim() === '') {
                    setReasonError('Укажите причину отказа.')
                    return
                  }
                  onAct('refuse', { reason: reason.trim() })
                }}
              >
                Отклонить заявку
              </Button>
              <Button variant="outline" onClick={() => setRefusing(false)}>
                Отмена
              </Button>
            </ActFooter>
          </ActSection>
        ) : null}

        <SheetFooter className="flex-row flex-wrap items-center gap-2">
          {canApproveNow ? (
            <Button disabled={pending} onClick={() => startAct('approve')}>
              Одобрить
            </Button>
          ) : null}
          {canConfirm ? (
            <Button disabled={pending} onClick={() => startAct('confirm')}>
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
      </SheetContent>
    </Sheet>
  )
}
