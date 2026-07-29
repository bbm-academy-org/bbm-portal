/**
 * Структура JSON-документа модуля часов (спека 081 п.14). Одна БД-таблица тут
 * не нужна: документ читается целиком на каждый запрос и переписывается целиком
 * под мьютексом (п.12–13).
 *
 * Имена полей — snake_case: документ читает не только приложение, но и человек
 * (владелец скачивает JSON, п.25) и внешний агент, собирающий MM-рассылку
 * (п.26). Это внешний контракт данных, а не внутренний тип.
 */

/** Метка грейда участника (ставка задаётся отдельно и явно — п.14). */
export type Grade = 'I' | 'II' | 'III'

/** Способ оценки — вкладка калькулятора, которой считал участник (п.20). */
export type AssessmentMethod = 'period' | 'week' | 'day'

/** Статус периода; одновременно открыт максимум один (п.14, п.24). */
export type PeriodStatus = 'open' | 'closed'

export interface Participant {
  /** Ключ, всегда lowercase. Смена email в админке отсутствует (п.16). */
  email: string
  name: string
  role: string
  /** Рыночная вилка роли, ₽/мес. */
  fork_min: number
  fork_max: number
  grade: Grade
  /** Точка вилки, ₽/мес — задаётся админом явно, НЕ вычисляется из грейда. */
  monthly_rate: number
}

export interface Period {
  id: string
  label: string
  /** ISO-даты, обе границы включительно. */
  date_from: string
  date_to: string
  status: PeriodStatus
}

export interface Assessment {
  period_id: string
  email: string
  /** Итог часов за период, ВКЛЮЧАЯ выходные (п.4). */
  hours: number
  method: AssessmentMethod
  /** Справочно: сколько из `hours` пришлось на выходные (0 ≤ x ≤ hours). */
  weekend_hours: number
  /** Доля доинвестиции в 4X, 0–100. */
  split_percent: number

  // --- Снэпшоты на момент сохранения (п.14, п.15) ---
  /** Месячная ставка участника на момент декларации. */
  monthly_rate: number
  /** Эффективная часовая периода (п.2); null — если денег быть не может. */
  hourly_rate: number | null
  accrual: number
  cash_amount: number
  invest_amount: number
  weekday_count: number
  /** ISO timestamp. */
  saved_at: string
}

export interface HoursDocument {
  participants: Participant[]
  periods: Period[]
  assessments: Assessment[]
}

/** Пустая структура — первый запуск на чистом volume (п.17). */
export function emptyHoursDocument(): HoursDocument {
  return { participants: [], periods: [], assessments: [] }
}
