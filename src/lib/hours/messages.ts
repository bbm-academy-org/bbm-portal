/**
 * The readable refusals of the hours module — ONE source (spec 124 EARS-20).
 *
 * Two layers refuse the same thing, and both must say it in the same words:
 *
 *  - the pure domain validation (`./document.ts`, `./publication.ts`), which
 *    refuses first in every normal flow;
 *  - the constraint→sentence mapping of the `core` store (`./core/refusals.ts`),
 *    the structural backstop beneath the advisory lock (EARS-10) — it catches the
 *    SQL escape hatch, a genuine race, and a caller handing the store a document
 *    the domain would never produce.
 *
 * #255 shipped the second layer with the strings COPIED, because de-duplicating
 * meant reshaping two domain files that cycle kept behaviourally frozen; the
 * duplication was recorded in `DEBT.md` with «#256, when the JSON store leaves»
 * as its return condition. This file is that return: the sentence now exists
 * once, and a constraint branch that drifts from its domain branch is no longer
 * possible — they read the same constant.
 *
 * Only the sentences that are genuinely SHARED, plus the ones the constraint
 * layer owns alone, live here. A refusal that only one call site can ever produce
 * («Часы должны быть числом не меньше нуля.») stays inline at that site, where it
 * reads as the validation it is.
 */

/** Refusals stated by both the domain validation and the constraint backstop. */
export const REFUSAL = {
  /** `document.ts` → findPeriod / updatePeriod / deletePeriod / setPeriodStatus. */
  periodNotFound: 'Период не найден — обнови страницу.',
  /** `document.ts` → saveAssessment: the email is not a participant. */
  unknownParticipant: 'Такой участник не заведён — обратись к администратору.',
  /** `document.ts` → saveAssessment: the method is outside the vocabulary. */
  unknownMethod: 'Неизвестный способ оценки.',
  /** `document.ts` → upsertParticipant: the grade is outside the vocabulary. */
  unknownGrade: 'Грейд может быть только I, II или III.',
  /** `publication.ts` → eligibility: one batch per period (spec 100 req. 12). */
  publicationAttemptExists: 'У периода уже есть незавершённая попытка публикации.',

  // ── constraint-only (unreachable while the domain refuses first, EARS-20) ──

  /** `hours_assessment_period_member_unique` — a race on the same self-assessment. */
  assessmentAlreadySaved: 'Оценка за этот период уже сохранена — обнови страницу и сохрани заново.',
  /** `hours_period_pkey` — two periods claiming one id. */
  periodIdTaken: 'Период с таким идентификатором уже есть — обнови страницу.',
  /** `hours_participant_pkey` — the person is already a participant. */
  participantAlreadyExists: 'Этот участник уже заведён — обнови страницу.',
  /** `hours_period_single_open` with no label to name (see `periodAlreadyOpen`). */
  onlyOnePeriodOpen: 'Открытым может быть только один период — сначала закрой текущий.',
  /** `hours_period_status_allowed`. */
  unknownPeriodStatus: 'Неизвестный статус периода.',
  /** `hours_publication_status_allowed`. */
  unknownPublicationStatus: 'Неизвестный статус публикации.',

  // ── the member registry's constraints, reached through the hours forms ──

  /** `member_email_unique` / `member_email_normalized` (EARS-2, EARS-9). */
  memberEmailTaken:
    'Этот email уже есть в реестре участников в другом виде — позови администратора.',
  /** `member_slug_unique`. */
  memberSlugUnavailable: 'Не удалось подобрать свободный slug участника — позови администратора.',
  /** `member_alias_kind_value_unique` (EARS-17/18). */
  memberAliasTaken: 'Такой алиас уже записан за другим участником — позови администратора.',
  /** `member_status_allowed`. */
  unknownMemberStatus: 'Недопустимый статус участника реестра.',
} as const

/**
 * «Открытым может быть только один период» with the offender named (081 §24).
 *
 * The label is what makes the sentence actionable, so the constraint layer digs
 * it out of the document rather than settling for `REFUSAL.onlyOnePeriodOpen` —
 * which is the fallback for the case where no open period can be found at all.
 */
export function periodAlreadyOpen(label: string): string {
  return `Уже открыт период «${label}» — сначала закрой его.`
}
