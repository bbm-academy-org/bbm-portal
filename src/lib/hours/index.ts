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
  monthlyRateFromFork,
  participantMonthlyRate,
  sliderMaxHours,
  WEEKDAYS_PER_WEEK,
} from './formula'
export type { PeriodCalendar, PeriodMonthBreakdown } from './formula'

export { isHoursAdmin, isOwnEmail, normalizeEmail, parseAdminEmails, sessionEmail } from './access'
export type { HoursSessionLike } from './access'

export {
  createPeriod,
  deletePeriod,
  findAssessment,
  findOpenPeriod,
  findParticipant,
  findPeriod,
  pickSummaryPeriod,
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

export {
  buildMattermostPreview,
  createPublicationBatch,
  isPeriodMutationLocked,
  recordPublicationDelivery,
} from './publication'
export type {
  PublicationEligibility,
  PublicationEligibilityStatus,
  PublicationMutationResult,
  PublicationPreview,
  PublicationPreviewMessage,
} from './publication'

export {
  formatHours,
  formatHoursCount,
  formatInt,
  formatIsoDate,
  formatPercent,
  formatRub,
  formatSavedAt,
  formatWeekdayCount,
  formatWeeks,
  plural,
} from './format'

/**
 * Хранилище — схема `core` (спека 124, EARS-1, EARS-10, EARS-12). Раньше здесь
 * стоял `./store` (JSON-документ на диске, спека 081 пп. 12–13). Подписи и
 * семантика `HoursDataError` те же, поэтому ни `src/modules/hours`, ни страницы
 * `/p/hours` этой сменой не задеты.
 *
 * `./store.ts` в этом цикле НЕ удалён и не тронут ни на байт: до приёмки катовера
 * он остаётся ровно тем кодом, который читает прод при откате образа, и через
 * него же импортёр катовера (#256, EARS-13) читает production `hours.json`.
 * Отсюда он больше не экспортируется — фолбэка на JSON у модуля нет (EARS-12), а
 * `resolveDataFile` был нужен только файловому хранилищу. Удаляет файл задача
 * #256 (EARS-15).
 */
export { HoursDataError, mutateHoursDocument, readHoursDocument } from './store-core'

export { emptyHoursDocument } from './types'
export type {
  Assessment,
  AssessmentMethod,
  Grade,
  HoursDocument,
  Participant,
  Period,
  PeriodStatus,
  Publication,
  PublicationDelivery,
  PublicationMessage,
  PublicationStatus,
} from './types'
