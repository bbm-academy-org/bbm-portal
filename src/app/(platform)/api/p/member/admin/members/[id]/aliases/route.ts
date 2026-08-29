import {
  createMemberAlias,
  getMemberById,
  listAliases,
  memberAliasCreateSchema,
  memberAliasSchema,
  type MemberAliasInput,
  type MemberAliasRecord,
} from '@/lib/member'
import { adminRoute } from '@/lib/platform/api'

import { memberWrite, missingMember, routeId } from '../../http'

export const GET = adminRoute<undefined, MemberAliasRecord>({
  output: memberAliasSchema,
  handler: async ({ params }) => {
    const memberId = routeId(params.id)
    if (!(await getMemberById(memberId))) throw missingMember(memberId)
    return listAliases(memberId)
  },
})

export const POST = adminRoute<MemberAliasInput, MemberAliasRecord>({
  input: memberAliasCreateSchema,
  output: memberAliasSchema,
  handler: async ({ audit, body, params }) => {
    const memberId = routeId(params.id)
    if (!(await getMemberById(memberId))) throw missingMember(memberId)
    return memberWrite(audit, (db) => createMemberAlias(memberId, body, { db }))
  },
})
