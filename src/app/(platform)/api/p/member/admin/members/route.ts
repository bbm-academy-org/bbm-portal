import {
  createMember,
  listMembers,
  memberCreateSchema,
  memberRecordSchema,
  type MemberRecord,
  type ParsedMemberCreateInput,
} from '@/lib/member'
import { adminRoute, moduleListResult, ModuleApiError } from '@/lib/platform/api'

import { memberRecord, memberWrite } from './http'

const sortable = new Set<keyof MemberRecord>(['id', 'name', 'email', 'role', 'status'])

function compare(a: MemberRecord, b: MemberRecord, field: keyof MemberRecord): number {
  return String(a[field] ?? '').localeCompare(String(b[field] ?? ''), 'ru')
}

export const GET = adminRoute<undefined, MemberRecord>({
  output: memberRecordSchema,
  handler: async ({ query }) => {
    const normalizedQuery = query.q?.trim().toLocaleLowerCase('ru') ?? ''
    const records = (await listMembers())
      .map(memberRecord)
      .filter((item) =>
        normalizedQuery
          ? [item.name, item.email, item.role, item.status].some((value) =>
              value?.toLocaleLowerCase('ru').includes(normalizedQuery),
            )
          : true,
      )

    const sort = query.sort ?? 'id'
    if (!sortable.has(sort as keyof MemberRecord)) {
      throw new ModuleApiError('bad-request', `sort: поле «${sort}» не поддерживается.`)
    }
    const field = sort as keyof MemberRecord
    records.sort((a, b) => compare(a, b, field) * (query.order === 'desc' ? -1 : 1))

    const start = (query.page - 1) * query.pageSize
    return moduleListResult({
      items: records.slice(start, start + query.pageSize),
      total: records.length,
    })
  },
})

export const POST = adminRoute<ParsedMemberCreateInput, MemberRecord>({
  input: memberCreateSchema,
  output: memberRecordSchema,
  handler: async ({ audit, body }) =>
    memberRecord(await memberWrite(audit, (db) => createMember(body, { db }))),
})
