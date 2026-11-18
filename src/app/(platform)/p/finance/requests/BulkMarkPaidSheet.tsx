'use client'

import React from 'react'
import { useForm } from 'react-hook-form'

import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/ui/form'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/ui/sheet'

import { formatDate, ownerFacingText } from './constants'
import { useDisplayCurrency } from './display-currency-store'
import type { RequestBoardItem, RequestBoardReferences } from './request-board-contract'
import {
  formatDisplayMoney,
  missingRateNote,
  QUEUE_GROUPS,
  queuePayee,
  queueRowTitle,
  requestCountLabel,
  sumInDisplay,
} from './request-queue-model'
import {
  bulkConfirmLabel,
  bulkPlannedRows,
  bulkTitle,
  toBulkBody,
  type BulkBody,
  type BulkGroup,
  type BulkPreview,
} from './request-sheet-model'
import { useSheetOverlayMark } from './sheet-overlay'

type BulkValue = { accountId: string; occurredOn: string }

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; preview: BulkPreview }
  | { kind: 'failed'; message: string }

/**
 * «Отметить все N как оплаченные…» («…как возвращённые…» on «Вернуть
 * сотруднику») — the bulk retroactive act's confirmation (spec 339
 * EARS-547/548, #551).
 *
 * THE SCREEN'S ONE OVERLAY SHAPE. The issue says «dialog»; this screen runs
 * every act through a `Sheet` (`docs/design/ui-whitelist.md` → «One overlay
 * shape per screen»), so the confirmation is a sheet too — the same footer
 * grammar as the details sheet's acts.
 *
 * NOTHING POSTS UNTIL THE EXPLICIT CONFIRM. Choosing the account (and,
 * optionally, one date) asks the server for the PLAN — `preview: true` writes
 * nothing — and the sheet shows it: what will post, at which date, oldest
 * first, and every row left out with the posting gate's own reason. The
 * confirm sends the same explicit rows with the tokens the list showed; a row
 * changed since fails the whole batch (EARS-548), and the refusal is shown
 * here verbatim. Cancelling posts nothing.
 */
