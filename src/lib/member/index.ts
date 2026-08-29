/**
 * Модуль «Реестр участников» (`core.member` + `core.member_alias`) — публичная
 * поверхность (ADR-002 §3, ADR-004 §6, спека 124: EARS-1, EARS-2, EARS-8,
 * EARS-9, EARS-17..19).
 *
 * ЭТО ЕДИНСТВЕННАЯ ДВЕРЬ. Другие модули (в первую очередь hours) импортируют
 * только `@/lib/member`: ни `@/lib/member/repository`, ни таблицы
 * `@/lib/platform/db/schema/member/*`. Граница машинная, а не на доверии —
 * правила `hours-must-import-member-only-via-api` и
 * `cms-and-okr-must-not-import-member-internals` в `.dependency-cruiser.cjs`
 * (`pnpm boundaries`, BLOCK-джоба в CI).
 *
 * Каждая функция принимает необязательный executor `{ db }` (drizzle-handle или
 * транзакция) и по умолчанию берёт `getPlatformDb()`: мутации hours идут одной
 * транзакцией под advisory-локом (EARS-10), и создание/правка участника внутри
 * такого сохранения должна жить в ТОЙ ЖЕ транзакции.
 *
 * Алиасов UI в этом цикле нет (EARS-19): их пишет ручной seed катовера — через
 * `upsertMemberWithAliases`, ЭТУ дверь, а не своим SQL (`tools/platform/member-seed.ts`,
 * EARS-14) — и владельческий SQL-хатч. Форма появится с `/p/admin` (эпик #112).
 */

export { MemberConflictError } from './errors'
export {
  memberAdminSection,
  memberAliasCreateSchema,
  memberAliasSchema,
  memberAliasUpdateSchema,
  memberCreateSchema,
  memberRecordSchema,
  memberStatusSchema,
  memberUpdateSchema,
} from './contract'
export type {
  MemberAliasInput,
  MemberAliasRecord,
  MemberCreateInput,
  MemberRecord,
  MemberUpdateInput,
  ParsedMemberCreateInput,
} from './contract'
export {
  normalizeAliasValue,
  normalizeMemberEmail,
  slugCandidate,
  slugFromEmail,
} from './normalize'
export {
  createMember,
  createMemberAlias,
  deleteMemberAlias,
  ensureMemberByEmail,
  findMemberByEmail,
  findMemberOwningAliasValue,
  getMembersByIds,
  getMemberById,
  listAliases,
  listMembers,
  resolveMember,
  updateMemberProfile,
  updateMemberAlias,
  upsertMemberWithAliases,
} from './repository'
export type {
  MemberAliasSeed,
  MemberDb,
  MemberDbOptions,
  MemberSeedInput,
  MemberUpsertOutcome,
} from './repository'
export { VIRTUAL_EMAIL_KIND } from './types'
export type { AliasKind, AliasLookup, Member, MemberAlias } from './types'
export { memberWorkspaceEntry } from './workspace'
