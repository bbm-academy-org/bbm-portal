/**
 * Модуль «Калькулятор самооценки часов» (ADR-002, спека 081) — публичная
 * поверхность домена. Всё, что снаружи (src/modules/hours/view,
 * src/app/(platform)/p/hours), импортирует ТОЛЬКО отсюда; внутренности модуля
 * никто не тянет — граница машинно проверяется dependency-cruiser'ом
 * (`pnpm boundaries`).
 *
 * Ничто здесь не импортирует CMS (collections/globals/endpoints/payload config)
 * и внутренности OKR — тем же правилом.
 */

export {
  countCalendarDays,
  countWeekdays,
  isValidIsoDate,
  isWeekday,
  monthLabel,
  monthSegments,
} from './calendar'
export type { MonthSegment } from './calendar'

export {
  computeAccrual,
  computeSplit,
  describePeriod,
  effectiveHourlyRate,
  HOURS_PER_WEEKDAY,
  maxDeclarableHours,
  monthlyHourlyRate,
  sliderMaxHours,
  WEEKDAYS_PER_WEEK,
} from './formula'
export type { PeriodCalendar, PeriodMonthBreakdown } from './formula'

export {
  isHoursAdmin,
  isOwnEmail,
  normalizeEmail,
  parseAdminEmails,
  sessionEmail,
} from './access'
export type { HoursSessionLike } from './access'

export {
  createPeriod,
  deletePeriod,
  findAssessment,
  findOpenPeriod,
  findParticipant,
  findPeriod,
  saveAssessment,
  setPeriodStatus,
  updatePeriod,
  upsertParticipant,
} from './document'
export type {
  Failure,
  MutationResult,
  PeriodInput,
  SaveAssessmentInput,
  Success,
  UpsertParticipantInput,
} from './document'

export { formatHours, formatInt, formatPercent, formatRub, formatWeeks } from './format'

export { HoursDataError, mutateHoursDocument, readHoursDocument, resolveDataFile } from './store'

export { emptyHoursDocument } from './types'
export type {
  Assessment,
  AssessmentMethod,
  Grade,
  HoursDocument,
  Participant,
  Period,
  PeriodStatus,
} from './types'
