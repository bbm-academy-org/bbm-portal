/**
 * The member module's vocabulary (spec 124 EARS-17, EARS-18).
 */
import type { MemberAliasRow } from '@/lib/platform/db/schema/member/member-alias'
import type { MemberRow } from '@/lib/platform/db/schema/member/member'

/** A row of `core.member` — the shared people registry. */
export type Member = MemberRow

/** A row of `core.member_alias` — one external account or id of a person. */
export type MemberAlias = MemberAliasRow

/**
 * The documented alias vocabulary (EARS-17). Stored lower_snake, and the set is
 * OPEN on purpose: the union names what the seed uses today, while `(string & {})`
 * keeps a new external system from needing a migration AND a type change. The
 * database stores plain text; this union is documentation with autocompletion,
 * never a validator.
 *
 *  - `phone`             — телефон (E.164, as the seed writes it)
 *  - `telegram`          — Telegram @username (stored without the `@`)
 *  - `instagram`         — Instagram handle
 *  - `mattermost_id`     — Mattermost login («dobroyar»)
 *  - `mattermost_email`  — the email a Mattermost account is registered under
 *  - `zoom_id`           — Zoom user id / display name in transcripts
 *  - `email_personal`    — personal (non-`@bbm.academy`) email
 *
 * `email` is deliberately NOT an alias kind for storage: the canonical
 * `@bbm.academy` address lives on `core.member.email`. It IS accepted by
 * `resolveMember` as a VIRTUAL kind, which is what makes one lookup answer both
 * halves of the registry (EARS-18).
 */
export type DocumentedAliasKind =
  | 'phone'
  | 'telegram'
  | 'instagram'
  | 'mattermost_id'
  | 'mattermost_email'
  | 'zoom_id'
  | 'email_personal'

export type AliasKind = DocumentedAliasKind | (string & {})

/** The virtual kind that resolves against `core.member.email` (EARS-18). */
export const VIRTUAL_EMAIL_KIND = 'email'

/** A lookup as consumers phrase it: «this handle, of this kind — who is it?» */
export type AliasLookup = {
  kind: AliasKind | typeof VIRTUAL_EMAIL_KIND
  value: string
}
