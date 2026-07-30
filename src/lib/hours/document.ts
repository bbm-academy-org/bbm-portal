/**
 * Операции над JSON-документом модуля часов (спека 081 пп. 14–16, 21, 23, 24).
 *
 * Все функции здесь — ЧИСТЫЕ: принимают документ, возвращают новый документ (или
 * отказ) и не касаются ни файловой системы, ни сессии. Файл и мьютекс живут в
 * `store.ts`, гейты — в `access.ts`. Так валидации, снэпшоты и freeze закрытого
 * периода тестируются без диска и без IdP.
 *
 * Жёсткая валидация возвращает `{ ok: false, error }` — мутация не происходит;
 * мягкая (`warnings`) сохраняет и предупреждает: владелец может сознательно выйти
 * за вилку (п.23) или пересечь периоды (п.24).
 */

import { countWeekdays, isValidIsoDate } from './calendar'
import { normalizeEmail } from './access'
// Склонение по числу живёт в format.ts (там же, где METHOD_LABELS): это домен,
// а не вью, и второй копии правила «11–14 — исключение» быть не должно.
import { formatHoursCount, plural } from './format'
import {
  computeAccrual,
  computeSplit,
  describePeriod,
  effectiveHourlyRate,
  maxDeclarableHours,
  participantMonthlyRate,
} from './formula'
import type { PeriodCalendar } from './formula'
import type {
  Assessment,
  AssessmentMethod,
  Grade,
  HoursDocument,
  Participant,
  Period,
  PeriodStatus,
} from './types'

export type Failure = { ok: false; error: string }
export type Success<T> = { ok: true; doc: HoursDocument; warnings: string[]; saved: T }
export type MutationResult<T> = Success<T> | Failure

const GRADES: Grade[] = ['I', 'II', 'III']
const METHODS: AssessmentMethod[] = ['period', 'week', 'day']

