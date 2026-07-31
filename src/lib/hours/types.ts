/**
 * Структура JSON-документа модуля часов (спека 081 п.14). Одна БД-таблица тут
 * не нужна: документ читается целиком на каждый запрос и переписывается целиком
 * под мьютексом (п.12–13).
 *
 * Имена полей — snake_case: документ читает не только приложение, но и человек
 * (владелец скачивает JSON, п.25) и внешний агент, собирающий MM-рассылку
 * (п.26). Это внешний контракт данных, а не внутренний тип.
 */

/**
 * Грейд участника — точка внутри вилки (канон механики выплат, решение
 * владельца 2026-07-30): ставка ВЫЧИСЛЯЕТСЯ из вилки и грейда, не хранится.
 */
export type Grade = 'I' | 'II' | 'III'

/** Способ оценки — вкладка калькулятора, которой считал участник (п.20). */
export type AssessmentMethod = 'period' | 'week' | 'day'

/** Статус периода; одновременно открыт максимум один (п.14, п.24). */
export type PeriodStatus = 'open' | 'closed'

export interface Participant {
  /** Ключ, всегда lowercase. Смена email в админке отсутствует (п.16). */
  email: string
  name: string
  /** Роль, вилка и грейд необязательны: участника можно завести только с
   * именем и email (решение владельца 2026-07-30, issue #83). Пока вилка и
   * грейд не заполнены, ставка не вычисляется — режим «только часы». */
  role?: string | null
  /** Рыночная вилка роли, ₽/мес. */
  fork_min?: number | null
  fork_max?: number | null
  grade?: Grade | null
  // Поле `monthly_rate` из документов до 2026-07-30 при чтении игнорируется:
  // ставка — чистая функция от вилки и грейда (`participantMonthlyRate`).
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
  /** Доля начисления, оставляемая в проекте (учёт — в 4X по номиналу), 0–100. */
  split_percent: number

  // --- Снэпшоты на момент сохранения (п.14, п.15) ---
  /** Вычисленная месячная ставка на момент декларации; null — вилки/грейда
   * не было, оценка сохранена в режиме «только часы». */
  monthly_rate: number | null
  /** Эффективная часовая периода (п.2); null — если денег быть не может. */
  hourly_rate: number | null
  accrual: number
  cash_amount: number
  invest_amount: number
  weekday_count: number
  /** ISO timestamp. */
  saved_at: string
}

export type PublicationDelivery = 'pending' | 'sent' | 'failed' | 'unknown'

export type PublicationStatus = 'sending' | 'published' | 'incomplete'

export interface PublicationMessage {
  email: string
  /** Exact Mattermost Markdown frozen before the first network request. */
  text: string
  delivery: PublicationDelivery
  sent_at: string | null
}

export interface Publication {
  period_id: string
  status: PublicationStatus
  started_at: string
  published_at: string | null
  /** Opaque digest of the period, assessments and current participant identity. */
  preview_fingerprint: string
  messages: PublicationMessage[]
}

export interface HoursDocument {
  participants: Participant[]
  periods: Period[]
  assessments: Assessment[]
  /**
   * Optional in legacy/on-disk input. Store reads and empty documents always
   * normalize it to `[]`; domain functions also accept direct legacy fixtures.
   */
  publications?: Publication[]
}

/** Пустая структура — первый запуск на чистом volume (п.17). */
export function emptyHoursDocument(): HoursDocument {
  return { participants: [], periods: [], assessments: [], publications: [] }
}
