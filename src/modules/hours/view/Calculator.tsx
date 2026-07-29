'use client'

import React from 'react'
import { useActionState, useState } from 'react'

import { computeAccrual, computeSplit, sliderMaxHours } from '@/lib/hours/formula'
import type { PeriodCalendar } from '@/lib/hours/formula'
import { formatHours, formatPercent, formatRub, formatWeeks } from '@/lib/hours/format'
import type { Assessment, AssessmentMethod, Period } from '@/lib/hours/types'
import { saveAssessmentAction } from '@/modules/hours/actions'
import { IDLE_STATE } from '@/modules/hours/actionState'

import { SavedCard } from './components'

/**
 * Калькулятор самооценки (спека 081 пп. 20, 21) — единственный клиентский
 * компонент страницы: живой пересчёт нужен на каждое движение ползунка, а
 * страницы остаются серверными (п.27).
 *
 * Импорты домена здесь ТОЧЕЧНЫЕ (`@/lib/hours/formula`, `.../format`), а не через
 * барель `@/lib/hours`: барель тянет `store.ts` с `node:fs`, которому в
 * клиентском бандле делать нечего.
 *
 * Отличия от прототипа владельца — по спеке: множители берутся от реального
 * периода (недели = будни ÷ 5, дни = будни периода), ставка не вводится руками,
 * а приходит из `participants`, сохранение идёт Server Action'ом на сервер,
 * а не в localStorage.
 */

const NBSP = ' '