function fail(error: string): Failure {
  return { ok: false, error }
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Находит период по id. */
export function findPeriod(doc: HoursDocument, periodId: string): Period | undefined {
  return doc.periods.find((period) => period.id === periodId)
}

/** Находит участника по email (email нормализуется). */
export function findParticipant(doc: HoursDocument, email: string): Participant | undefined {
  const normalized = normalizeEmail(email)
  return doc.participants.find((participant) => participant.email === normalized)
}

/** Находит оценку по паре (период, email) — одна запись на пару (п.14). */
export function findAssessment(
  doc: HoursDocument,
  periodId: string,
  email: string,
): Assessment | undefined {
  const normalized = normalizeEmail(email)
  return doc.assessments.find(
    (assessment) => assessment.period_id === periodId && assessment.email === normalized,
  )
}

/** Единственный открытый период (п.14) — их не может быть двое. */
export function findOpenPeriod(doc: HoursDocument): Period | undefined {
  return doc.periods.find((period) => period.status === 'open')
}

/**
 * Какой период показывать в сводке (п.22): явно выбранный в селекторе, иначе
 * открытый, иначе последний закрытый (по дате конца). Ни одного периода —
 * `undefined`, страница скажет об этом прямо.
 */
export function pickSummaryPeriod(
  doc: HoursDocument,
  requestedId?: string | null,
): Period | undefined {
  if (requestedId) {
    const requested = findPeriod(doc, requestedId)
    if (requested) return requested
  }
  const open = findOpenPeriod(doc)
  if (open) return open
  return doc.periods.reduce<Period | undefined>((latest, period) => {
    if (!latest) return period
    return period.date_to >= latest.date_to ? period : latest
  }, undefined)
}

export interface SaveAssessmentInput {
  periodId: string
  email: string
  hours: number
  method: AssessmentMethod
  weekendHours: number
  splitPercent: number
}

/**
 * Сохраняет (или пересохраняет) самооценку участника за период.
 *
 * Снэпшоты считаются на момент сохранения по ТЕКУЩЕЙ ставке участника и задним
 * числом не пересчитываются (п.15) — смена ставки чужие записи не трогает.
 * Проверка «email свой» живёт в Server Action (сравнение с сессией) — здесь
 * проверяется, что такой участник вообще существует.
 */
export function saveAssessment(
  doc: HoursDocument,
  input: SaveAssessmentInput,
  now: string,
): MutationResult<Assessment> {
  const period = findPeriod(doc, input.periodId)
  if (!period) return fail('Период не найден — обнови страницу.')
  if (period.status !== 'open') {
    return fail(`Период «${period.label}» закрыт — оценки в него больше не принимаются.`)
  }

  const email = normalizeEmail(input.email)
  const participant = findParticipant(doc, email)
  if (!participant) {
    return fail('Такой участник не заведён — обратись к администратору.')
  }

  if (!METHODS.includes(input.method)) return fail('Неизвестный способ оценки.')
  if (!isNonNegativeNumber(input.hours)) return fail('Часы должны быть числом не меньше нуля.')
  if (!isNonNegativeNumber(input.weekendHours)) {
    return fail('Часы в выходные должны быть числом не меньше нуля.')
  }
  if (input.weekendHours > input.hours) {
    return fail('Часы в выходные не могут превышать итог часов за период.')
  }
  if (
    typeof input.splitPercent !== 'number' ||
    !Number.isFinite(input.splitPercent) ||
    input.splitPercent < 0 ||
    input.splitPercent > 100
  ) {
    return fail('Доля, оставляемая в проекте, должна быть от 0 до 100 процентов.')
  }

  const calendar = describePeriod(period.date_from, period.date_to)
  const ceiling = maxDeclarableHours(calendar)
  if (input.hours > ceiling) {
    return fail(
      `В периоде «${period.label}» физически ${formatHoursCount(ceiling)} — заявить больше нельзя.`,
    )
  }

  // Ставка вычисляется из вилки и грейда на момент сохранения (решение
  // владельца 2026-07-30); участник без вилки сохраняет «только часы» —
  // деньги в снэпшоте нулевые, ставка null.
  const monthlyRate = participantMonthlyRate(participant)
  const hourlyRate = effectiveHourlyRate(monthlyRate, calendar)
  const accrual = hourlyRate == null ? 0 : computeAccrual(input.hours, hourlyRate)
  const { cash, invest } = computeSplit(accrual, input.splitPercent)

  const assessment: Assessment = {
    period_id: period.id,
    email,
    hours: input.hours,
    method: input.method,
    weekend_hours: input.weekendHours,
    split_percent: input.splitPercent,
    monthly_rate: monthlyRate,
    hourly_rate: hourlyRate,
    accrual,
    cash_amount: cash,
    invest_amount: invest,
    weekday_count: calendar.weekdayCount,
    saved_at: now,
  }

  const assessments = doc.assessments.filter(
    (existing) => !(existing.period_id === period.id && existing.email === email),
  )
  assessments.push(assessment)

  return { ok: true, doc: { ...doc, assessments }, warnings: [], saved: assessment }
}

export interface UpsertParticipantInput {
  email: string
  name: string
  /** Роль, вилка и грейд необязательны (решение владельца 2026-07-30):
   * участника можно завести только с именем и email. */
  role: string | null
  forkMin: number | null
  forkMax: number | null
  grade: Grade | null
}

/**
 * Добавляет или правит участника по email (смена email отсутствует — п.16).
 * Ставка не вводится: она вычисляется из вилки и грейда
 * (`participantMonthlyRate`), поэтому и предупреждения «вне вилки» больше нет —
 * жёстко валидируется только сама вилка (min ≤ max), и только когда задана.
 */
export function upsertParticipant(
  doc: HoursDocument,
  input: UpsertParticipantInput,
): MutationResult<Participant> {
  const email = normalizeEmail(input.email)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail('Нужен корректный email участника.')
  }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return fail('Нужно имя участника.')
  const role = typeof input.role === 'string' && input.role.trim() ? input.role.trim() : null
  if (input.grade != null && !GRADES.includes(input.grade)) {
    return fail('Грейд может быть только I, II или III.')
  }
  if (input.forkMin != null && !isNonNegativeNumber(input.forkMin)) {
    return fail('Границы вилки должны быть числами не меньше нуля.')
  }
  if (input.forkMax != null && !isNonNegativeNumber(input.forkMax)) {
    return fail('Границы вилки должны быть числами не меньше нуля.')
  }
  if (input.forkMin != null && input.forkMax != null && input.forkMin > input.forkMax) {
    return fail('Нижняя граница вилки больше верхней — так вилка не бывает.')
  }

  const participant: Participant = {
    email,
    name,
    role,
    fork_min: input.forkMin,
    fork_max: input.forkMax,
    grade: input.grade,
  }

  const index = doc.participants.findIndex((existing) => existing.email === email)
  const participants = [...doc.participants]
  if (index >= 0) participants[index] = participant
  else participants.push(participant)

  return { ok: true, doc: { ...doc, participants }, warnings: [], saved: participant }
}

export interface PeriodInput {
  label: string
  dateFrom: string
  dateTo: string
}

