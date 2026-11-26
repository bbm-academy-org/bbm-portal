'use client'

import { Refine, type DataProvider, type HttpError } from '@refinedev/core'
import routerProvider from '@refinedev/nextjs-router'
import { useTable } from '@refinedev/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'
import React from 'react'

import { DataTable } from '@/ui/refine-ui/data-table/data-table'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs'
import { cn } from '@/ui/utils'

/**
 * F5 «Куда ушли деньги» (spec 584 EARS-716…718) — the owner's pick on #585:
 * a treemap for «what is big» with variant B's ranked bar rows beneath it for
 * «exactly how much», ported from `design-source/finance/BudgetDashboard.html`.
 * A tile or a row opens the line's operations in a Sheet, as the whitelist's
 * List row (the Refine `data-table` block) — the same read-only Refine context
 * «Курс против рынка» runs its tables in.
 */

export type BreakdownRowView = {
  key: string
  date: string
  purpose: string
  project: string
  counterparty: string
  own: string
  value: string
  /** EARS-729's conversion mark for the value, shown under it; null when exact. */
  mark: string | null
  provisional: boolean
  href: string | null
}

export type BreakdownLineView = {
  key: string
  name: string
  value: string
  /** EARS-729's conversion mark for the value, shown under it; null when exact. */
  mark: string | null
  amount: number | null
  share: string | null
  provisional: boolean
  exchange: boolean
  /** The entity's lifetime hue slot (0–2), or null for a neutral line. */
  slot: number | null
  rows: BreakdownRowView[]
}

export type BreakdownGroupingView = {
  lines: BreakdownLineView[]
  total: string
  addsUp: boolean
}

export type BreakdownProps = {
  groupings: Record<'project' | 'category' | 'counterparty', BreakdownGroupingView>
  periodCaption: string
}

const TABS = [
  { value: 'project', label: 'По проектам' },
  { value: 'category', label: 'По категориям' },
  { value: 'counterparty', label: 'По контрагентам' },
] as const

const BUDGET_RESOURCE = 'finance-budget-dashboard'

async function readOnly(): Promise<never> {
  const error: HttpError = {
    statusCode: 405,
    message: 'Бюджет BBM только читается: его строки считает сервер.',
  }
  throw error
}

const dataProvider: DataProvider = {
  getApiUrl: () => '/p/finance/reports/budget',
  getList: readOnly,
  getOne: readOnly,
  create: readOnly,
  update: readOnly,
  deleteOne: readOnly,
}

export function BudgetBreakdown(props: BreakdownProps) {
  return (
    <Refine
      dataProvider={dataProvider}
      routerProvider={routerProvider}
      options={{ disableTelemetry: true }}
    >
      <Breakdown {...props} />
    </Refine>
  )
}

/** Hue slots of the three largest lines over the budget's lifetime; others neutral; FX hatched. */
const SLOTS = ['var(--chart-7)', 'var(--chart-8)', 'var(--chart-9)']
const REST = 'var(--chart-10)'

function fillOf(line: BreakdownLineView): string {
  if (line.exchange) return 'url(#budget-tm-hatch)'
  return line.slot === null ? REST : (SLOTS[line.slot] ?? REST)
}