export function BulkMarkPaidSheet({
  group,
  rows,
  references,
  pending,
  failure,
  onPreview,
  onConfirm,
  onClose,
}: {
  group: BulkGroup
  rows: RequestBoardItem[]
  references: RequestBoardReferences
  pending: boolean
  failure?: string
  onPreview: (body: BulkBody) => Promise<BulkPreview>
  onConfirm: (body: BulkBody) => void
  onClose: () => void
}) {
  useSheetOverlayMark()
  const currency = useDisplayCurrency()
  const form = useForm<BulkValue>({ defaultValues: { accountId: '', occurredOn: '' } })
  const [state, setState] = React.useState<PreviewState>({ kind: 'idle' })
  const asked = React.useRef(0)

  const preview = (value: BulkValue) => {
    if (value.accountId === '') return
    const ticket = ++asked.current
    setState({ kind: 'loading' })
    onPreview(
      toBulkBody(
        group,
        rows,
        { accountId: Number(value.accountId), occurredOn: value.occurredOn },
        true,
      ),
    )
      .then((answer) => {
        if (ticket === asked.current) setState({ kind: 'ready', preview: answer })
      })
      .catch((cause: unknown) => {
        if (ticket !== asked.current) return
        setState({
          kind: 'failed',
          message: cause instanceof Error ? cause.message : 'Не удалось получить план отметки.',
        })
      })
  }

  const planned = state.kind === 'ready' ? bulkPlannedRows(state.preview, rows) : []
  const excluded = state.kind === 'ready' ? state.preview.excluded : []
  const sum = sumInDisplay(
    planned.map((row) => row.request),
    currency,
  )
  const missing = missingRateNote(sum.missing)
  const byId = new Map(rows.map((row) => [row.id, row]))

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="gap-1 pr-12">
          <SheetTitle className="font-heading text-xl font-semibold tracking-tight">
            {bulkTitle(rows.length, group)}
          </SheetTitle>
          <SheetDescription>
            «{QUEUE_GROUPS[group].title}»: одним актом, с одного счёта, без чеков — чеки
            прикладываются потом к каждой заявке.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-4">
          <Form {...form}>
            <div className="grid gap-4">
              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Счёт пакета</FormLabel>
                    <Select
                      value={field.value === '' ? undefined : field.value}
                      disabled={pending}
                      onValueChange={(next) => {
                        field.onChange(next)
                        preview({ ...form.getValues(), accountId: next })
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue placeholder="Выберите счёт" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {references.accounts.map((account) => (
                          <SelectItem key={account.id} value={String(account.id)}>
                            {account.name} · {account.currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Заявки в другой валюте пакет не отметит — им нужна своя списанная сумма.
                    </FormDescription>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="occurredOn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Одна дата для всех (необязательно)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="date"
                        disabled={pending}
                        onChange={(event) => {
                          field.onChange(event)
                          preview({ ...form.getValues(), occurredOn: event.target.value })
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Пусто — у каждой заявки своя: дата траты, иначе дата подачи.
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>
          </Form>

          {state.kind === 'idle' ? (
            <p className="text-sm text-muted-foreground">
              Выберите счёт — покажем, что отметится и что останется.
            </p>
          ) : state.kind === 'loading' ? (
            <p role="status" className="text-sm text-muted-foreground">
              Проверяем заявки…
            </p>
          ) : state.kind === 'failed' ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : (
            <>
              <section aria-label="Будет отмечено" className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">
                    Будет отмечено: {requestCountLabel(planned.length)}
                  </h3>
                  {planned.length === 0 ? null : (
                    <span className="text-sm font-medium tabular-nums">
                      {sum.amount === null ? '—' : formatDisplayMoney(sum.amount, currency)}
                      {missing === null ? null : (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {missing}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {planned.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Нечего отметить этим счётом.</p>
                ) : (
                  <ol className="divide-y text-sm">
                    {planned.map(({ request, occurredOn }) => {
                      const shown = request.display[currency]
                      // The row WRAPS rather than truncates (review of #564,
                      // UX 3): on a phone «№16 · [see…» identifies nothing.
                      return (
                        <li key={request.id} className="flex items-baseline gap-3 py-1.5">
                          <span className="min-w-0 flex-1 break-words">
                            №{request.id} · {queueRowTitle(request).title}
                            <span className="block text-muted-foreground">
                              <span className="tabular-nums">{formatDate(occurredOn)}</span> ·{' '}
                              {queuePayee(request).name}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {shown.kind === 'converted'
                              ? formatDisplayMoney(BigInt(shown.amount), currency)
                              : 'нет курса'}
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>
              {excluded.length === 0 ? null : (
                <section aria-label="Не войдут в пакет" className="space-y-2">
                  <h3 className="text-sm font-medium">
                    Не войдут: {requestCountLabel(excluded.length)}
                  </h3>
                  <ul className="space-y-2 text-sm">
                    {excluded.map((row) => (
                      <li key={row.id}>
                        <span className="font-medium">
                          №{row.id}
                          {byId.has(row.id) ? ` · ${queueRowTitle(byId.get(row.id)!).title}` : ''}
                        </span>
                        <span className="block text-muted-foreground">
                          {ownerFacingText(row.reason)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {failure === undefined ? null : (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}
        </div>

        <SheetFooter className="flex-row flex-wrap items-center gap-2">
          <Button
            disabled={pending || state.kind !== 'ready' || planned.length === 0}
            onClick={() => {
              const value = form.getValues()
              onConfirm(
                toBulkBody(
                  group,
                  rows,
                  { accountId: Number(value.accountId), occurredOn: value.occurredOn },
                  false,
                ),
              )
            }}
          >
            {pending ? 'Отмечаем…' : bulkConfirmLabel(planned.length, group)}
          </Button>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Отмена
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
