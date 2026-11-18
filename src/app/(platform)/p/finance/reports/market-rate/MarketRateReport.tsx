'use client'

import type { HttpError } from '@refinedev/core'
import { useTable } from '@refinedev/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'

import type {
  MarketReport,
  MarketReportItem,
  MarketReportPeriodKey,
  MarketReportRow,
} from '@/lib/finance/fx/market-report'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { DataTable } from '@/ui/refine-ui/data-table/data-table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs'
import { cn } from '@/ui/utils'

import { formatDate } from '../../requests/constants'
import type { DisplayCurrencyCode } from '../../requests/request-board-contract'
import {
  DISPLAY_CURRENCIES,
  DISPLAY_CURRENCY_STORAGE_KEY,
  formatOriginalMoney,
  parseStoredDisplayCurrency,
} from '../../requests/request-queue-model'
import {
  formatMoney,
  formatOverpayment,
  hasSum,
  headline,
  keepInitialsTogether,
  leftOutNotes,
  measuredLabel,
  monthLabel,
  periodHref,
  requestHref,
  wordingVariant,
} from './market-rate-view'

/**
 * `/p/finance/reports/market-rate` «Курс против рынка» (spec 339 §J,
 * EARS-564…566; issue #559). The server built the whole report, in each
 * display currency; this screen only chooses which one to show and formats it.
 *
 * The display currency is the requests queue's remembered choice (EARS-549,
 * #550) — the same storage key, so switching here switches there.
 */
export type MarketRateReportProps = {
  report: MarketReport
  period: MarketReportPeriodKey
  periods: readonly { value: MarketReportPeriodKey; label: string }[]
  /** `core.finance_currency.precision` by code, for the original amounts. */
  precisions: Record<string, number>
}

/** The resource name the List block's Refine hook is keyed on; it reads nothing. */
export const MARKET_RATE_RESOURCE = 'finance-market-rate'

// ── the remembered display currency (EARS-549/566) ──────────────────────────

const currencyListeners = new Set<() => void>()

