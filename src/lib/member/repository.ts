/**
 * The member module's data access (spec 124 EARS-2, EARS-9, EARS-17, EARS-18).
 *
 * Every function takes an OPTIONAL executor — `{ db }` — and defaults to
 * `getPlatformDb()`. That is not a testing seam: the hours module's mutations run
 * inside one transaction that first takes the module-wide advisory lock
 * (EARS-10), and a member create/update made by an hours save must live in THAT
 * transaction, or a rolled-back hours save would leave a member behind. So the
 * caller passes its `tx` and the write joins its atomicity.
 *
 * Consequence of the same rule, and the reason nothing here retries a failed
 * statement: inside a transaction a constraint violation aborts the whole
 * transaction, so a "try the insert, catch the duplicate, try the next slug" loop
 * would work standalone and destroy the caller's transaction. Slug uniqueness is
 * therefore resolved by READING the taken slugs first; the 23505 handler below is
 * the backstop for a genuine race, and it refuses in words rather than retrying.
 */
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm'

import { getPlatformDb } from '@/lib/platform/db/client'
import { member } from '@/lib/platform/db/schema/member/member'
import { memberAlias } from '@/lib/platform/db/schema/member/member-alias'

import { aliasOwnedByAnotherMember, MemberConflictError } from './errors'
import {
  normalizeAliasValue,
  normalizeMemberEmail,
  slugCandidate,
  slugFromEmail,
} from './normalize'
import { VIRTUAL_EMAIL_KIND, type AliasLookup, type Member, type MemberAlias } from './types'

/**
 * What the module needs of a drizzle handle: the query builders. Structural, not
 * `NodePgDatabase`, precisely so a transaction handle (which has the builders but
 * not the pool-bound `$client`) satisfies it — see the header.
 */
export type MemberDb = Pick<ReturnType<typeof getPlatformDb>, 'select' | 'insert' | 'update'>

/** The optional executor every function in this module accepts. */
export type MemberDbOptions = { db?: MemberDb }

function executor(options?: MemberDbOptions): MemberDb {
  return options?.db ?? getPlatformDb()
}

/**
 * The SQLSTATE behind a failed drizzle query. drizzle wraps the pg error in a
 * `DrizzleQueryError` and hangs the original off `cause`, so a bare `err.code`
 * check is always `undefined` — the unique-violation branch below would be dead
 * code that looks alive.
 */
function pgErrorCode(err: unknown): string | undefined {
  const node = err as { code?: string; cause?: unknown } | undefined
  if (typeof node?.code === 'string') return node.code
  return node?.cause ? pgErrorCode(node.cause) : undefined
}

/** `lower(btrim(<column>)) = <normalized value>`, the alias index's own shape. */
function normalizedEquals(column: typeof memberAlias.value | typeof member.email, value: string) {
  return sql`lower(btrim(${column})) = ${value}`
}

/** Every member, in insertion (id) order — the order surfaces render (EARS-21). */
export async function listMembers(options?: MemberDbOptions): Promise<Member[]> {
  return executor(options).select().from(member).orderBy(asc(member.id))
}

/** The members with these ids, in id order; an empty id list makes no query. */
export async function getMembersByIds(ids: number[], options?: MemberDbOptions): Promise<Member[]> {
  if (ids.length === 0) return []
  return executor(options)
    .select()
    .from(member)
    .where(inArray(member.id, ids))
    .orderBy(asc(member.id))
}

/** A member by canonical email, normalized the way the CHECK demands (EARS-2). */
export async function findMemberByEmail(
  email: string,
  options?: MemberDbOptions,
): Promise<Member | null> {
  const normalized = normalizeMemberEmail(email)
  const rows = await executor(options)
    .select()
    .from(member)
    .where(normalizedEquals(member.email, normalized))
    .limit(1)
  return rows[0] ?? null
}

/** A member's aliases, in insertion order (EARS-18). */
export async function listAliases(
  memberId: number,
  options?: MemberDbOptions,
): Promise<MemberAlias[]> {
  return executor(options)
    .select()
    .from(memberAlias)
    .where(eq(memberAlias.memberId, memberId))
    .orderBy(asc(memberAlias.id))
}

/**
 * The recognition contract (EARS-18): resolve a person from (kind, value) across
 * `member_alias` AND — under the virtual kind `email` — the canonical
 * `@bbm.academy` address on `member`. The input is normalized exactly as the
 * unique index normalizes storage, so «Dobroyar» finds `dobroyar`.
 */
export async function resolveMember(
  lookup: AliasLookup,
  options?: MemberDbOptions,
): Promise<Member | null> {
  const value = normalizeAliasValue(lookup.value)
  if (value === '') return null

  if (lookup.kind === VIRTUAL_EMAIL_KIND) return findMemberByEmail(value, options)

  const rows = await executor(options)
    .select({ member })
    .from(memberAlias)
    .innerJoin(member, eq(member.id, memberAlias.memberId))
    .where(and(eq(memberAlias.kind, lookup.kind), normalizedEquals(memberAlias.value, value)))
    .orderBy(asc(memberAlias.id))
    .limit(1)
  return rows[0]?.member ?? null
}

