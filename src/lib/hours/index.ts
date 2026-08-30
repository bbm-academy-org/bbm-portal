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

export { isOwnEmail, normalizeEmail, sessionEmail } from './access'
export type { HoursSessionLike } from './access'

export {
  hoursAdminSection,
  hoursAssessmentRecordSchema,
  hoursParticipantCreateSchema,
  hoursParticipantRecordSchema,
  hoursParticipantUpdateSchema,
  hoursPeriodCreateSchema,
  hoursPeriodRecordSchema,
  hoursPeriodUpdateSchema,
  hoursPublicationRecordSchema,
  hoursPublicationRequestSchema,
} from './admin-contract'
export type {
  HoursParticipantCreate,
  HoursParticipantRecord,
  HoursParticipantUpdate,
  HoursPeriodCreate,
  HoursPeriodRecord,
  HoursPeriodUpdate,
  HoursPublicationRecord,
  HoursPublicationRequest,
} from './admin-contract'

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
 * JSON-хранилища в приложении БОЛЬШЕ НЕТ (EARS-15): после приёмки катовера
 * 2026-08-18 задача #256 удалила `./store.ts` вместе с env-переменной пути к
 * документу. Фолбэка на файл нет ни на одном пути (EARS-12): нет
 * `PLATFORM_DATABASE_URL` или база молчит — страница говорит «данные
 * недоступны». Замороженный ридер архива `hours.json.<date>` живёт вне
 * приложения, в `tools/platform/hours-json.ts`, и обслуживает только
 * `pnpm platform:hours:verify`.
 */
export { HoursDataError, mutateHoursDocument, readHoursDocument } from './store-core'
// Аудит-контекст мутации (спека 201 EARS-24/EARS-25) — переэкспортируется здесь,
// чтобы вызывающему (`src/modules/hours/actions.ts`) хватало ОДНОЙ двери модуля
// и он не тянул `@/lib/platform/db/*` напрямую.
export type { AuditContext, AuditSource } from '@/lib/platform/db/transaction'

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

// The module's workspace declaration (spec 311 EARS-401): what the `/p` launcher
// and the app switcher show for this app. Exported from the module's public API,
// per ADR-002 §3, and registered in `src/lib/workspace/registry.ts` — EARS-403's
// test fails by name if it ever is not.
export { hoursStatusLine, hoursWorkspaceEntry, openUntilLabel } from './workspace'
