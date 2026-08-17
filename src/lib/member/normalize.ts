/**
 * Normalization — the JS half of contracts the DATABASE also states
 * (spec 124 EARS-2, EARS-17, EARS-18).
 *
 * `core.member.email` carries `CHECK (email = lower(btrim(email)))` and
 * `core.member_alias` is unique on the expression (`kind`, `lower(btrim(value))`).
 * These functions reproduce `lower(btrim(...))` exactly, so the module writes and
 * looks up values the constraints already agree with — the database stays the
 * backstop against the SQL escape hatch (EARS-19), never the module's error
 * channel for ordinary input.
 */

/** `lower(btrim(v))` — the one normalization both the alias index and lookups use. */
export function normalizeAliasValue(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

/**
 * The same rule for an email. A separate name because the reason differs: here it
 * is the `member_email_normalized` CHECK, i.e. the guarantee that one person has
 * exactly one row (and therefore exactly one hours rate).
 */
export function normalizeMemberEmail(email: string): string {
  return normalizeAliasValue(email)
}

/** The email's local part; the whole (normalized) string when there is no `@`. */
function localPart(email: string): string {
  const normalized = normalizeMemberEmail(email)
  const at = normalized.indexOf('@')
  return at === -1 ? normalized : normalized.slice(0, at)
}

/**
 * The slug a new member gets from its email (EARS-9): the local part, lowercased,
 * every character outside `[a-z0-9-]` replaced by a dash. Deliberately NOT a
 * transliteration — a slug is an identifier, and a lossy-but-stable mapping is
 * what keeps `anton.sidorov+hours@…` and `Anton.Sidorov+Hours@…` the same slug.
 *
 * Falls back to `member` when the local part yields nothing, so the caller never
 * has to handle an empty identifier; uniqueness is then handled by the numeric
 * suffix in `ensureMemberByEmail`.
 */
export function slugFromEmail(email: string): string {
  const slug = localPart(email).replace(/[^a-z0-9-]/g, '-')
  return slug.length > 0 ? slug : 'member'
}

/**
 * The slug candidates for a base, in the order `ensureMemberByEmail` tries them:
 * `anton`, `anton-2`, `anton-3`, … The suffix starts at 2 because the bare slug
 * IS the first candidate — `anton-1` would imply a nonexistent `anton-0`.
 */
export function slugCandidate(base: string, attempt: number): string {
  return attempt === 0 ? base : `${base}-${attempt + 1}`
}
