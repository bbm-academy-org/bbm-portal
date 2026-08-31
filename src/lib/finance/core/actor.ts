/**
 * Who is writing to the finance module, and whether they may.
 *
 * **Three gates, because there are three different questions.** F1a had one
 * (`assertFinanceWriteAccess`, `platform-admin` over everything); spec 339 §A
 * splits it along the line the owner drew (decision 27), and spec 338 EARS-330
 * was amended to match:
 *
 *  - **reference administration** — the catalogues under `/p/admin/finance/*` —
 *    stays `platform-admin` (EARS-330 as amended, EARS-529);
 *  - **the ledger** — posting an operation and reversing one — is
 *    `finance-approve` (EARS-501). `platform-admin` BY ITSELF no longer posts
 *    or reverses: an admin who wants to post holds the flow role too. That is a
 *    deliberate narrowing of a shipped clause, on the owner's go list;
 *  - **the intake** — creating and editing intake items, attaching documents —
 *    is `finance-entry` (EARS-501), with ONE carve-out: a platform member
 *    holding neither flow role acts on their own request (EARS-502).
 *
 * The gate lives in the MODULE, not on the route: «however the URL or API is
 * reached» (EARS-501, spec 311 EARS-405). A surface that forgets
 * `resolveClaimGate` is a bug, but it is not a hole — the module refuses anyway,
 * and the two enforcements agree because this file asks the same question
 * through the same function (`hasClaim` in `src/lib/platform/authGate.ts`)
 * rather than re-implementing the role implication of spec 311 EARS-417 twice.
 *
 * Note which way that implication runs: `platform-admin` implies
 * `platform-user` and nothing else (EARS-417/466), so neither flow role is
 * implied by anything — a grant is the only way to hold one.
 *
 * Reading is not gated here at all. `/p/finance` stays open to every platform
 * member (EARS-530, spec 338 EARS-324/325); the one read that is NOT open is
 * document content (EARS-523), which is the document layer's own gate and not
 * a role question.
 *
 * The actor is also what makes the write attributable: `financeAuditContext()`
 * turns it into the spec-201 `AuditContext` that `platformTransaction` demands,
 * so every write lands in `core.audit_event` with a name on it and the module
 * needs no journal of its own (spec 338, Accounting policy ruling 2).
 */
