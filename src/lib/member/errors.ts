/**
 * The member module's typed refusal (spec 124 EARS-9, EARS-20).
 *
 * A pg error must never reach a surface: EARS-20 requires the same readable
 * refusal the JSON validation produced, never a raw constraint error or a 500.
 * So a conflict the module can EXPLAIN is thrown as this class, carrying the
 * Russian message a form can print as-is plus the member the conflict is about —
 * the caller (the hours admin save, part 3 of #255) may re-phrase it, but never
 * has to reconstruct who the other person is.
 */
import type { Member } from './types'

export class MemberConflictError extends Error {
  /** The member the conflict is WITH, when there is one to name. */
  readonly member?: Member

  constructor(message: string, options?: { member?: Member; cause?: unknown }) {
    super(message, { cause: options?.cause })
    this.name = 'MemberConflictError'
    this.member = options?.member
  }
}

/**
 * A unique-index race detected inside a transaction that PostgreSQL has aborted.
 * The caller must let that transaction roll back before resolving the owner on a
 * fresh application handle.
 */
export class MemberAliasUniqueConflictError extends Error {
  readonly kind: string
  readonly value: string
  readonly exceptAliasId?: number

  constructor(kind: string, value: string, options?: { exceptAliasId?: number; cause?: unknown }) {
    super(`Alias unique conflict: ${kind}/${value}`, { cause: options?.cause })
    this.name = 'MemberAliasUniqueConflictError'
    this.kind = kind
    this.value = value
    this.exceptAliasId = options?.exceptAliasId
  }
}

/** «Этот email уже записан как алиас участника „X" — сначала разберись с ним.» */
export function aliasOwnedByAnotherMember(email: string, owner: Member, kind: string): Error {
  return new MemberConflictError(
    `Email «${email}» уже записан как алиас (${kind}) участника «${owner.name}». ` +
      'Один человек — одна запись в реестре: либо это тот же человек (тогда правь его запись), ' +
      'либо алиас указан неверно и его нужно убрать.',
    { member: owner },
  )
}
