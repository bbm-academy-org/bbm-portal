import {
  deleteMemberAlias,
  memberAliasSchema,
  memberAliasUpdateSchema,
  updateMemberAlias,
  type MemberAliasInput,
  type MemberAliasRecord,
} from '@/lib/member'
import { adminRoute } from '@/lib/platform/api'

import { memberWrite, missingAlias, routeId } from '../../../http'

export const PATCH = adminRoute<MemberAliasInput, MemberAliasRecord>({
  input: memberAliasUpdateSchema,
  output: memberAliasSchema,
  handler: async ({ audit, body, params }) => {
    const memberId = routeId(params.id)
    const aliasId = routeId(params.aliasId, 'aliasId')
    const updated = await memberWrite(audit, (db) =>
      updateMemberAlias(memberId, aliasId, body, { db }),
    )
    if (!updated) throw missingAlias(aliasId)
    return updated
  },
})

export const DELETE = adminRoute<undefined, MemberAliasRecord>({
  output: memberAliasSchema,
  handler: async ({ audit, params }) => {
    const memberId = routeId(params.id)
    const aliasId = routeId(params.aliasId, 'aliasId')
    const deleted = await memberWrite(audit, (db) => deleteMemberAlias(memberId, aliasId, { db }))
    if (!deleted) throw missingAlias(aliasId)
    return deleted
  },
})