import type { AuditContext } from '@/lib/platform/db/transaction'
import { hasClaim, PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'

import { FinanceAccessRefusal } from './errors'

/**
 * A signed-in platform member as the finance module needs them: the email that
 * goes into the audit ledger, and the roles their session carries.
 *
 * Deliberately NOT the Auth.js session object: the module takes the two facts it
 * uses, so a caller may be a route handler, a CLI or a test without inventing a
 * session shape — and so nothing in `src/lib/finance` depends on Auth.js.
 */
export type FinanceActor = {
  /** Normalized by `platformTransaction`; joins to `core.member.email`. */
  email: string
  /** `session.user.roles` (src/auth.ts), or the equivalent for a non-web caller. */
  roles: readonly string[]
}

/** Fills the intake: creates and edits intake items, attaches documents (EARS-501). */
export const FINANCE_ENTRY_ROLE = 'finance-entry'
/** Decides and posts: approves, refuses, posts, reverses (EARS-501). */
export const FINANCE_APPROVE_ROLE = 'finance-approve'

/**
 * The two flow roles and no others (EARS-501). Seeded in the dev IdP by
 * `infra/dev-stand/idp/provision.sh` (canon: `infra/dev-stand/idp/bootstrap.md`
 * §5a); prod is a supervised owner-go step. The spellings live HERE and the
 * script is asserted against them by
 * `tests/unit/idp-provision-seed-roles.spec.ts` — a role the app checks and the
 * IdP never issues refuses every holder with a message that looks exactly like
 * a correct refusal.
 */
export const FINANCE_FLOW_ROLES = [FINANCE_ENTRY_ROLE, FINANCE_APPROVE_ROLE] as const
export type FinanceFlowRole = (typeof FINANCE_FLOW_ROLES)[number]

/**
 * An attributable write has a person behind it (spec 201 EARS-9). Checked before
 * the role, in every gate: an unattributed row in `core.audit_event` is a defect,
 * not a degradation, so it is refused even where the role would have passed.
 */
function assertAttributable(actor: FinanceActor): void {
  if (typeof actor.email !== 'string' || actor.email.trim() === '') {
    throw new FinanceAccessRefusal(
      'Запись в финансовый модуль требует известного автора: у сессии нет email, ' +
        'а неатрибутированная запись в core.audit_event — дефект, а не деградация (спека 201, EARS-9).',
    )
  }
}

/** Any signed-in platform member may perform this attributable finance act. */
export function assertFinancePlatformMember(actor: FinanceActor): void {
  assertAttributable(actor)
}

/** Does this actor hold `role` outright? No implication reaches a flow role (EARS-417/466). */
function holds(actor: FinanceActor, role: string): boolean {
  return hasClaim({ user: { roles: [...actor.roles] } }, role)
}

/**
 * Reference administration — the catalogues (EARS-330 as amended, EARS-529).
 *
 * This is the ONE thing `platform-admin` still gates in the finance module. The
 * ledger moved out from under it and says so in its own refusal below.
 */
export function assertFinanceReferenceAccess(actor: FinanceActor): void {
  assertAttributable(actor)
  if (!holds(actor, PLATFORM_ADMIN_ROLE)) {
    throw new FinanceAccessRefusal(
      `Справочники финансового модуля редактирует только роль «${PLATFORM_ADMIN_ROLE}» ` +
        `(EARS-330). У ${actor.email} её нет. Чтение /p/finance открыто каждому участнику ` +
        'платформы (EARS-530) — сужено именно администрирование справочников.',
    )
  }
}

/** The same reference-role fact for read paths that split admin/all from proposer/own. */
export function holdsFinanceReferenceRole(actor: FinanceActor): boolean {
  return holds(actor, PLATFORM_ADMIN_ROLE)
}

/**
 * The ledger — posting an operation and reversing one (EARS-501, EARS-529).
 *
 * `platform-admin` is deliberately NOT accepted here, and the refusal says so:
 * an admin reading this message held the role that used to be enough, and
 * «недостаточно прав» alone would send them looking for a bug.
 */
export function assertFinanceLedgerAccess(actor: FinanceActor): void {
  assertAttributable(actor)
  if (!holds(actor, FINANCE_APPROVE_ROLE)) {
    throw new FinanceAccessRefusal(
      `Проводка и сторнирование в книге — роль «${FINANCE_APPROVE_ROLE}» (EARS-501). ` +
        `У ${actor.email} её нет. Роль «${PLATFORM_ADMIN_ROLE}» сама по себе больше не даёт ` +
        'записи в книгу: она отвечает за справочники (EARS-529). Выдать роль — ' +
        'infra/dev-stand/idp/bootstrap.md §5a.',
    )
  }
}

/**
 * What the act touches, as far as the ROLE question is concerned.
 *
 * `ownRequest` is the EARS-502 carve-out and it is the CALLER's fact: the
 * handler holds the intake row, so it is the only place that can know the item
 * is `source = 'request'` and was submitted by this actor, and that the act is
 * one EARS-502 lists (submit, edit while `draft`/`submitted`, cancel own
 * `submitted`, attach a document to an own item). This gate answers only «does
 * the role question still have to be asked» — it never guesses ownership, and a
 * handler that passes `ownRequest: true` for someone else's item has shipped
 * the bug, not received a licence.
 */
export type FinanceIntakeAct = {
  /** True when the act is one of EARS-502's, on an intake item the actor submitted. */
  ownRequest?: boolean
}

/**
 * The intake — creating and editing intake items, attaching documents
 * (EARS-501), with the submitter carve-out (EARS-502).
 *
 * **`finance-approve` does NOT pass here**, and that is the clause, not an
 * oversight. EARS-501 splits the two roles BY ACT — entry fills the intake,
 * approval decides on it — and then closes the door: an intake write from a
 * session «without the matching role» is refused, «with EARS-502 as the ONE
 * deliberate carve-out». Admitting an approver would be a second carve-out the
 * owner never accepted, and it would contradict this file's own rule that
 * neither flow role is implied by anything. Spec 339's CRUD table pairs the two
 * roles on READ only; every intake write column names the entry role alone.
 *
 * An approver who also fills the intake holds `finance-entry` as its own grant —
 * that is the shape the IdP already seeds for `bbm-test`.
 */
export function assertFinanceIntakeAccess(actor: FinanceActor, act: FinanceIntakeAct = {}): void {
  assertAttributable(actor)
  if (act.ownRequest === true) return
  if (holds(actor, FINANCE_ENTRY_ROLE)) return
  throw new FinanceAccessRefusal(
    `Ведение заявок и документов вне собственной заявки — роль «${FINANCE_ENTRY_ROLE}» ` +
      `(EARS-501). У ${actor.email} её нет. Своя заявка на /p/finance/requests доступна ` +
      'каждому участнику платформы без ролей (EARS-502). Выдать роль — ' +
      'infra/dev-stand/idp/bootstrap.md §5a.',
  )
}

/**
 * Does this actor hold EITHER flow role — the «is this person inside the finance
 * flow at all» question, as opposed to «may they do this act».
 *
 * It lives here, with the rest of «what a role means in this module», rather
 * than in the handler that needed it first: a second file building a session
 * shape by hand and calling `hasClaim` twice is how the two answers start to
 * disagree. Used by the intake list and by the visibility rule in front of it —
 * a flow-role holder reads every item, everyone else reads their own (EARS-502).
 */
export function holdsFinanceFlowRole(actor: FinanceActor): boolean {
  return FINANCE_FLOW_ROLES.some((role) => holds(actor, role))
}

/**
 * The spec-201 audit context for a finance write.
 *
 * `source: 'portal'` in every case, because every finance write in F1 comes from
 * an authenticated human: the intakes that will write with `source: 'hours'` or
 * `bank_import` are F2's, and when they arrive they name their own AUDIT source
 * as well — the operation's `source` column and `app.source` answer two different
 * questions (what kind of fact this is vs. which door the write came through).
 */
export function financeAuditContext(actor: FinanceActor): AuditContext {
  return { actorEmail: actor.email, source: 'portal' }
}