/** Жёсткие валидации периода, общие для создания и правки (п.24). */
function validatePeriodInput(input: PeriodInput): { label: string } | Failure {
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  if (!label) return fail('Нужно название периода.')
  if (!isValidIsoDate(input.dateFrom) || !isValidIsoDate(input.dateTo)) {
    return fail('Даты периода должны быть в формате ГГГГ-ММ-ДД.')
  }
  if (input.dateFrom > input.dateTo) {
    return fail('Начало периода позже его конца.')
  }
  if (countWeekdays(input.dateFrom, input.dateTo) === 0) {
    return fail('В периоде нет ни одного буднего дня — ставку по нему посчитать нельзя.')
  }
  return { label }
}

/** Пересечения по датам — мягкое предупреждение (п.24). */
function overlapWarnings(doc: HoursDocument, input: PeriodInput, selfId?: string): string[] {
  const overlapping = doc.periods.filter(
    (period) =>
      period.id !== selfId && period.date_from <= input.dateTo && input.dateFrom <= period.date_to,
  )
  if (overlapping.length === 0) return []
  return [
    `Даты пересекаются с периодом ${overlapping.map((p) => `«${p.label}»`).join(', ')} — сохранено как есть.`,
  ]
}

/** Создаёт период. Новый период всегда закрыт — открытие отдельным действием. */
export function createPeriod(
  doc: HoursDocument,
  input: PeriodInput,
  id: string,
): MutationResult<Period> {
  const validated = validatePeriodInput(input)
  if ('ok' in validated) return validated

  const period: Period = {
    id,
    label: validated.label,
    date_from: input.dateFrom,
    date_to: input.dateTo,
    status: 'closed',
  }
  return {
    ok: true,
    doc: { ...doc, periods: [...doc.periods, period] },
    warnings: overlapWarnings(doc, input),
    saved: period,
  }
}

/**
 * Пересчитывает производные поля оценки от НОВОГО календаря периода
 * (issue #85, пп. 16/24).
 *
 * Источник ставки — сохранённый снэпшот `monthly_rate` самой оценки, а НЕ
 * текущая вилка/грейд участника: канон п.15 («смена вилки или грейда не трогает
 * сохранённые оценки») правкой дат не отменяется. Меняются только те числа,
 * которые вычисляются из календаря: эффективная часовая (п.2), начисление,
 * сплит (п.5) и число будней.
 *
 * `monthly_rate === null` — оценка сохранялась в режиме «только часы»:
 * `effectiveHourlyRate` вернёт `null`, начисление и обе доли останутся
 * нулевыми ровно как в `saveAssessment`. Порядок округления тот же (п.6):
 * округляется произведение, потом доинвестиция, деньги — остаток.
 *
 * Границы, названные вслух (ревью PR #86):
 *   - производные поля выводятся ИЗ ФОРМУЛЫ, поэтому смена дат безвозвратно
 *     перетирает числа, вписанные в JSON руками через владельческий
 *     escape-hatch (пп. 16/24), и снэпшоты, посчитанные до смены механики
 *     ставки 2026-07-30. Обратимость правки (в отличие от удаления) верна
 *     только для чисел, изначально посчитанных этой же формулой;
 *   - `weekend_hours` и `method` НЕ пересчитываются и не проверяются против
 *     нового диапазона: оба — свойства декларации участника («сколько из часов
 *     пришлось на выходные», «какой вкладкой считал»), а не календаря.
 *     Авторитетно поле `hours`; деньги ни из того, ни из другого не считаются,
 *     и плашка на каждую правку дат стоила бы владельцу внимания дороже, чем
 *     стоит справочное поле. Единственная несогласованность, о которой домен
 *     всё же говорит, — часы больше физического потолка (см. `updatePeriod`):
 *     их домен заново уже не принял бы.
 */
function recalculateAssessment(assessment: Assessment, calendar: PeriodCalendar): Assessment {
  const hourlyRate = effectiveHourlyRate(assessment.monthly_rate, calendar)
  const accrual = hourlyRate == null ? 0 : computeAccrual(assessment.hours, hourlyRate)
  const { cash, invest } = computeSplit(accrual, assessment.split_percent)
  return {
    ...assessment,
    hourly_rate: hourlyRate,
    accrual,
    cash_amount: cash,
    invest_amount: invest,
    weekday_count: calendar.weekdayCount,
  }
}

