'use client'

import React from 'react'
import { useRouter } from 'next/navigation'

import { formatIsoDate } from '@/lib/hours/format'
import type { Period } from '@/lib/hours/types'

/**
 * Селектор периода сводки (спека 081 п.22): в списке ВСЕ периоды, выбор уезжает
 * в query-параметр — так состояние живёт в URL, страница остаётся серверной и
 * ссылку на конкретный период можно кому-то отправить.
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
  const router = useRouter()
  return (
    <label className="hours-field">
      <span>Период сводки</span>
      <select
        value={selectedId}
        onChange={(event) => router.push(`${basePath}?period=${encodeURIComponent(event.target.value)}`)}
      >
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {period.label} · {formatIsoDate(period.date_from)}—{formatIsoDate(period.date_to)}
            {period.status === 'open' ? ' · открыт' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
