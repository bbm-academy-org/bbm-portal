import React from 'react'

import {
  formatHours,
  formatIsoDate,
  formatPercent,
  formatRub,
  formatSavedAt,
  formatWeekdayCount,
  METHOD_LABELS,
} from '@/lib/hours/format'
import { effectiveHourlyRate, monthlyHourlyRate } from '@/lib/hours/formula'
import type { PeriodCalendar } from '@/lib/hours/formula'
import type { Assessment, Period } from '@/lib/hours/types'

/**
 * Презентационные компоненты страницы часов (спека 081 пп. 8, 9, 19, 20, 22).
 * Все — серверные и без состояния; клиентская интерактивность живёт отдельно
 * (Calculator.tsx, п.27). Это те самые экраны, которые владелец смотрит на
 * приёмке, поэтому каждый закрыт markup-тестом.
 *
 * Этот файл НИКОГДА не импортируется клиентским компонентом: бандлер тянет
 * модуль целиком, и одна карточка утащила бы за собой всю страницу. Всё, что
 * нужно и клиенту, вынесено отдельными файлами: SavedCard.tsx (нужна
 * калькулятору) и ParticipantsTable.tsx (нужна обвязке админки, issue #85) —
 * факт проверяется тестом, а не соглашением.
 */

/** «Вошёл как <email>» — так email-claim Zitadel проверяется глазами (п.8). */
export function SignedInAs({ email }: { email: string }) {
  if (!email) {
    return (
      <p className="hours-session">
        В сессии нет email — сохранить оценку не получится. Открой доступ к claim&nbsp;email в
        Zitadel и войди заново.
      </p>
    )
  }
  return (
    <p className="hours-session">
      Вошёл как <b>{email}</b>
    </p>
  )
}

/** Плашка для залогиненного, которого нет в participants (п.9, сценарий 7). */
export function NotAParticipantNotice() {
  return (
    <p className="hours-notice hours-notice--warn">
      Тебя нет в списке участников — обратись к администратору. Часы посчитать можно, начисление не
      показывается: ставки нет.
    </p>
  )
}

/** Плашка «данные недоступны» — недоступная база не молчит (081 п.17, спека 124 EARS-12). */
export function DataUnavailable() {
  return (
    <p className="hours-notice hours-notice--error">
      Данные недоступны: база модуля часов не отвечает. Оценки не тронуты — позови администратора.
    </p>
  )
}

/** Периодов ещё не создавали (п.22). */
export function NoPeriodsNotice() {
  return (
    <p className="hours-notice">
      Периодов пока нет — администратор ещё не создал ни одного. Как только период откроют, здесь
      появится калькулятор.
    </p>
  )
}

/** Заголовок периода: label, диапазон дат, число будних дней (п.20). */
export function PeriodHeader({ period, calendar }: { period: Period; calendar: PeriodCalendar }) {
  return (
    <div className="hours-period">
      <div className="hours-period__label">
        {period.label}
        {period.status === 'closed' ? <span className="hours-period__status">закрыт</span> : null}
      </div>
      <div className="hours-period__meta">
        {formatIsoDate(period.date_from)} — {formatIsoDate(period.date_to)} ·{' '}
        {formatWeekdayCount(calendar.weekdayCount)} · норма {formatHours(calendar.normHours)} ч
      </div>
    </div>
  )
}

/**
 * Честная формула (п.20): число будней периода, а для многомесячного — ещё и
 * помесячная разбивка, потому что ставка часа считается по полному календарному
 * месяцу (п.2). Без ставки участника денежная часть не показывается вовсе (п.9).
 */
export function FormulaBreakdown({
  calendar,
  monthlyRate,
}: {
  calendar: PeriodCalendar
  monthlyRate: number | null
}) {
  const effective = effectiveHourlyRate(monthlyRate, calendar)
  const multiMonth = calendar.months.length > 1

  return (
    <div className="hours-formula">
      <p className="hours-calc-line">
        В периоде <b>{formatWeekdayCount(calendar.weekdayCount)}</b> · норма{' '}
        <b>{formatHours(calendar.normHours)} ч</b> ({calendar.weekdayCount} × 8)
      </p>
      {effective == null ? (
        <p className="hours-note">Месячной ставки нет — считаем только часы, без начисления.</p>
      ) : (
        <>
          <p className="hours-calc-line">
            {multiMonth ? 'Эффективная часовая ставка периода' : 'Часовая ставка'}:{' '}
            <b>{formatRub(effective)}</b> при месячной {formatRub(monthlyRate)}
          </p>
          {multiMonth ? (
            <ul className="hours-months">
              {calendar.months.map((month) => (
                <li
                  key={`${month.year}-${month.month}`}
                  data-month={`${month.year}-${month.month}`}
                >
                  {month.label}: {month.weekdaysInMonth} будней месяца ·{' '}
                  {formatHours(month.monthNormHours)} ч · ставка часа{' '}
                  <b>{formatRub(monthlyHourlyRate(monthlyRate, month.monthNormHours))}</b> · доля
                  периода {formatHours(month.normHours)} ч
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  )
}

export interface SummaryRow {
  /** Имя из списка участников; null — участника уже нет, показываем email. */
  name: string | null
  assessment: Assessment
}

/** Сводка оценок периода — основа открытой верификации 2-го числа (п.22). */
export function SummaryTable({ rows }: { rows: SummaryRow[] }) {
  if (rows.length === 0) {
    return <p className="hours-notice">За этот период оценок пока нет.</p>
  }
  return (
    <div className="hours-table-scroll">
      <table className="hours-table">
        <thead>
          <tr>
            <th scope="col">Участник</th>
            <th scope="col">Часы</th>
            <th scope="col">Способ</th>
            <th scope="col">Начисление</th>
            <th scope="col">Деньгами</th>
            {/* Лексика владельца (issue #83 п.9): оставленное в проекте
                увеличивает долю участника; 4X — механизм учёта, не витрина. */}
            <th scope="col">В проекте</th>
            <th scope="col">Сохранена</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.assessment.email}>
              <td>{row.name ?? row.assessment.email}</td>
              <td className="hours-num">
                {formatHours(row.assessment.hours)}
                {row.assessment.weekend_hours > 0
                  ? ` (в выходные ${formatHours(row.assessment.weekend_hours)})`
                  : ''}
              </td>
              <td>{METHOD_LABELS[row.assessment.method]}</td>
              <td className="hours-num">{formatRub(row.assessment.accrual)}</td>
              <td className="hours-num">
                {formatRub(row.assessment.cash_amount)} (
                {formatPercent(100 - row.assessment.split_percent)})
              </td>
              <td className="hours-num">
                {formatRub(row.assessment.invest_amount)} (
                {formatPercent(row.assessment.split_percent)})
              </td>
              <td>{formatSavedAt(row.assessment.saved_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
