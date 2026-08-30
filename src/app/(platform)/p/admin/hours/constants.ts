import type { HttpError } from '@refinedev/core'

export const HOURS_PERIOD_RESOURCE = 'hours.periods'
export const HOURS_PARTICIPANT_RESOURCE = 'hours.participants'

export function errorMessage(error: HttpError | null | undefined, fallback: string): string {
  return error?.message?.trim() || fallback
}

export function rubles(value: number | null): string {
  return value == null ? '—' : `${new Intl.NumberFormat('ru-RU').format(value)} ₽`
}

export function dateLabel(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}
