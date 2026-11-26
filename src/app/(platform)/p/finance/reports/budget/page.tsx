import Link from 'next/link'
import { forbidden, redirect } from 'next/navigation'

import { auth } from '@/auth'
import {
  BUDGET_PERIODS,
  FINANCE_APPROVE_ROLE,
  getBudgetDashboard,
  getFirstOperationOn,
  getLiveBudget,
  listCurrencies,
  parseBudgetPeriod,
  type BudgetDashboardView as BudgetDashboard,
  type BudgetFigure,
  type BudgetGrouping,
  type FinanceActor,
} from '@/lib/finance'
import { PLATFORM_USER_ROLE, resolveClaimGate } from '@/lib/platform/authGate'
import { cn } from '@/ui/utils'

import { formatDate } from '../../requests/constants'

import { BudgetBreakdown, type BreakdownGroupingView } from './BudgetBreakdown'
import { CHART_WIDTH, MonthlyBurnChart, WaterlineChart } from './BudgetCharts'
import { BudgetLimitActions } from './BudgetLimitActions'
import { SegmentedNav } from './SegmentedNav'
import {
  budgetHref,
  differenceText,
  figureText,
  figureValue,
  longDate,
  monthShort,
  segmentLabel,
} from './budget-view'

/**
 * `/p/finance/reports/budget` «Бюджет BBM» — spec 584 (issue #586), built to
 * the owner's Stage-A pick `design-source/finance/BudgetDashboard.html`
 * (variant B + treemap). Every number is the finance module's
 * (`getBudgetDashboard`, one §D replay per read, EARS-702); this route only
 * formats and places it. Reading is open to every member (EARS-701); the
 * (platform) layout is the sign-in gate and the limit writes are refused by
 * the module without `finance-approve` (EARS-723).
 *
 * The ₽/$/€ switch (spec 584 §G) travels as `?currency=`, the period as
 * `?period=`; the module converts, this route only says how: one pointer line
 * under the header while the view is converted, and the «Как посчитано» block
 * at the bottom (the conversion rules, EARS-729's marked months, the relation
 * lines of EARS-722 item 4, the waterline notes). No figure carries a rate mark.
 */
export const dynamic = 'force-dynamic'

const ROUTE = '/p/finance/reports/budget'

