import React from 'react'

import { formatIsoDate } from '@/lib/hours/format'
import type { Period } from '@/lib/hours/types'

/**
 * Селектор периода сводки (спека 081 п.22): в списке ВСЕ периоды, выбор уезжает
 * в query-параметр — состояние живёт в URL, ссылку на конкретный период можно
 * кому-то отправить.
 *
 * Обычная GET-форма, а не клиентский компонент с роутером: выбор периода — это
 * навигация, а навигация в вебе уже работает без JS. Заодно страница остаётся
 * целиком серверной (п.27).
 */
export function PeriodSelect({
  periods,
  selectedId,
  basePath,
}: {
  periods: Period[]
  selectedId: string
  basePath: string
}) {
  return (
    <form method="get" action={basePath} className="hours-actions">
      <label className="hours-field">
        <span>Период сводки</span>
        <select name="period" defaultValue={selectedId}>
          {periods.map((period) => (
            <option key={period.id} value={period.id}>
              {period.label} · {formatIsoDate(period.date_from)}—{formatIsoDate(period.date_to)}
              {period.status === 'open' ? ' · открыт' : ''}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="hours-btn hours-btn--ghost">
        Показать
      </button>
    </form>
  )
}