export interface CalculatorProps {
  period: Period
  calendar: PeriodCalendar
  /** Месячная ставка участника; null — участника нет в списке (п.9). */
  monthlyRate: number | null
  /** Эффективная часовая периода — считает сервер (п.2). */
  effectiveHourly: number | null
  /** Email сессии: в форму уходит он, чужой сохранить нельзя (п.9). */
  email: string
  /** Уже сохранённая оценка за период — форма открывается с ней. */
  existing: Assessment | null
  /** Потолок часов от длины периода (п.21). */
  maxHours: number
  /** Почему сохранение недоступно; пусто — доступно. */
  disabledReason: string
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/** Заливка трека ползунка — та же механика, что в прототипе (`--p`). */
function trackStyle(value: number, max: number): React.CSSProperties {
  const percent = max > 0 ? clamp((value / max) * 100, 0, 100) : 0
  return { ['--p' as string]: `${percent}%` } as React.CSSProperties
}

function SliderRow({
  id,
  label,
  value,
  max,
  step,
  onChange,
}: {
  id: string
  label: string
  value: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <>
      <div className="hours-row-label">
        <span id={`${id}-label`}>{label}</span>
      </div>
      <div className="hours-slider-row">
        <input
          type="range"
          id={id}
          min={0}
          max={max}
          step={step}
          value={clamp(value, 0, max)}
          aria-labelledby={`${id}-label`}
          style={trackStyle(value, max)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          type="number"
          className="hours-num-input"
          id={`${id}-num`}
          min={0}
          step={step}
          value={value}
          aria-labelledby={`${id}-label`}
          onChange={(event) => {
            const parsed = Number(event.target.value)
            onChange(Number.isFinite(parsed) ? parsed : 0)
          }}
        />
      </div>
    </>
  )
}

export function Calculator(props: CalculatorProps) {
  const { calendar, effectiveHourly, existing, maxHours, period } = props
  const [state, formAction, pending] = useActionState(saveAssessmentAction, IDLE_STATE)

  const sliderMax = sliderMaxHours(calendar)
  const weekendMax = Math.max(Math.round(calendar.calendarDays * 4), 1)

  const initialMethod: AssessmentMethod = existing?.method ?? 'period'
  const initialWeekend = existing?.weekend_hours ?? 0
  const initialWeekdayPart = existing ? Math.max(existing.hours - initialWeekend, 0) : calendar.normHours

  const [method, setMethod] = useState<AssessmentMethod>(initialMethod)
  const [periodHours, setPeriodHours] = useState(
    initialMethod === 'period' ? round1(initialWeekdayPart) : round1(calendar.normHours),
  )
  const [periodWeekendOn, setPeriodWeekendOn] = useState(
    initialMethod === 'period' && initialWeekend > 0,
  )
  const [periodWeekendHours, setPeriodWeekendHours] = useState(
    initialMethod === 'period' ? round1(initialWeekend) : 0,
  )
  const [weekHours, setWeekHours] = useState(
    initialMethod === 'week' && calendar.weekMultiplier > 0
      ? round1((existing?.hours ?? 0) / calendar.weekMultiplier)
      : 40,
  )
  const [dayHours, setDayHours] = useState(
    initialMethod === 'day' && calendar.dayMultiplier > 0
      ? round1(initialWeekdayPart / calendar.dayMultiplier)
      : 8,
  )
  const [dayWeekendOn, setDayWeekendOn] = useState(initialMethod === 'day' && initialWeekend > 0)
  const [dayWeekendHours, setDayWeekendHours] = useState(
    initialMethod === 'day' ? round1(initialWeekend) : 0,
  )
  const [splitPercent, setSplitPercent] = useState(existing?.split_percent ?? 0)

  let hours = 0
  let weekendHours = 0
  let explanation: React.ReactNode = null

  if (method === 'period') {
    weekendHours = periodWeekendOn ? periodWeekendHours : 0
    hours = periodHours + weekendHours
    explanation =
      weekendHours > 0 ? (
        <>
          {formatHours(periodHours)}
          {NBSP}ч + {formatHours(weekendHours)}
          {NBSP}ч в выходные = <b>{formatHours(hours)}{NBSP}ч</b>
        </>
      ) : null
  } else if (method === 'week') {
    hours = weekHours * calendar.weekMultiplier
    explanation = (
      <>
        {formatHours(weekHours)}
        {NBSP}ч/нед × {formatWeeks(calendar.weekMultiplier)} недель ({calendar.weekdayCount} будних
        дней ÷ 5) = <b>{formatHours(hours)}{NBSP}ч</b>
      </>
    )
  } else {
    weekendHours = dayWeekendOn ? dayWeekendHours : 0
    hours = dayHours * calendar.dayMultiplier + weekendHours
    explanation = (
      <>
        {formatHours(dayHours)}
        {NBSP}ч × {calendar.dayMultiplier} будних дней
        {weekendHours > 0 ? ` + ${formatHours(weekendHours)}${NBSP}ч в выходные` : ''} ={' '}
        <b>{formatHours(hours)}{NBSP}ч</b>
      </>
    )
  }

  const roundedHours = round1(hours)
  const roundedWeekend = round1(weekendHours)
  const accrual = effectiveHourly == null ? null : computeAccrual(roundedHours, effectiveHourly)
  const split = accrual == null ? null : computeSplit(accrual, splitPercent)
  const overCeiling = roundedHours > maxHours

  const tabs: { id: AssessmentMethod; label: string }[] = [
    { id: 'period', label: 'Знаю часы за период' },
    { id: 'week', label: 'Знаю среднюю неделю' },
    { id: 'day', label: 'Знаю свой день' },
  ]

  return (
    <div className="hours-calc">
      <div className="hours-tabs" role="tablist" aria-label="Способ оценки часов">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`hours-tabbtn-${tab.id}`}
            aria-selected={method === tab.id}
            aria-controls={`hours-tab-${tab.id}`}
            onClick={() => setMethod(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className="hours-panel"
        id="hours-tab-period"
        role="tabpanel"
        aria-labelledby="hours-tabbtn-period"
        hidden={method !== 'period'}
      >
        <SliderRow
          id="hours-period"
          label="Часы за период"
          value={periodHours}
          max={sliderMax}
          step={1}
          onChange={setPeriodHours}
        />
        <label className="hours-check">
          <input
            type="checkbox"
            checked={periodWeekendOn}
            onChange={(event) => setPeriodWeekendOn(event.target.checked)}
          />{' '}
          Работал в выходные
        </label>
        <div className="hours-subblock" hidden={!periodWeekendOn}>
          <SliderRow
            id="hours-period-weekend"
            label="Часы в выходные"
            value={periodWeekendHours}
            max={weekendMax}
            step={1}
            onChange={setPeriodWeekendHours}
          />
        </div>
      </div>

      <div
        className="hours-panel"
        id="hours-tab-week"
        role="tabpanel"
        aria-labelledby="hours-tabbtn-week"
        hidden={method !== 'week'}
      >
        <SliderRow
          id="hours-week"
          label="Часов в неделю в среднем"
          value={weekHours}
          max={80}
          step={1}
          onChange={setWeekHours}
        />
        <p className="hours-note">
          Выходные уже внутри средней недели — отдельной галочки здесь нет.
        </p>
      </div>

      <div
        className="hours-panel"
        id="hours-tab-day"
        role="tabpanel"
        aria-labelledby="hours-tabbtn-day"
        hidden={method !== 'day'}
      >
        <SliderRow
          id="hours-day"
          label="Часов в рабочий день"
          value={dayHours}
          max={16}
          step={0.5}
          onChange={setDayHours}
        />
        <label className="hours-check">
          <input
            type="checkbox"
            checked={dayWeekendOn}
            onChange={(event) => setDayWeekendOn(event.target.checked)}
          />{' '}
          Работал в выходные
        </label>
        <div className="hours-subblock" hidden={!dayWeekendOn}>
          <SliderRow
            id="hours-day-weekend"
            label="Часы в выходные"
            value={dayWeekendHours}
            max={weekendMax}
            step={1}
            onChange={setDayWeekendHours}
          />
        </div>
      </div>

      {explanation ? <p className="hours-calc-line">{explanation}</p> : null}

      <div className="hours-result" aria-live="polite">
        <div className="hours-cap">Итог за период</div>
        <div className="hours-total">
          {formatHours(roundedHours)}
          <small>часов</small>
        </div>

        {accrual != null && split != null ? (
          <>
            <div className="hours-money">
              <div className="hours-hourly">
                Эффективная часовая ставка: <b>{formatRub(effectiveHourly)}</b>
              </div>
              <div className="hours-accrual">
                Начисление: <b>{formatRub(accrual)}</b>{' '}
                <small>
                  {formatHours(roundedHours)}
                  {NBSP}ч × {formatRub(effectiveHourly)}
                </small>
              </div>
            </div>

            <div className="hours-split">
              <div className="hours-row-label">
                <span>Сплит начисления</span>
                <b>
                  {splitPercent === 0
                    ? '100% деньгами'
                    : `${formatPercent(100 - splitPercent)} деньгами · ${formatPercent(splitPercent)} в 4X`}
                </b>
              </div>
              <div className="hours-slider-row">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={splitPercent}
                  aria-label="Доля доинвестиции в 4X, процентов"
                  style={trackStyle(splitPercent, 100)}
                  onChange={(event) => setSplitPercent(Number(event.target.value))}
                />
              </div>
              <div className="hours-split-bar" aria-hidden="true">
                <i className="hours-sb-cash" style={{ flex: 100 - splitPercent }} />
                <i className="hours-sb-inv" style={{ flex: splitPercent }} />
              </div>
              <div className="hours-split-legend">
                <span>
                  <i className="hours-dot" style={{ background: 'var(--baseline)' }} />
                  Забираю деньгами&nbsp;<b>{formatRub(split.cash)}</b>
                </span>
                <span>
                  <i className="hours-dot" style={{ background: 'var(--seq-3)' }} />
                  Оставляю доинвестицией в&nbsp;4X&nbsp;<b>{formatRub(split.invest)}</b>
                </span>
              </div>
            </div>
          </>
        ) : (
          <p className="hours-note">
            Начисление не показывается: месячной ставки для тебя нет. Часы посчитаны.
          </p>
        )}

        <form action={formAction}>
          <input type="hidden" name="periodId" value={period.id} />
          <input type="hidden" name="email" value={props.email} />
          <input type="hidden" name="method" value={method} />
          <input type="hidden" name="hours" value={roundedHours} />
          <input type="hidden" name="weekendHours" value={roundedWeekend} />
          <input type="hidden" name="splitPercent" value={splitPercent} />
          <div className="hours-actions">
            <button
              type="submit"
              className="hours-btn"
              disabled={Boolean(props.disabledReason) || pending || overCeiling}
            >
              {pending ? 'Сохраняю…' : 'Сохранить оценку'}
            </button>
            {props.disabledReason ? (
              <span className="hours-note">{props.disabledReason}</span>
            ) : null}
          </div>
        </form>

        {overCeiling ? (
          <p className="hours-notice hours-notice--error">
            В периоде физически {maxHours} часов — заявить больше нельзя.
          </p>
        ) : null}

        {state.status === 'error' ? (
          <p className="hours-notice hours-notice--error">{state.message}</p>
        ) : null}
        {state.status === 'ok' && state.saved ? (
          <SavedCard assessment={state.saved} periodLabel={period.label} />
        ) : null}
      </div>
    </div>
  )
}