export default async function BudgetDashboardPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ period?: string | string[]; currency?: string | string[] }>
}) {
  const query = await searchParams
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)
  const period = parseBudgetPeriod(first(query.period))
  const session = await auth()
  // The /p layout's gate, answered again HERE: «Выйти» re-renders this route in
  // the sign-out action's own response with the session already gone, and Next
  // renders a page in parallel with its layouts — so the layout's redirect does
  // not keep this body from handing an empty actor to the finance module.
  const gate = resolveClaimGate(session, ROUTE, PLATFORM_USER_ROLE)
  if (gate.type === 'redirect') redirect(gate.to)
  if (gate.type === 'forbidden') forbidden()
  const actor: FinanceActor = {
    email: session?.user?.email?.trim().toLowerCase() ?? '',
    roles: (session?.user as { roles?: string[] } | undefined)?.roles ?? [],
  }
  const canApprove = actor.roles.includes(FINANCE_APPROVE_ROLE)
  const [budget, currencies] = await Promise.all([getLiveBudget(actor), listCurrencies()])
  const currencyOptions = currencies.map((c) => ({
    code: c.code,
    name: c.name,
    precision: c.precision,
  }))
  const computedAt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())

  if (budget === null) {
    const firstOn = (await getFirstOperationOn(actor)) ?? moscowDate()
    return (
      <section aria-labelledby="budget-heading" className="space-y-6">
        <Header
          title="Бюджет BBM"
          meta={`рассчитано ${computedAt}`}
          actions={
            canApprove ? (
              <BudgetLimitActions
                current={null}
                currencies={currencyOptions}
                defaultStartsOn={firstOn}
              />
            ) : null
          }
        />
        <Card>
          <h2 className="text-[15px] font-semibold">Бюджет не задан</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {canApprove
              ? 'Задайте лимит — дашборд покажет, сколько потрачено, сколько осталось и на сколько месяцев хватит.'
              : 'Лимит задаёт участник с ролью finance-approve. Пока бюджета нет, цифр на этой странице нет.'}
          </p>
        </Card>
      </section>
    )
  }

  const dashboard = (await getBudgetDashboard(actor, {
    period,
    currency: first(query.currency),
  }))!
  const B = dashboard.currency
  const D = dashboard.display.currency
  const precision = currencies.find((c) => c.code === D)?.precision ?? 2
  const money = (figure: BudgetFigure | null, cents = false) =>
    figureText(figure, D, precision, { cents }).text
  const diff = (amount: bigint | null) =>
    amount === null ? null : differenceText(amount, D, precision)
  const since = `с ${longDate(dashboard.startsOn)}`
  const { display } = dashboard
  const view: View = { dashboard, money, diff, B, D }
  const nameOf = (code: string) => currencies.find((c) => c.code === code)?.name ?? code

  return (
    <section aria-labelledby="budget-heading" className="space-y-0 text-sm">
      <Header
        title="Бюджет BBM"
        meta={`${budget.name} · валюта бюджета ${B} · ${since} · рассчитано ${computedAt}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {dashboard.candidates.length > 1 && (
              <SegmentedNav
                label="Валюта итога"
                testId="budget-currencies"
                segments={dashboard.candidates.map((candidate) => ({
                  key: candidate.code,
                  label: segmentLabel(candidate.code),
                  href: budgetHref(period, candidate.code),
                  current: candidate.code === D,
                  disabledReason: candidate.disabled
                    ? `${nameOf(candidate.code)}: нет курса ЦБ для ${candidate.code}`
                    : null,
                }))}
              />
            )}
            {canApprove ? (
              <BudgetLimitActions
                current={{
                  id: budget.id,
                  name: budget.name,
                  limitAmount: budget.limitAmount.toString(),
                  currency: budget.currency,
                  startsOn: budget.startsOn,
                }}
                currencies={currencyOptions}
                defaultStartsOn={budget.startsOn}
              />
            ) : null}
          </div>
        }
      />
      {display.staleSince !== null && (
        <p
          className="mt-2.5 rounded-md bg-mark-provisional px-3 py-1.5 text-xs text-mark-provisional-foreground"
          data-testid="budget-stale-rates"
        >
          Курсы ЦБ устарели: последние — на {longDate(display.staleSince)}.
        </p>
      )}
      {display.converted && (
        <p className="mt-2.5 text-xs text-muted-foreground" data-testid="budget-rate-line">
          Суммы пересчитаны в {D} ·{' '}
          <a
            href="#budget-method"
            className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            как пересчитано
          </a>
        </p>
      )}
      {dashboard.empty && (
        <p className="mt-4 rounded-md border border-dashed px-3.5 py-2.5 text-sm text-muted-foreground">
          С {longDate(dashboard.startsOn)} операций нет.
        </p>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-[330px_1fr]">
        <Glass view={view} since={since} />
        <div className="flex min-w-0 flex-col gap-4">
          <Runway dashboard={dashboard} money={money} />
          <MoneyTier view={view} since={since} />
        </div>
      </div>

      <div className="mt-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <h2 className="text-base font-semibold">Динамика</h2>
        <SegmentedNav
          label="Период"
          testId="budget-periods"
          segments={BUDGET_PERIODS.map((option) => ({
            key: option.value,
            label: option.label,
            href: budgetHref(option.value, D),
            current: option.value === period,
          }))}
        />
      </div>
      <Dynamics dashboard={dashboard} money={money} precision={precision} />
      <Card className="mt-4">
        <h2 className="text-[15px] font-semibold">Куда ушли деньги</h2>
        <p className="mb-2.5 text-xs text-muted-foreground">
          {periodCaption(dashboard)} · площадь — доля потраченного · плитка или строка открывает
          операции
        </p>
        <BudgetBreakdown
          periodCaption={periodCaption(dashboard)}
          groupings={{
            project: groupingView(dashboard.breakdown.project, money),
            category: groupingView(dashboard.breakdown.category, money),
            counterparty: groupingView(dashboard.breakdown.counterparty, money),
          }}
        />
      </Card>
      <Method view={view} />
    </section>
  )

  function groupingView(grouping: BudgetGrouping, format: typeof money): BreakdownGroupingView {
    return {
      total: format(grouping.total),
      addsUp: grouping.addsUp,
      lines: grouping.lines.map((line) => ({
        key: line.key,
        name: line.name,
        value: format(line.value),
        amount: figureValue(line.value, precision),
        share: line.share,
        provisional: line.provisional,
        exchange: line.exchange,
        slot: line.slot,
        rows: line.rows.map((row) => ({
          key: String(row.operationId),
          date: formatDate(row.occurredOn),
          purpose: row.purpose ?? `Операция №${row.operationId}`,
          project: row.project ?? '—',
          counterparty: row.counterparty ?? '—',
          own: row.ownAmounts
            .map((own) => {
              const p = currencies.find((c) => c.code === own.currency)?.precision ?? 2
              return figureText({ status: 'known', amount: own.amount }, own.currency, p, {
                cents: true,
              }).text
            })
            .join(' + '),
          value: format(row.value, true),
          provisional: row.provisional,
          href:
            row.requestItemId === null ? null : `/p/finance/requests?request=${row.requestItemId}`,
        })),
      })),
    }
  }
}

/** EARS-729 item 2 — the month columns that sum an item at a dated rate. */
function markedMonths(dashboard: BudgetDashboard): string[] {
  return dashboard.months
    .filter((month) => month.inPeriod)
    .filter((month) => month.gross.status === 'known' && (month.gross.cbr?.items ?? 0) > 0)
    .map((month) => monthShort(month.month))
}

const MOSCOW_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The create form's `starts_on` prefill when the ledger has no operation yet. */
function moscowDate(): string {
  return MOSCOW_DATE.format(new Date())
}

function periodCaption(dashboard: BudgetDashboard): string {
  if (dashboard.period.key === 'all')
    return `С начала бюджета, ${longDate(dashboard.startsOn)} — по ${longDate(dashboard.period.to)}`
  return `${longDate(dashboard.period.from)} — ${longDate(dashboard.period.to)}`
}

type Money = (figure: BudgetFigure | null, cents?: boolean) => string

type View = {
  dashboard: BudgetDashboard
  money: Money
  diff: (amount: bigint | null) => string | null
  B: string
  D: string
}

/** One line of the «Как посчитано» block. */
function MethodLine({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <p className="mt-1.5 text-xs text-muted-foreground" data-testid={testId}>
      {children}
    </p>
  )
}

/**
 * «Как посчитано» — the page's one methodology block, at the very bottom (owner,
 * 2026-11-26, live-stand acceptance: no per-figure rate captions, one place that
 * says how the figures were converted). Spec 584 §G; a withheld figure still
 * renders as unknown in place (EARS-720) — that is data, not methodology.
 */
function Method({ view }: { view: View }) {
  const { dashboard, diff, B, D } = view
  const { display } = dashboard
  const stockDate = display.stockRate === null ? null : longDate(display.stockRate)
  const months = markedMonths(dashboard)
  const relation = (testId: string, amount: bigint | null, text: (d: string) => string) => {
    const d = diff(amount)
    return d === null ? null : <MethodLine testId={testId}>{text(d)}</MethodLine>
  }
  return (
    <Card className="mt-4">
      <h2 id="budget-method" className="scroll-mt-4 text-[15px] font-semibold">
        Как посчитано
      </h2>
      <div data-testid="budget-method">
        {display.converted ? (
          <>
            <MethodLine>
              Операции, выплаты и предварительная часть — по фактическому курсу каждой операции;
              лимит, остаток, долги участникам и деньги на счетах —{' '}
              {stockDate === null
                ? `нет курса ЦБ на ${longDate(dashboard.today)}`
                : `по курсу ЦБ на ${stockDate}`}
              . Графики совпадают по форме с видом в {B} с точностью до разницы курсов операций.
            </MethodLine>
            <MethodLine testId="budget-method-fallback">
              {display.fallback === null || display.fallback.operations === 0
                ? 'По курсу ЦБ операций периода нет.'
                : `По курсу ЦБ, у операции нет своего курса: ${display.fallback.operations} из ${display.fallback.of} операций периода.`}
              {months.length > 0 && ` Месяцы с такими операциями: ${months.join(', ')}.`}
            </MethodLine>
            {relation(
              'budget-limit-difference',
              display.differences.limit,
              (d) =>
                `В ${D} лимит ≠ потрачено + остаток на ${d}: лимит и остаток — по курсу ЦБ, расходы — по курсу операций; точно — в ${B}.`,
            )}
            {relation(
              'budget-provisional-difference',
              display.differences.provisional,
              (d) =>
                `В ${D} предварительная часть ≠ её доле в долгах участникам на ${d}: долги — по курсу ЦБ, предварительная часть — по курсу операций; точно — в ${B}.`,
            )}
            {relation(
              'budget-equation-difference',
              display.differences.equation,
              (d) =>
                `В ${D} взносы + доход ≠ потрачено + на счетах − долги на ${d}: на счетах и долги — по курсу ЦБ, взносы, доход и расходы — по курсу операций; точно — в ${B}.`,
            )}
            {dashboard.money.paidOut !== null &&
              relation(
                'budget-paid-out-difference',
                display.differences.paidOut,
                (d) =>
                  `В ${D} потрачено ≠ выплачено + долги участникам на ${d}: долги — по курсу ЦБ, расходы и выплаты — по курсу операций; точно — в ${B}.`,
              )}
            {dashboard.waterlineNote === 'rate' && (
              <MethodLine testId="budget-waterline-note">
                В {D} уровень −лимит пересчитан по последнему курсу ЦБ, а ватерлиния — по курсу
                каждой операции, поэтому их пересечение может не совпасть с «лимит исчерпан»: это
                решается в {B}.
              </MethodLine>
            )}
            <MethodLine>
              <Link
                href="/p/finance/reports/market-rate"
                className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Курс против рынка
              </Link>
            </MethodLine>
          </>
        ) : (
          <MethodLine>Все суммы в {B}, точно, без пересчёта.</MethodLine>
        )}
        <MethodLine>Деньги на счетах — по себестоимости.</MethodLine>
        <MethodLine>
          Сторно убирает операцию из её собственного месяца: возврат от поставщика уменьшает месяц
          расхода, а не месяц возврата, поэтому прошлый месяц может измениться.
        </MethodLine>
        {dashboard.waterlineNote === 'income' && (
          <MethodLine testId="budget-waterline-note">
            Ватерлиния пересекает −лимит не в тот момент, когда стакан пустеет: доход не пополняет
            лимит, поэтому они совпадают, только пока дохода нет.
          </MethodLine>
        )}
      </div>
    </Card>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn('rounded-[0.875rem] border bg-card px-[22px] py-5 shadow-xs', className)}
    >
      {children}
    </section>
  )
}

function Header({
  title,
  meta,
  actions,
}: {
  title: string
  meta: string
  actions: React.ReactNode
}) {
  return (
    <header className="flex flex-col items-start justify-between gap-6 md:flex-row">
      <div>
        <div className="text-xs text-muted-foreground">
          <Link href="/p/finance" className="hover:text-foreground hover:underline">
            Финансы
          </Link>{' '}
          / Отчёты
        </div>
        <h1 id="budget-heading" className="mt-0.5 mb-1 text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        <div className="text-[13px] text-muted-foreground">{meta}</div>
      </div>
      {actions}
    </header>
  )
}

const Prov = () => (
  <span className="ml-1.5 inline-block max-w-full rounded-lg bg-mark-provisional px-1.5 align-[1px] text-[11px] leading-4 font-medium text-mark-provisional-foreground md:rounded-full md:whitespace-nowrap">
    предварительно
  </span>
)

function Glass({ view, since }: { view: View; since: string }) {
  const { dashboard, money } = view
  const { glass } = dashboard
  const remainPct = glass.fill === null ? null : Math.max(0, 1 - glass.fill) * 100
  return (
    <Card>
      <div aria-label="Стакан бюджета" data-testid="budget-glass">
        <div className="text-[13px] text-muted-foreground">
          Остаток лимита {glass.spentProvisional && <Prov />}
        </div>
        <div
          className={cn(
            'mt-0.5 text-[40px] leading-[1.05] font-semibold tracking-[-0.025em] tabular-nums',
            glass.state === 'overflow' && 'text-destructive',
          )}
          data-testid="budget-remaining"
        >
          {money(glass.remaining, true)}
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          {glass.state === 'overflow' || glass.state === 'exhausted'
            ? 'лимит исчерпан'
            : glass.remainingShare === null
              ? '—'
              : `в стакане ${glass.remainingShare}%`}{' '}
          · <span className="text-xs">{since}</span>
        </div>
        <div className="mt-1.5 grid grid-cols-[90px_minmax(0,1fr)] items-stretch gap-[18px] md:grid-cols-[120px_1fr]">
          <div
            role="meter"
            aria-label="Остаток лимита"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={remainPct === null ? undefined : Number(remainPct.toFixed(1))}
            aria-valuetext={`план ${money(glass.limit)}, факт ${money(glass.spent)}`}
            className={cn(
              'relative h-[300px] overflow-hidden rounded-b-[18px] border-2 border-t-0 border-chart-1 bg-muted',
              glass.state === 'overflow' && 'border-destructive',
            )}
          >
            <div className="absolute -inset-x-0.5 top-0 border-t-2 border-dashed border-chart-1" />
            {remainPct !== null && (
              <div
                className="absolute inset-x-0 bottom-0 bg-chart-1 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-chart-4 before:opacity-50"
                style={{ height: `${remainPct}%` }}
              />
            )}
            {glass.state === 'overflow' && (
              <div className="absolute inset-x-0 top-0 bg-destructive/15 px-1 py-0.5 text-center text-[11px] text-destructive">
                перерасход
              </div>
            )}
          </div>
          <div className="flex h-[300px] flex-col justify-between text-xs text-muted-foreground tabular-nums">
            <div>
              План · лимит
              <b className="block text-sm font-semibold text-foreground">
                {money(glass.limit, true)}
              </b>
            </div>
            <div>
              Факт · потрачено
              <b className="block text-sm font-semibold text-foreground" data-testid="budget-spent">
                {money(glass.spent)}
              </b>
              {glass.shareUsed === null ? '' : `использовано ${glass.shareUsed}%`}
            </div>
            <div>
              Осталось
              <b className="block text-sm font-semibold text-foreground">
                {money(glass.remaining, true)}
              </b>
            </div>
          </div>
        </div>
        {glass.provisional !== null && (
          <div className="mt-2.5 text-xs text-muted-foreground">
            из них предварительно {money(glass.provisional.amount)} · открытых долгов в валюте:{' '}
            {glass.provisional.count}
          </div>
        )}
      </div>
    </Card>
  )
}

const RUNWAY_TEXT: Record<string, string> = {
  withheld: 'не посчитан',
  exhausted: 'лимит исчерпан',
  needMonth: 'нужен хотя бы один полный месяц',
}

function monthRange(months: string[]): string {
  if (months.length === 0) return ''
  const first = monthShort(months[0]!)
  const last = monthShort(months.at(-1)!)
  return first === last ? first : `${first}–${last}`
}

function Runway({ dashboard, money }: { dashboard: BudgetDashboard; money: Money }) {
  const { runway } = dashboard
  const range = monthRange(runway.averagedMonths)
  const gross = runway.avgGross === null ? null : figureValueSafe(runway.avgGross)
  const net = runway.avgNet === null ? null : figureValueSafe(runway.avgNet)
  return (
    <Card className="grid items-start gap-6 md:grid-cols-2">
      <div data-testid="budget-runway">
        <div className="text-[13px] text-muted-foreground">
          Запас хода {runway.provisional && <Prov />}
        </div>
        <div className="mt-0.5 mb-1 text-[40px] font-semibold tracking-[-0.02em] tabular-nums">
          {runway.case === 'value' ? (
            <>
              {runway.months} <span className="text-[30px]">мес.</span>
            </>
          ) : (
            <span className="text-xl">
              {runway.case === 'noSpend'
                ? `за последние ${runway.n} мес. расходов по бюджету не было`
                : RUNWAY_TEXT[runway.case]}
            </span>
          )}
        </div>
        {runway.n > 0 && (
          <>
            <div className="mt-0.5 text-xs">
              остаток ÷ средний валовый расход {money(runway.avgGross)} за {runway.n} мес. ({range})
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              чистый расход после дохода — {money(runway.avgNet)} в мес.; в запас хода не входит:
              доход не пополняет лимит
            </div>
          </>
        )}
      </div>
      {gross !== null && net !== null && runway.n > 0 && (
        <div className="text-xs text-muted-foreground">
          <div className="mb-1.5 text-[13px]">Расход в месяц, среднее за {range}</div>
          валовый · {money(runway.avgGross)}
          <div className="mt-1 mb-2 h-2 w-full rounded-r bg-chart-1" />
          чистый (после дохода) · {money(runway.avgNet)}
          <div
            className="mt-1 mb-2 h-2 rounded-r bg-chart-2"
            style={{ width: `${gross <= 0 ? 0 : Math.max(0, Math.min(1, net / gross)) * 100}%` }}
          />
        </div>
      )}
    </Card>
  )
}

/** Geometry only: a figure's magnitude for a bar's width. */
function figureValueSafe(figure: BudgetFigure): number | null {
  return figure.status === 'known' ? Number(figure.amount) : null
}

function MoneyTier({ view, since }: { view: View; since: string }) {
  const { dashboard, money } = view
  const m = dashboard.money
  const tiles: { k: string; v: string; marks: React.ReactNode }[] = [
    { k: 'Взносы', v: money(m.contributed), marks: null },
    { k: 'Доход', v: money(m.income), marks: null },
    {
      k: 'Потрачено',
      v: money(m.spent),
      marks: dashboard.glass.spentProvisional && <Prov />,
    },
    {
      k: 'Долги участникам',
      v: money(m.owed, true),
      marks: m.owedProvisional && <Prov />,
    },
    {
      k: 'Деньги на счетах',
      v: money(m.cashAtCost, true),
      marks: null,
    },
  ]
  if (m.paidOut !== null) {
    tiles.push({
      k: 'Выплачено',
      v: money(m.paidOut, true),
      marks: null,
    })
  }
  return (
    <Card>
      <h2 className="mb-0.5 text-[15px] font-semibold">
        Взносы и расходы <span className="text-xs font-normal text-muted-foreground">{since}</span>
      </h2>
      <p className="mb-2.5 text-xs text-muted-foreground">
        Что внесено, что потрачено и где деньги сейчас
      </p>
      <div
        className="grid grid-cols-2 overflow-hidden rounded-[0.625rem] border md:grid-cols-3"
        data-testid="budget-money"
      >
        {tiles.map((tile) => (
          <div
            key={tile.k}
            className="border-r border-b px-3.5 py-3 [&:nth-child(3n)]:md:border-r-0"
          >
            <div className="text-[13px] text-muted-foreground">{tile.k}</div>
            <div className="text-xl font-semibold tracking-[-0.01em] tabular-nums">{tile.v}</div>
            <div className="[&>span]:mt-1 [&>span]:ml-0">{tile.marks}</div>
          </div>
        ))}
      </div>
      <div
        className="mt-3 text-[13px] text-muted-foreground tabular-nums"
        data-testid="budget-equation"
      >
        {m.equation !== null ? (
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span>
              Взносы + доход ={' '}
              <b className="font-semibold text-foreground">
                {money({ status: 'known', amount: m.equation.left }, true)}
              </b>
            </span>
            <span className="font-bold text-foreground">
              {m.equation.left === m.equation.right ? '=' : '≠'}
            </span>
            <span>
              потрачено + на счетах − долги ={' '}
              <b className="font-semibold text-foreground">
                {money({ status: 'known', amount: m.equation.right }, true)}
              </b>
            </span>
          </div>
        ) : m.reconciles ? (
          <p>Сверка не показана: часть цифр не посчитана.</p>
        ) : (
          <p>
            Операции до {longDate(dashboard.startsOn)} — вне стакана, поэтому цифры между собой не
            сходятся, и сверка не показана.
          </p>
        )}
      </div>
    </Card>
  )
}

function Dynamics({
  dashboard,
  money,
  precision,
}: {
  dashboard: BudgetDashboard
  money: Money
  precision: number
}) {
  const unit = 10 ** precision
  const inPeriod = dashboard.months
    .map((month, index) => ({ month, index }))
    .filter(({ month }) => month.inPeriod)
  const toNumber = (figure: BudgetFigure) =>
    figure.status === 'known' ? Number(figure.amount) / unit : null
  const columns = inPeriod.map(({ month }) => ({
    key: month.month,
    label: monthShort(month.month),
    gross: toNumber(month.gross),
    net: toNumber(month.net),
    partial: month.partial !== null,
    provisional: month.provisional,
  }))
  const { runway } = dashboard
  const averagedIdx = runway.averagedMonths
    .map((key) => columns.findIndex((column) => column.key === key))
    .filter((index) => index >= 0)
  const averages =
    runway.avgGross?.status === 'known' &&
    runway.avgNet?.status === 'known' &&
    averagedIdx.length > 0
      ? {
          gross: Number(runway.avgGross.amount) / unit,
          net: Number(runway.avgNet.amount) / unit,
          grossText: money(runway.avgGross),
          netText: money(runway.avgNet),
          from: averagedIdx[0]!,
          to: averagedIdx.at(-1)!,
          caption: `за ${runway.n} мес.: ${monthRange(runway.averagedMonths)}`,
        }
      : null
  const points = inPeriod.map(({ month, index }) => {
    const point = dashboard.waterline[index]!
    return {
      key: month.month,
      label: monthShort(month.month),
      net: toNumber(point.net),
      contributed: toNumber(point.contributed),
      partial: month.partial !== null,
    }
  })
  const last = dashboard.waterline.at(-1)
  const water = {
    points,
    limit: (figureValueSafe(dashboard.glass.limit) ?? 0) / unit,
    labels: {
      net: last === undefined ? '—' : money(last.net),
      contributed: last === undefined ? '—' : money(last.contributed),
      limit:
        dashboard.glass.limit.status === 'known'
          ? money({ status: 'known' as const, amount: -dashboard.glass.limit.amount })
          : money(dashboard.glass.limit),
    },
  }
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <Card>
        <h3 className="mb-0.5 text-[15px] font-semibold">Расход по месяцам</h3>
        <p className="mb-2.5 text-xs text-muted-foreground">
          Валовый и чистый; линии — среднее за {runway.n || 3} полных месяца
        </p>
        <Legend
          items={[
            { swatch: 'bg-chart-1', label: 'Валовый расход' },
            { swatch: 'bg-chart-2', label: 'Чистый расход (после дохода)' },
            { line: 'border-chart-4', label: `Среднее валового за ${runway.n} мес.` },
            { line: 'border-chart-5 border-dashed', label: 'Среднее чистого' },
            { hatch: true, label: `неполный месяц, по ${longDate(dashboard.today)}` },
          ]}
        />
        <div data-testid="budget-monthly">
          <div className="hidden md:block">
            <MonthlyBurnChart columns={columns} averages={averages} />
          </div>
          <div className="md:hidden">
            <MonthlyBurnChart columns={columns} averages={averages} width={CHART_WIDTH.narrow} />
          </div>
        </div>
      </Card>
      <Card>
        <h3 className="mb-0.5 text-[15px] font-semibold">Ватерлиния</h3>
        <p className="mb-2.5 text-xs text-muted-foreground">
          Накопленный результат против взносов и уровня −лимит
        </p>
        <Legend
          items={[
            { line: 'border-chart-1', label: 'Накопленный результат (доход − расход)' },
            { line: 'border-chart-3', label: 'Накопленные взносы' },
            { line: 'border-destructive border-dashed', label: '−лимит, справочный уровень' },
          ]}
        />
        <div data-testid="budget-waterline">
          <div className="hidden md:block">
            <WaterlineChart {...water} />
          </div>
          <div className="md:hidden">
            <WaterlineChart {...water} width={CHART_WIDTH.narrow} />
          </div>
        </div>
      </Card>
    </div>
  )
}

function Legend({
  items,
}: {
  items: { label: string; swatch?: string; line?: string; hatch?: boolean }[]
}) {
  return (
    <div className="mt-1 mb-1.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          {item.swatch && <i className={cn('inline-block size-2.5 rounded-[3px]', item.swatch)} />}
          {item.line && <i className={cn('inline-block w-4 border-t-2', item.line)} />}
          {item.hatch && (
            <i
              className="inline-block size-2.5 rounded-[3px] outline outline-1 -outline-offset-1 outline-chart-1"
              style={{
                background:
                  'repeating-linear-gradient(45deg, var(--chart-1) 0 2px, transparent 2px 5px)',
              }}
            />
          )}
          {item.label}
        </span>
      ))}
    </div>
  )
}