/**
 * Who owns this value as an alias, under ANY kind (EARS-9's conflict lookup).
 *
 * Kind-agnostic on purpose: the hours admin form knows it is saving an email, but
 * the same string may sit in the registry as `email_personal`,
 * `mattermost_email` or something the vocabulary has not met yet — and any of
 * those means the address already belongs to a person. The alias is returned
 * alongside the member so the refusal can name the kind.
 */
export async function findMemberOwningAliasValue(
  value: string,
  options?: MemberDbOptions,
): Promise<{ member: Member; alias: MemberAlias } | null> {
  const normalized = normalizeAliasValue(value)
  if (normalized === '') return null

  const rows = await executor(options)
    .select({ member, alias: memberAlias })
    .from(memberAlias)
    .innerJoin(member, eq(member.id, memberAlias.memberId))
    .where(normalizedEquals(memberAlias.value, normalized))
    .orderBy(asc(memberAlias.id))
    .limit(1)
  const row = rows[0]
  return row ? { member: row.member, alias: row.alias } : null
}

/** The first slug not yet taken: `anton`, then `anton-2`, `anton-3`, … (EARS-9). */
async function freeSlug(base: string, db: MemberDb): Promise<string> {
  const taken = new Set(
    (
      await db
        .select({ slug: member.slug })
        .from(member)
        .where(or(eq(member.slug, base), like(member.slug, `${base}-%`)))
    ).map((row) => row.slug),
  )

  for (let attempt = 0; attempt <= taken.size; attempt += 1) {
    const candidate = slugCandidate(base, attempt)
    if (!taken.has(candidate)) return candidate
  }
  // Unreachable: `taken.size + 1` candidates cannot all collide with `taken.size`
  // slugs. Stated rather than trusted, so a future edit cannot make it silent.
  throw new MemberConflictError(
    `Не удалось подобрать свободный slug для «${base}» — обратись к владельцу реестра.`,
  )
}

/**
 * Get the member for this email, creating one if it is unknown (EARS-9).
 *
 * Create: `status: active`, timezone `Europe/Moscow`, slug from the email local
 * part with a numeric suffix on collision — the save never surfaces a raw
 * constraint error. Known email: returned as-is; this function does NOT rename a
 * member. Renaming is `updateMemberProfile`, deliberately a separate call, since
 * the shared registry is edited on purpose and never as a side effect of a
 * lookup.
 *
 * Refusal (EARS-9): if the email is already somebody's alias value, there is no
 * honest row to create — creating one would give one person two registry
 * entries, hence two hours rates. Refused by name.
 */
export async function ensureMemberByEmail(
  input: { email: string; name: string; role?: string | null },
  options?: MemberDbOptions,
): Promise<Member> {
  const db = executor(options)
  const email = normalizeMemberEmail(input.email)
  if (email === '') {
    throw new MemberConflictError('Email обязателен: без него участника не создать.')
  }

  const existing = await findMemberByEmail(email, { db })
  if (existing) return existing

  const owner = await findMemberOwningAliasValue(email, { db })
  if (owner) throw aliasOwnedByAnotherMember(email, owner.member, owner.alias.kind)

  const slug = await freeSlug(slugFromEmail(email), db)
  try {
    const rows = await db
      .insert(member)
      .values({ slug, email, name: input.name, role: input.role ?? null })
      .returning()
    const created = rows[0]
    if (!created) throw new MemberConflictError(`Не удалось создать участника «${email}».`)
    return created
  } catch (err) {
    // A genuine race: another session inserted the same email or slug between our
    // read and our write. Refuse in words (EARS-20) — never a raw pg error, and
    // never a retry, which would poison a caller's transaction.
    if (pgErrorCode(err) === '23505') {
      throw new MemberConflictError(
        `Участник с email «${email}» уже создаётся другой операцией — повтори сохранение.`,
        { cause: err },
      )
    }
    throw err
  }
}

/**
 * Edit the shared registry: `name` and `role` (EARS-9 — the hours admin form has
 * always edited both, 081 §23). Named consequence, stated in the spec: a rename
 * here propagates to every future reader of `core.member`.
 *
 * `role: null` clears the role; an omitted key leaves the column alone.
 */
export async function updateMemberProfile(
  id: number,
  patch: { name?: string; role?: string | null },
  options?: MemberDbOptions,
): Promise<Member | null> {
  const changes: { name?: string; role?: string | null; updatedAt: Date } = {
    updatedAt: new Date(),
  }
  if (patch.name !== undefined) changes.name = patch.name
  if (patch.role !== undefined) changes.role = patch.role

  const rows = await executor(options)
    .update(member)
    .set(changes)
    .where(eq(member.id, id))
    .returning()
  return rows[0] ?? null
}