function Breakdown({ groupings, periodCaption }: BreakdownProps) {
  const [tab, setTab] = React.useState<(typeof TABS)[number]['value']>('category')
  const [open, setOpen] = React.useState<BreakdownLineView | null>(null)
  const [hover, setHover] = React.useState<string | null>(null)
  const grouping = groupings[tab]
  const tabLabel = TABS.find((t) => t.value === tab)!.label.toLowerCase()
  const max = Math.max(0, ...grouping.lines.map((line) => Math.abs(line.amount ?? 0)))
  const negative = grouping.lines.filter((line) => (line.amount ?? 0) < 0)
  return (
    <div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList aria-label="Разрез">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {grouping.lines.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">За период расходов нет.</p>
      ) : (
        <>
          <Treemap lines={grouping.lines} hover={hover} onHover={setHover} onOpen={setOpen} />
          {negative.length > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {negative.map((line) => `${line.name} ${line.value}`).join(', ')} — отрицательная
              сумма, в карте не показана (площадь не бывает отрицательной); учтена в строках и в
              итоге.
            </p>
          )}
          <div className="mt-3.5 flex flex-col" data-testid="budget-breakdown-rows">
            {grouping.lines.map((line) => (
              <button
                key={line.key}
                type="button"
                onClick={() => setOpen(line)}
                onMouseEnter={() => setHover(line.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(line.key)}
                onBlur={() => setHover(null)}
                className={cn(
                  'grid grid-cols-[1fr_auto_48px_12px] items-center gap-2 rounded-md px-1.5 py-2 text-left tabular-nums transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:grid-cols-[260px_1fr_190px_60px_16px] md:gap-3.5',
                  hover === line.key && 'bg-muted',
                  line.exchange && 'mt-1 border-t pt-3 text-muted-foreground',
                )}
              >
                <span className="text-[13px]">
                  {line.name}
                  {line.provisional && <ProvisionalMark />}
                </span>
                <span className="order-5 col-span-full h-2 md:order-none md:col-span-1">
                  <span
                    className="block h-2 rounded-r"
                    style={{
                      width: `${max === 0 ? 0 : (Math.abs(line.amount ?? 0) / max) * 100}%`,
                      background: line.exchange
                        ? 'repeating-linear-gradient(45deg, var(--chart-11) 0 2px, transparent 2px 5px)'
                        : fillOf(line),
                    }}
                  />
                </span>
                <span className="flex flex-col items-end text-right">
                  <span className="text-[13px] font-medium">{line.value}</span>
                  {line.mark !== null && (
                    <span className="text-[11px] leading-4 text-muted-foreground">{line.mark}</span>
                  )}
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {line.share === null ? '—' : `${line.share}%`}
                </span>
                <span className="text-muted-foreground" aria-hidden>
                  ›
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground">
            {grouping.addsUp ? (
              <>
                Строки, включая курсовой результат, складываются в потрачено за период:{' '}
                <b className="text-foreground">{grouping.total}</b>.
              </>
            ) : (
              'Часть строк не посчитана, поэтому итог разреза не показан.'
            )}{' '}
            Плитка или строка открывает её операции.
          </p>
        </>
      )}
      <Sheet open={open !== null} onOpenChange={(value) => !value && setOpen(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {open !== null && (
            <>
              <SheetHeader>
                <SheetDescription>
                  Операции · {tabLabel} · {periodCaption}
                </SheetDescription>
                <SheetTitle>{open.name}</SheetTitle>
                <SheetDescription>
                  {open.value}
                  {open.mark !== null && ` · ${open.mark}`}
                  {open.share !== null && ` · ${open.share}% потраченного`}
                  {open.provisional && <ProvisionalMark />}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
                <OperationsTable rows={open.rows} exchange={open.exchange} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function ProvisionalMark() {
  return (
    <span className="ml-1.5 inline-block rounded-full bg-mark-provisional px-1.5 align-[1px] text-[11px] leading-4 font-medium whitespace-nowrap text-mark-provisional-foreground">
      предварительно
    </span>
  )
}

function OperationsTable({ rows, exchange }: { rows: BreakdownRowView[]; exchange: boolean }) {
  const columns = React.useMemo<ColumnDef<BreakdownRowView>[]>(
    () => [
      { id: 'date', header: 'Дата', accessorKey: 'date' },
      {
        id: 'purpose',
        header: 'Назначение',
        cell: ({ row }) =>
          row.original.href === null ? (
            row.original.purpose
          ) : (
            <Link
              href={row.original.href}
              className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {row.original.purpose}
            </Link>
          ),
      },
      ...(exchange
        ? []
        : ([
            { id: 'project', header: 'Проект', accessorKey: 'project' },
            { id: 'counterparty', header: 'Контрагент', accessorKey: 'counterparty' },
            { id: 'own', header: 'Сумма', accessorKey: 'own' },
          ] satisfies ColumnDef<BreakdownRowView>[])),
      {
        id: 'value',
        header: exchange ? 'Результат' : 'В валюте бюджета',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.value}
            {row.original.provisional && <ProvisionalMark />}
            {row.original.mark !== null && (
              <span className="block text-[11px] leading-4 text-muted-foreground">
                {row.original.mark}
              </span>
            )}
          </span>
        ),
      },
    ],
    [exchange],
  )
  const table = useTable<BreakdownRowView, HttpError>({
    columns,
    data: rows,
    getRowId: (row) => row.key,
    refineCoreProps: {
      resource: BUDGET_RESOURCE,
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
      emptyTitle="Операций нет"
      emptyDescription="За период у строки нет операций."
    />
  )
}

// ── the treemap ──────────────────────────────────────────────────────────────

type Tile = { line: BreakdownLineView; index: number; x: number; y: number; w: number; h: number }

/** Squarified layout (Bruls et al.), as the mockup ports it. */
function squarify(
  data: { line: BreakdownLineView; index: number; value: number }[],
  width: number,
  height: number,
): Tile[] {
  const out: Tile[] = []
  const sum = data.reduce((s, d) => s + d.value, 0)
  if (sum <= 0) return out
  const scale = (width * height) / sum
  const nodes = data.map((d) => ({ d, a: d.value * scale }))
  let rect = { x: 0, y: 0, w: width, h: height }
  let row: typeof nodes = []
  const worst = (r: typeof nodes, side: number) => {
    const s = r.reduce((a, n) => a + n.a, 0)
    const mx = Math.max(...r.map((n) => n.a))
    const mn = Math.min(...r.map((n) => n.a))
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn))
  }
  const lay = (r: typeof nodes) => {
    const s = r.reduce((a, n) => a + n.a, 0)
    if (rect.w >= rect.h) {
      const cw = s / rect.h
      let cy = rect.y
      for (const n of r) {
        const ch = n.a / cw
        out.push({ line: n.d.line, index: n.d.index, x: rect.x, y: cy, w: cw, h: ch })
        cy += ch
      }
      rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h }
    } else {
      const ch = s / rect.w
      let cx = rect.x
      for (const n of r) {
        const cw = n.a / ch
        out.push({ line: n.d.line, index: n.d.index, x: cx, y: rect.y, w: cw, h: ch })
        cx += cw
      }
      rect = { x: rect.x, y: rect.y + ch, w: rect.w, h: rect.h - ch }
    }
  }
  for (const n of nodes) {
    const side = Math.min(rect.w, rect.h)
    if (row.length === 0 || worst([...row, n], side) <= worst(row, side)) row.push(n)
    else {
      lay(row)
      row = [n]
    }
  }
  if (row.length > 0) lay(row)
  return out
}

/** Label ink: light on the two deep hue slots, dark on the amber slot and the neutral one. */
function inkOf(line: BreakdownLineView): string {
  if (line.exchange) return 'var(--foreground)'
  return line.slot !== null && line.slot < 2 ? 'var(--chart-ink-light)' : 'var(--chart-ink-dark)'
}

/** A rough width of a 13px label, so a name is cut to its tile rather than overflowing it. */
function fit(text: string, maxWidth: number): string | null {
  const perChar = 7.2
  if (text.length * perChar <= maxWidth) return text
  const keep = Math.floor(maxWidth / perChar) - 1
  return keep > 2 ? `${text.slice(0, keep)}…` : null
}

function Treemap({
  lines,
  hover,
  onHover,
  onOpen,
}: {
  lines: BreakdownLineView[]
  hover: string | null
  onHover: (key: string | null) => void
  onOpen: (line: BreakdownLineView) => void
}) {
  const host = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(0)
  React.useEffect(() => {
    const node = host.current
    if (node === null) return
    const observer = new ResizeObserver(() => setWidth(node.clientWidth))
    observer.observe(node)
    setWidth(node.clientWidth)
    return () => observer.disconnect()
  }, [])
  const height = width < 560 ? 300 : 240
  const tiles = squarify(
    lines
      .map((line, index) => ({ line, index, value: line.amount ?? 0 }))
      .filter((d) => d.value > 0),
    width,
    height,
  )
  const label = lines
    .filter((line) => (line.amount ?? 0) > 0)
    .map((line) => `${line.name} ${line.share ?? '—'}%`)
    .join(', ')
  return (
    <div ref={host} className="relative mt-3" data-testid="budget-treemap">
      {width > 0 && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          height={height}
          width="100%"
          role="img"
          aria-label={`Карта долей: ${label}. Точные суммы — в строках под картой.`}
          focusable="false"
          className="block"
        >
          <defs>
            <pattern
              id="budget-tm-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="var(--muted)" />
              <rect width="1.6" height="6" fill="var(--chart-11)" fillOpacity=".55" />
            </pattern>
          </defs>
          {tiles.map((t) => {
            const ink = inkOf(t.line)
            const pad = 10
            const full = t.w >= 104 && t.h >= 62
            const mid = t.w >= 58 && t.h >= 34
            const name = mid ? fit(t.line.name, t.w - pad * 2) : null
            return (
              <g
                key={t.line.key}
                className="cursor-pointer"
                onMouseEnter={() => onHover(t.line.key)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onOpen(t.line)}
              >
                <title>{`${t.line.name}: ${[t.line.value, t.line.mark].filter(Boolean).join(' · ')} · ${t.line.share ?? '—'}%`}</title>
                <rect
                  x={t.x}
                  y={t.y}
                  width={t.w}
                  height={t.h}
                  rx="4"
                  fill={fillOf(t.line)}
                  stroke="var(--card)"
                  strokeWidth="2"
                />
                <rect
                  x={t.x + 2}
                  y={t.y + 2}
                  width={Math.max(0, t.w - 4)}
                  height={Math.max(0, t.h - 4)}
                  rx="3"
                  fill="none"
                  stroke={hover === t.line.key ? 'var(--foreground)' : 'none'}
                  strokeWidth="2"
                />
                {name !== null && (
                  <g className="pointer-events-none tabular-nums" fill={ink}>
                    <text x={t.x + pad} y={t.y + 20} className="text-[13px] font-semibold">
                      {name}
                      {t.line.provisional && !full ? ' *' : ''}
                    </text>
                    {full ? (
                      <>
                        <text x={t.x + pad} y={t.y + 38} className="text-[13px] font-medium">
                          {fit(t.line.value, t.w - pad * 2) ?? ''}
                        </text>
                        <text x={t.x + pad} y={t.y + 55} className="text-xs">
                          {t.line.share ?? '—'}%
                        </text>
                        {t.line.provisional && t.h >= 84 && (
                          <text x={t.x + pad} y={t.y + 75} className="text-[10.5px] font-semibold">
                            предварительно
                          </text>
                        )}
                      </>
                    ) : (
                      t.h >= 50 && (
                        <text x={t.x + pad} y={t.y + 37} className="text-xs">
                          {t.line.share ?? '—'}%
                        </text>
                      )
                    )}
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