/**
 * Правит label и даты периода (пп. 16, 24). Оценки правку больше НЕ блокируют
 * (issue #85): опечатка в дате иначе оставалась неисправимой из UI, а
 * escape-hatch «владелец правит JSON» для этого случая слишком дорог.
 *
 * Семантика смены дат — решение владельца: производные поля всех оценок периода
 * пересчитываются СРАЗУ (иначе в сводке жили бы числа от несуществующего
 * календаря), но от снэпшота ставки каждой оценки. Правка одного label
 * пересчёта не запускает — пересчитывать нечего, и лишнее предупреждение
 * владельца бы только путало. Удаление периода с оценками остаётся закрытым
 * (`deletePeriod`): у него обратного хода нет.
 */
export function updatePeriod(
  doc: HoursDocument,
  input: PeriodInput & { id: string },
): MutationResult<Period> {
  const existing = findPeriod(doc, input.id)
  if (!existing) return fail('Период не найден — обнови страницу.')
  const validated = validatePeriodInput(input)
  if ('ok' in validated) return validated

  const period: Period = {
    ...existing,
    label: validated.label,
    date_from: input.dateFrom,
    date_to: input.dateTo,
  }
  const warnings = overlapWarnings(doc, input, input.id)

  const datesChanged =
    existing.date_from !== input.dateFrom || existing.date_to !== input.dateTo
  const affected = datesChanged
    ? doc.assessments.filter((assessment) => assessment.period_id === input.id)
    : []

  let assessments = doc.assessments
  if (affected.length > 0) {
    const calendar = describePeriod(input.dateFrom, input.dateTo)
    assessments = doc.assessments.map((assessment) =>
      assessment.period_id === input.id ? recalculateAssessment(assessment, calendar) : assessment,
    )
    warnings.push(
      `Пересчитано по новым датам: ${affected.length} ` +
        `${plural(affected.length, 'оценка', 'оценки', 'оценок')}; ` +
        'ставки на момент декларации сохранены.',
    )

    // Сжатие периода может оставить часы, которых в нём физически нет (п.21).
    // Это не повод блокировать исправление опечатки, но и молчать нельзя:
    // такие данные домен заново уже не принял бы.
    const ceiling = maxDeclarableHours(calendar)
    const over = affected.filter((assessment) => assessment.hours > ceiling)
    if (over.length > 0) {
      // Путь починки называется целиком: закрытый период — самый частый случай
      // правки задним числом, а в него `saveAssessment` не пускает вовсе, и
      // совет «пусть участник пересохранит» упёрся бы в отказ (п.21/24).
      warnings.push(
        `В новом диапазоне физически ${formatHoursCount(ceiling)}, а больше заявлено в ` +
          `${over.length} ${plural(over.length, 'оценке', 'оценках', 'оценках')} — ` +
          'сохранены как есть. Поправить их может сам участник пересохранением; ' +
          'если период закрыт — сначала переоткрой его.',
      )
    }
  }

  return {
    ok: true,
    doc: {
      ...doc,
      periods: doc.periods.map((p) => (p.id === input.id ? period : p)),
      assessments,
    },
    warnings,
    saved: period,
  }
}

/** Удаляет период, пока по нему нет ни одной оценки (п.16). */
export function deletePeriod(doc: HoursDocument, periodId: string): MutationResult<Period> {
  const existing = findPeriod(doc, periodId)
  if (!existing) return fail('Период не найден — обнови страницу.')
  if (doc.assessments.some((assessment) => assessment.period_id === periodId)) {
    return fail(`По периоду «${existing.label}» уже есть оценки — удалить его нельзя.`)
  }
  return {
    ok: true,
    doc: { ...doc, periods: doc.periods.filter((period) => period.id !== periodId) },
    warnings: [],
    saved: existing,
  }
}

/**
 * Открывает или закрывает период. Открытым может быть максимум один (п.24);
 * закрытый переоткрывается — это путь исправить опечатку перед выплатой 3-го.
 */
export function setPeriodStatus(
  doc: HoursDocument,
  periodId: string,
  status: PeriodStatus,
): MutationResult<Period> {
  const existing = findPeriod(doc, periodId)
  if (!existing) return fail('Период не найден — обнови страницу.')
  if (status === 'open') {
    const open = doc.periods.find((period) => period.status === 'open' && period.id !== periodId)
    if (open) {
      return fail(`Уже открыт период «${open.label}» — сначала закрой его.`)
    }
  }
  const period: Period = { ...existing, status }
  return {
    ok: true,
    doc: { ...doc, periods: doc.periods.map((p) => (p.id === periodId ? period : p)) },
    warnings: [],
    saved: period,
  }
}
