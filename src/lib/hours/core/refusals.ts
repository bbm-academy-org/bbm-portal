/**
 * Constraint → sentence (spec 124 EARS-20).
 *
 * «IF a database constraint fires, THEN the user shall receive the same readable
 * refusal message the JSON validation produces today — never a raw constraint
 * error or a 500.»
 *
 * In the normal flow these branches are unreachable: the pure validation in
 * `../document.ts` / `../publication.ts` refuses first, and the constraints are the
 * structural backstop beneath the advisory lock (EARS-10) — they catch the SQL
 * escape hatch, a genuine race, and a caller that hands the store a document the
 * domain would never produce. Unreachable-but-mapped is the point: reaching one
 * must still yield a sentence.
 *
 * The sentences are deliberate DUPLICATES of the ones `../document.ts` and
 * `../publication.ts` build (each is named below at its branch). The alternative —
 * exporting message builders out of the domain layer — would have meant reshaping
 * two files this cycle deliberately does not touch behaviourally; the duplication
 * is asserted against the originals by `tests/int/platform/hours-core.int.spec.ts`
 * (EARS-20) and by the domain's own unit specs, so a drift between the two shows
 * up as a red test rather than as a stale string.
 */
import type { HoursDocument } from '../types'
import { pgFailure } from './errors'

/** The period that already holds the open slot, for the EARS-5 sentence. */
function openPeriodLabel(before: HoursDocument, after: HoursDocument): string | null {
  const open =
    before.periods.find((period) => period.status === 'open') ??
    after.periods.find((period) => period.status === 'open')
  return open?.label ?? null
}

/**
 * The readable refusal a failed statement means, or `null` when this module does
 * not recognize the failure — an unrecognized failure is NOT silently turned into
 * a refusal, it becomes `HoursDataError` («данные недоступны»), because inventing
 * a reassuring sentence for an unknown database error is how a corrupted write
 * would look like a validation message.
 */
export function refusalFor(
  err: unknown,
  before: HoursDocument,
  after: HoursDocument,
): string | null {
  const { constraint } = pgFailure(err)
  switch (constraint) {
    // `document.ts` → setPeriodStatus: «Уже открыт период «X» — сначала закрой его.»
    case 'hours_period_single_open': {
      const label = openPeriodLabel(before, after)
      return label
        ? `Уже открыт период «${label}» — сначала закрой его.`
        : 'Открытым может быть только один период — сначала закрой текущий.'
    }
    // `document.ts` → saveAssessment keeps one row per (period, participant).
    case 'hours_assessment_period_member_unique':
      return 'Оценка за этот период уже сохранена — обнови страницу и сохрани заново.'
    // `publication.ts` → eligibility: one batch per period (spec 100 req. 12).
    case 'hours_publication_pkey':
      return 'У периода уже есть незавершённая попытка публикации.'
    case 'hours_period_pkey':
      return 'Период с таким идентификатором уже есть — обнови страницу.'
    case 'hours_participant_pkey':
      return 'Этот участник уже заведён — обнови страницу.'
    // `document.ts` → findPeriod: «Период не найден — обнови страницу.»
    case 'hours_assessment_period_id_hours_period_id_fk':
    case 'hours_publication_period_id_hours_period_id_fk':
      return 'Период не найден — обнови страницу.'
    // `document.ts` → saveAssessment: «Такой участник не заведён…»
    case 'hours_assessment_member_id_member_id_fk':
    case 'hours_participant_member_id_member_id_fk':
      return 'Такой участник не заведён — обратись к администратору.'
    // The CHECKs of the value vocabularies — `document.ts` refuses each in words.
    case 'hours_participant_grade_allowed':
      return 'Грейд может быть только I, II или III.'
    case 'hours_assessment_method_allowed':
      return 'Неизвестный способ оценки.'
    case 'hours_period_status_allowed':
      return 'Неизвестный статус периода.'
    case 'hours_publication_status_allowed':
      return 'Неизвестный статус публикации.'
    // The member registry's own constraints. `src/lib/member` normalizes and
    // refuses in words before these can fire, so hitting one means the SQL escape
    // hatch or a race — still a sentence, never a 500 (EARS-2, EARS-9).
    case 'member_email_unique':
    case 'member_email_normalized':
      return 'Этот email уже есть в реестре участников в другом виде — позови администратора.'
    case 'member_slug_unique':
      return 'Не удалось подобрать свободный slug участника — позови администратора.'
    case 'member_alias_kind_value_unique':
      return 'Такой алиас уже записан за другим участником — позови администратора.'
    case 'member_status_allowed':
      return 'Недопустимый статус участника реестра.'
    default:
      return null
  }
}
