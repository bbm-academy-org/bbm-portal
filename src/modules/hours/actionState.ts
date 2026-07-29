import type { Assessment } from '@/lib/hours'

/**
 * Состояние формы, общее для всех Server Actions модуля часов.
 *
 * Живёт ОТДЕЛЬНО от `actions.ts` сознательно: модуль с директивой `'use server'`
 * имеет право экспортировать только асинхронные функции, а форме нужны ещё и
 * начальное значение, и тип. Держать их здесь — единственный способ не превратить
 * `IDLE_STATE` в лишний серверный вызов.
 */
export interface HoursActionState {
  status: 'idle' | 'ok' | 'error'
  /** Человеческое сообщение: отказ гейта или подтверждение. */
  message: string
  /** Мягкие предупреждения (ставка вне вилки, пересечение периодов). */
  warnings: string[]
  /** Снэпшот сохранённой оценки — для карточки «оценка сохранена» (п.21). */
  saved: Assessment | null
}

export const IDLE_STATE: HoursActionState = {
  status: 'idle',
  message: '',
  warnings: [],
  saved: null,
}