function readStoredCurrency(): string | null {
  try {
    return window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredCurrency(next: DisplayCurrencyCode): void {
  try {
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, next)
  } catch {
    // The choice holds for this visit; only its memory is refused.
  }
  for (const listener of currencyListeners) listener()
}

function subscribeStoredCurrency(listener: () => void): () => void {
  currencyListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    currencyListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

const serverStoredCurrency = () => null

// ── the phone layout ────────────────────────────────────────────────────────

/** Below the kit's mobile breakpoint (768 px) a row is one stacked cell. */
function subscribeNarrow(listener: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia('(max-width: 767px)')
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

function readNarrow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches
}

// ── cells ────────────────────────────────────────────────────────────────────

function Wording({ percentTenths, wording }: { percentTenths: string | null; wording: string }) {
  if (percentTenths === null) return <span className="text-muted-foreground">—</span>
  return <Badge variant={wordingVariant(percentTenths)}>{wording}</Badge>
}

/** An amount never breaks between its digits or before its currency sign. */
function Num({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap tabular-nums">{children}</span>
}

const DASH = <span className="text-muted-foreground">—</span>

function rowTitle(row: MarketReportRow): string {
  return row.kind === 'month' ? monthLabel(row.label) : row.label
}

/** A numeric column's header and cells sit on the right edge, digits under digits. */
function Right({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('w-full text-right', className)}>{children}</div>
}

/** «Факт X» / «Рынок Y» as two short lines — the phone's stand-in for the two columns. */
function FactMarketLines({
  fact,
  market,
  currency,
}: {
  fact: string
  market: string
  currency: DisplayCurrencyCode
}) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Факт <Num>{formatMoney(fact, currency)}</Num>
      </p>
      <p className="text-xs text-muted-foreground">
        Рынок <Num>{formatMoney(market, currency)}</Num>
      </p>
    </>
  )
}

function rowColumns(
  currency: DisplayCurrencyCode,
  narrow: boolean,
  firstHeader: string,
  total: MarketReport['total'],
  onOpen: (row: MarketReportRow) => void,
): ColumnDef<MarketReportRow>[] {
  const totals = total.figures[currency]
  const label: ColumnDef<MarketReportRow> = {
    id: 'label',
    header: firstHeader,
    footer: () => <span className="font-medium">Итого</span>,
    size: narrow ? 230 : 280,
    cell: ({ row: { original: row } }) => {
      const notes = leftOutNotes(row, row.figures[currency].noDisplayRate, currency)
      return (
        <div className="min-w-0 space-y-0.5">
          <Button
            variant="link"
            className="h-auto max-w-full justify-start truncate p-0 text-left font-medium"
            onClick={() => onOpen(row)}
          >
            {rowTitle(row)}
          </Button>
          {row.route !== null ? (
            <p className="truncate text-xs text-muted-foreground">{row.route}</p>
          ) : row.kind === 'chain' ? (
            <p className="text-xs text-muted-foreground">Конвертация</p>
          ) : null}
          {narrow && hasSum(row, row.figures[currency]) ? (
            <FactMarketLines
              fact={row.figures[currency].fact}
              market={row.figures[currency].market}
              currency={currency}
            />
          ) : null}
          {notes.length > 0 ? (
            <p className="text-xs text-muted-foreground">{notes.join(' · ')}</p>
          ) : null}
          {narrow && hasSum(row, row.figures[currency]) ? (
            <div className="pt-1">
              <Wording percentTenths={row.percentTenths} wording={row.wording} />
            </div>
          ) : null}
        </div>
      )
    },
  }
  const money = (
    id: 'fact' | 'market' | 'overpayment',
    header: string,
    size: number,
  ): ColumnDef<MarketReportRow> => {
    const format = id === 'overpayment' ? formatOverpayment : formatMoney
    return {
      id,
      header: () => <Right>{header}</Right>,
      size,
      footer: () => (
        <Right className="font-medium">
          {hasSum(total, totals) ? <Num>{format(totals[id], currency)}</Num> : DASH}
        </Right>
      ),
      cell: ({ row: { original: row } }) => (
        <Right>
          {hasSum(row, row.figures[currency]) ? (
            <Num>{format(row.figures[currency][id], currency)}</Num>
          ) : (
            DASH
          )}
        </Right>
      ),
    }
  }
  if (narrow) return [label, money('overpayment', 'Переплата', 120)]
  return [
    label,
    money('fact', 'Факт', 140),
    money('market', 'Рынок', 140),
    money('overpayment', 'Переплата', 140),
    {
      id: 'percent',
      header: 'Против рынка',
      size: 180,
      footer: () => <Wording percentTenths={total.percentTenths} wording={total.wording} />,
      cell: ({ row: { original: row } }) => (
        <Wording percentTenths={row.percentTenths} wording={row.wording} />
      ),
    },
  ]
}

function itemTitle(item: MarketReportItem): React.ReactNode {
  if (item.subject === 'chain') {
    return <span className="font-medium">Конвертация · {item.route}</span>
  }
  return (
    <Link href={requestHref(item.id)} className="font-medium underline-offset-4 hover:underline">
      <span className="whitespace-nowrap">{`Заявка №${item.id}`}</span>
      {item.payee === null ? '' : ` · ${keepInitialsTogether(item.payee)}`}
    </Link>
  )
}

/** The document amount — and, for a chain, what arrived — each amount unbroken. */
function ItemAmount({
  item,
  precisions,
}: {
  item: MarketReportItem
  precisions: Record<string, number>
}) {
  const original = (side: { amount: string; currency: string }) => (
    <Num>{formatOriginalMoney(side.amount, side.currency, precisions[side.currency] ?? 2)}</Num>
  )
  return item.arrived === null ? (
    original(item.amount)
  ) : (
    <>
      {original(item.amount)} → {original(item.arrived)}
    </>
  )
}

function itemState(item: MarketReportItem, currency: DisplayCurrencyCode): string | null {
  if (item.status === 'no_rate') return 'без курса ЦБ на дату'
  if (item.status === 'not_posted') return 'факт не внесён'
  if (item.figures[currency] === null) return `без курса в ${currency}`
  return null
}

/**
 * The rows behind a table row, in the details sheet. The sheet is the kit's
 * narrow side panel (the requests details sheet's width), so every width gets
 * the stacked two-column form: what and when on the left, Переплата right.
 */
function itemColumns(
  currency: DisplayCurrencyCode,
  precisions: Record<string, number>,
): ColumnDef<MarketReportItem>[] {
  return [
    {
      id: 'what',
      // Payments and conversions both: «Операция», not «Платёж» (review of #563).
      header: 'Операция',
      size: 200,
      cell: ({ row: { original: item } }) => {
        const figures = item.figures[currency]
        const state = itemState(item, currency)
        return (
          <div className="min-w-0 space-y-0.5 whitespace-normal">
            <div>{itemTitle(item)}</div>
            <p className="text-xs text-muted-foreground">
              {formatDate(item.date)} · <ItemAmount item={item} precisions={precisions} />
            </p>
            {item.subject === 'payment' ? (
              <p className="text-xs text-muted-foreground">{item.route}</p>
            ) : null}
            {figures !== null && state === null ? (
              <>
                <FactMarketLines fact={figures.fact} market={figures.market} currency={currency} />
                <div className="pt-1">
                  <Wording percentTenths={item.percentTenths} wording={item.wording} />
                </div>
              </>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'result',
      header: () => <Right>Переплата</Right>,
      size: 120,
      cell: ({ row: { original: item } }) => {
        const state = itemState(item, currency)
        const figures = item.figures[currency]
        return (
          <Right
            className={
              state === null ? undefined : 'text-xs whitespace-normal text-muted-foreground'
            }
          >
            {state !== null || figures === null ? (
              state
            ) : (
              <Num>{formatOverpayment(figures.overpayment, currency)}</Num>
            )}
          </Right>
        )
      },
    },
  ]
}

// ── the List block, fed with rows the server already computed ──────────────

/**
 * The whitelist's List row (`docs/design/ui-whitelist.md`): the Refine
 * `data-table` block over `useTable`, the screen owning only its columns. The
 * rows are the server's snapshot, so the hook's own read is off and the pager
 * is not drawn — a month table is the whole period.
 */
function ReportTable<TRow extends { key: string }>({
  rows,
  columns,
  emptyTitle,
  emptyDescription,
}: {
  rows: TRow[]
  columns: ColumnDef<TRow>[]
  emptyTitle: string
  emptyDescription: string
}) {
  const table = useTable<TRow, HttpError>({
    columns,
    data: rows,
    getRowId: (row) => row.key,
    refineCoreProps: {
      resource: MARKET_RATE_RESOURCE,
      pagination: { mode: 'off' },
      filters: { mode: 'off' },
      sorters: { mode: 'off' },
      queryOptions: { enabled: false },
    },
  })
  return (
    <DataTable
      table={table}
      paginated={false}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
    />
  )
}

// ── the screen ──────────────────────────────────────────────────────────────

export function MarketRateReport({ report, period, periods, precisions }: MarketRateReportProps) {
  const router = useRouter()
  const stored = React.useSyncExternalStore(
    subscribeStoredCurrency,
    readStoredCurrency,
    serverStoredCurrency,
  )
  const currency = parseStoredDisplayCurrency(stored)
  const narrow = React.useSyncExternalStore(subscribeNarrow, readNarrow, () => false)
  const [opened, setOpened] = React.useState<MarketReportRow | null>(null)

  const total = report.total
  const totals = total.figures[currency]
  const notes = leftOutNotes(total, totals.noDisplayRate, currency, total.excludedChains)
  const periodLabel = periods.find((option) => option.value === period)?.label ?? ''
  const totalShown = hasSum(total, totals)
  const head = headline(totals.overpayment, currency)

  // No manual memo: the React Compiler memoizes these on their real inputs.
  const monthColumns = rowColumns(currency, narrow, 'Месяц', total, setOpened)
  const payeeColumns = rowColumns(currency, narrow, 'Кому и каким маршрутом', total, setOpened)
  const openedColumns = itemColumns(currency, precisions)

  const empty = {
    emptyTitle: 'За этот период платежей в валюте нет',
    emptyDescription: 'Выберите другой период — например, «Всё время».',
  }

  return (
    <section aria-labelledby="market-rate-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            id="market-rate-heading"
            className="font-heading text-2xl font-semibold tracking-tight"
          >
            Курс против рынка
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Во что обошлись платежи в валюте и конвертации против курса ЦБ на дату оплаты.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={period}
            onValueChange={(next) => {
              setOpened(null)
              router.push(periodHref(next))
            }}
          >
            <SelectTrigger aria-label="Период" className="min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tabs
            value={currency}
            onValueChange={(next) => writeStoredCurrency(parseStoredDisplayCurrency(next))}
          >
            <TabsList aria-label="Валюта отображения">
              {DISPLAY_CURRENCIES.map((option) => (
                <TabsTrigger key={option.code} value={option.code}>
                  {option.symbol}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div role="group" aria-label="Итого за период" className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {`${totalShown ? head.label : 'Переплата'} · ${periodLabel.toLowerCase()}`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-heading text-4xl font-semibold tracking-tight tabular-nums">
            {totalShown ? head.amount : '—'}
          </span>
          <Wording percentTenths={total.percentTenths} wording={total.wording} />
        </div>
        {currency !== 'RUB' && totalShown ? (
          // EARS-566: the % is the rouble one, so a sum in $ / € may not share its sign.
          <p className="text-xs text-muted-foreground">% против рынка считается в рублях</p>
        ) : null}
        <p className="text-sm">
          Факт {totalShown ? <Num>{formatMoney(totals.fact, currency)}</Num> : '—'} · Рынок{' '}
          {totalShown ? <Num>{formatMoney(totals.market, currency)}</Num> : '—'}
        </p>
        <p className="text-sm text-muted-foreground">
          {[measuredLabel(total.measured), ...notes].join(' · ')}
        </p>
      </div>

      <section aria-labelledby="market-rate-months" className="space-y-2">
        <h2 id="market-rate-months" className="font-heading text-base font-semibold">
          По месяцам
        </h2>
        <ReportTable rows={report.months} columns={monthColumns} {...empty} />
      </section>

      <section aria-labelledby="market-rate-payees" className="space-y-2">
        <h2 id="market-rate-payees" className="font-heading text-base font-semibold">
          По получателям и маршрутам
        </h2>
        <ReportTable rows={report.payees} columns={payeeColumns} {...empty} />
      </section>

      {opened !== null ? (
        <Sheet open onOpenChange={(open) => (open ? undefined : setOpened(null))}>
          <SheetContent
            data-bbm-ui
            side="right"
            showCloseButton={false}
            className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
          >
            <SheetHeader className="gap-2 pr-12">
              <SheetTitle className="font-heading text-xl font-semibold tracking-tight">
                {rowTitle(opened)}
              </SheetTitle>
              <SheetDescription>
                {[
                  opened.route ?? (opened.kind === 'chain' ? 'Конвертация' : null),
                  // A row with nothing measured has no Переплата to name (review of #563).
                  ...(hasSum(opened, opened.figures[currency])
                    ? [
                        `Переплата ${formatOverpayment(opened.figures[currency].overpayment, currency)}`,
                        opened.wording,
                      ]
                    : []),
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
            <div className="px-4 pb-4">
              <ReportTable
                rows={opened.items}
                columns={openedColumns}
                emptyTitle="Платежей нет"
                emptyDescription="В этой строке нечего показать."
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </section>
  )
}
