import {
  MemberAliasUniqueConflictError,
  MemberConflictError,
  memberRecordSchema,
  resolveMemberAliasUniqueConflict,
  type Member,
  type MemberDb,
  type MemberRecord,
} from '@/lib/member'
import { ModuleApiError } from '@/lib/platform/api'
import {
  platformTransaction,
  type AuditContext,
  type PlatformTx,
} from '@/lib/platform/db/transaction'

export function routeId(value: string | string[] | undefined, field = 'id'): number {
  const raw = Array.isArray(value) ? value[0] : value
  const id = Number(raw)
  if (!raw || !Number.isSafeInteger(id) || id <= 0) {
    throw new ModuleApiError('bad-request', `${field}: укажите положительный целочисленный id.`)
  }
  return id
}

export function memberRecord(value: Member): MemberRecord {
  return memberRecordSchema.parse({
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  })
}

export function missingMember(id: number): ModuleApiError {
  return new ModuleApiError('not-found', `Участник #${id} не найден.`)
}

export function missingAlias(id: number): ModuleApiError {
  return new ModuleApiError('not-found', `Алиас #${id} не найден у этого участника.`)
}

export async function memberWrite<T>(
  audit: AuditContext,
  write: (db: MemberDb) => Promise<T>,
): Promise<T> {
  try {
    return await platformTransaction(audit, (tx: PlatformTx) => write(tx))
  } catch (error) {
    const conflict =
      error instanceof MemberAliasUniqueConflictError
        ? await resolveMemberAliasUniqueConflict(error)
        : error
    if (conflict instanceof MemberConflictError)
      throw new ModuleApiError('conflict', conflict.message, {
        memberId: conflict.member?.id,
        memberName: conflict.member?.name,
      })
    throw error
  }
}
