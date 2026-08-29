import {
  getMemberById,
  memberRecordSchema,
  memberUpdateSchema,
  updateMemberProfile,
  type MemberRecord,
  type MemberUpdateInput,
} from '@/lib/member'
import { adminRoute } from '@/lib/platform/api'

import { memberRecord, memberWrite, missingMember, routeId } from '../http'

export const GET = adminRoute<undefined, MemberRecord>({
  output: memberRecordSchema,
  handler: async ({ params }) => {
    const id = routeId(params.id)
    const found = await getMemberById(id)
    if (!found) throw missingMember(id)
    return memberRecord(found)
  },
})

export const PATCH = adminRoute<MemberUpdateInput, MemberRecord>({
  input: memberUpdateSchema,
  output: memberRecordSchema,
  handler: async ({ audit, body, params }) => {
    const id = routeId(params.id)
    const updated = await memberWrite(audit, (db) => updateMemberProfile(id, body, { db }))
    if (!updated) throw missingMember(id)
    return memberRecord(updated)
  },
})
