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
 * The sentences themselves live in `../messages.ts` and are the SAME constants the
 * domain layer refuses with — one source, since #256. #255 shipped them copied
 * (de-duplicating meant reshaping two files that cycle kept behaviourally frozen)
 * and recorded the duplication in `DEBT.md`; this file no longer holds a string of
 * its own, so a branch here can no longer drift from the branch it mirrors.
 */
import { periodAlreadyOpen, REFUSAL } from '../messages'
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
      return label ? periodAlreadyOpen(label) : REFUSAL.onlyOnePeriodOpen
    }
    // `document.ts` → saveAssessment keeps one row per (period, participant).
    case 'hours_assessment_period_member_unique':
      return REFUSAL.assessmentAlreadySaved
    // `publication.ts` → eligibility: one batch per period (spec 100 req. 12).
    case 'hours_publication_pkey':
      return REFUSAL.publicationAttemptExists
    case 'hours_period_pkey':
      return REFUSAL.periodIdTaken
    case 'hours_participant_pkey':
      return REFUSAL.participantAlreadyExists
    // `document.ts` → findPeriod: «Период не найден — обнови страницу.»
    case 'hours_assessment_period_id_hours_period_id_fk':
    case 'hours_publication_period_id_hours_period_id_fk':
      return REFUSAL.periodNotFound
    // `document.ts` → saveAssessment: «Такой участник не заведён…»
    case 'hours_assessment_member_id_member_id_fk':
    case 'hours_participant_member_id_member_id_fk':
      return REFUSAL.unknownParticipant
    // The CHECKs of the value vocabularies — `document.ts` refuses each in words.
    case 'hours_participant_grade_allowed':
      return REFUSAL.unknownGrade
    case 'hours_assessment_method_allowed':
      return REFUSAL.unknownMethod
    case 'hours_period_status_allowed':
      return REFUSAL.unknownPeriodStatus
    case 'hours_publication_status_allowed':
      return REFUSAL.unknownPublicationStatus
    // The member registry's own constraints. `src/lib/member` normalizes and
    // refuses in words before these can fire, so hitting one means the SQL escape
    // hatch or a race — still a sentence, never a 500 (EARS-2, EARS-9).
    case 'member_email_unique':
    case 'member_email_normalized':
      return REFUSAL.memberEmailTaken
    case 'member_slug_unique':
      return REFUSAL.memberSlugUnavailable
    case 'member_alias_kind_value_unique':
      return REFUSAL.memberAliasTaken
    case 'member_status_allowed':
      return REFUSAL.unknownMemberStatus
    default:
      return null
  }
}
