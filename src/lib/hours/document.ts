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
import {
  computeAccrual,
  computeSplit,
  describePeriod,
  effectiveHourlyRate,
  maxDeclarableHours,
} from './formula'
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
    return fail('Доля доинвестиции должна быть от 0 до 100 процентов.')
  }

  const calendar = describePeriod(period.date_from, period.date_to)
  const ceiling = maxDeclarableHours(calendar)
  if (input.hours > ceiling) {
    return fail(
      `В периоде «${period.label}» физически ${ceiling} часов — заявить больше нельзя.`,
    )
  }

  const hourlyRate = effectiveHourlyRate(participant.monthly_rate, calendar)
  const accrual = hourlyRate == null ? 0 : computeAccrual(input.hours, hourlyRate)
  const { cash, invest } = computeSplit(accrual, input.splitPercent)

  const assessment: Assessment = {
    period_id: period.id,
    email,
    hours: input.hours,
    method: input.method,
    weekend_hours: input.weekendHours,
    split_percent: input.splitPercent,
    monthly_rate: participant.monthly_rate,
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
  role: string
  forkMin: number
  forkMax: number
  grade: Grade
  monthlyRate: number
}

/** Добавляет или правит участника по email (смена email отсутствует — п.16). */
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
  const role = typeof input.role === 'string' ? input.role.trim() : ''
  if (!role) return fail('Нужна роль участника.')
  if (!GRADES.includes(input.grade)) return fail('Грейд может быть только I, II или III.')
  if (!isNonNegativeNumber(input.forkMin) || !isNonNegativeNumber(input.forkMax)) {
    return fail('Границы вилки должны быть числами не меньше нуля.')
  }
  if (!isNonNegativeNumber(input.monthlyRate)) {
    return fail('Месячная ставка должна быть числом не меньше нуля.')
  }
  if (input.forkMin > input.forkMax) {
    return fail('Нижняя граница вилки больше верхней — так вилка не бывает.')
  }

  const warnings: string[] = []
  if (input.monthlyRate < input.forkMin || input.monthlyRate > input.forkMax) {
    warnings.push(
      `Месячная ставка ${input.monthlyRate} вне вилки ${input.forkMin}–${input.forkMax} — сохранено как есть.`,
    )
  }

  const participant: Participant = {
    email,
    name,
    role,
    fork_min: input.forkMin,
    fork_max: input.forkMax,
    grade: input.grade,
    monthly_rate: input.monthlyRate,
  }

  const index = doc.participants.findIndex((existing) => existing.email === email)
  const participants = [...doc.participants]
  if (index >= 0) participants[index] = participant
  else participants.push(participant)

  return { ok: true, doc: { ...doc, participants }, warnings, saved: participant }
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

/** Правит период, пока по нему нет ни одной оценки (п.16). */
export function updatePeriod(
  doc: HoursDocument,
  input: PeriodInput & { id: string },
): MutationResult<Period> {
  const existing = findPeriod(doc, input.id)
  if (!existing) return fail('Период не найден — обнови страницу.')
  if (doc.assessments.some((assessment) => assessment.period_id === input.id)) {
    return fail(
      `По периоду «${existing.label}» уже есть оценки — правка дат и названия закрыта.`,
    )
  }
  const validated = validatePeriodInput(input)
  if ('ok' in validated) return validated

  const period: Period = {
    ...existing,
    label: validated.label,
    date_from: input.dateFrom,
    date_to: input.dateTo,
  }
  return {
    ok: true,
    doc: { ...doc, periods: doc.periods.map((p) => (p.id === input.id ? period : p)) },
    warnings: overlapWarnings(doc, input, input.id),
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
