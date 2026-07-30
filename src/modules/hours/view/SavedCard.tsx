import React from 'react'

import {
  formatHours,
  formatPercent,
  formatRub,
  formatSavedAt,
  METHOD_LABELS,
} from '@/lib/hours/format'
import type { Assessment } from '@/lib/hours/types'

/**
 * Карточка «оценка сохранена» с итоговыми числами (спека 081 п.21).
 *
 * Живёт в СОБСТВЕННОМ файле, потому что её рендерит клиентский калькулятор:
 * лежи она в `components.tsx`, в клиентский бандл уехали бы заодно таблица
 * участников, сводка и все плашки страницы — модуль тянется целиком, по файлу,
 * а не по использованному экспорту. Здесь же зависимости минимальны: только
 * форматтеры и типы, ничего от `node:fs`.
 *
 * Компонент чистый и без состояния — одинаково годится и для серверного
 * рендера, и для клиентского.
 */
export function SavedCard({
  assessment,
  periodLabel,
  caption = 'Оценка сохранена',
}: {
  assessment: Assessment
  periodLabel: string
  /** Заголовок карточки: после сохранения и при повторном заходе он разный. */
  caption?: string
}) {
  return (
    <div className="hours-saved">
      <div className="hours-saved__cap">{caption}</div>
      <dl>
        <div>
          <dt>Период</dt>
          <dd>{periodLabel}</dd>
        </div>
        <div>
          <dt>Часы (итог)</dt>
          <dd>{formatHours(assessment.hours)} ч</dd>
        </div>
        <div>
          <dt>Из них в выходные</dt>
          <dd>{formatHours(assessment.weekend_hours)} ч</dd>
        </div>
        <div>
          <dt>Способ оценки</dt>
          <dd>{METHOD_LABELS[assessment.method]}</dd>
        </div>
        <div>
          <dt>Ставка</dt>
          <dd>
            {formatRub(assessment.monthly_rate)}/мес · {formatRub(assessment.hourly_rate)}/ч
          </dd>
        </div>
        <div>
          <dt>Начисление</dt>
          <dd>{formatRub(assessment.accrual)}</dd>
        </div>
        <div>
          <dt>Деньгами</dt>
          <dd>
            {formatRub(assessment.cash_amount)} ({formatPercent(100 - assessment.split_percent)})
          </dd>
        </div>
        <div>
          <dt>Оставлено в проекте</dt>
          <dd>
            {formatRub(assessment.invest_amount)} ({formatPercent(assessment.split_percent)})
          </dd>
        </div>
        <div>
          <dt>Сохранена</dt>
          <dd>{formatSavedAt(assessment.saved_at)}</dd>
        </div>
      </dl>
    </div>
  )
}
