import {
  hoursParticipantCreateSchema,
  hoursParticipantRecordSchema,
  upsertParticipant,
  type HoursParticipantCreate,
  type HoursParticipantRecord,
} from '@/lib/hours'
import { readHoursDocument } from '@/lib/hours/store-core'
import { adminRoute, moduleListResult } from '@/lib/platform/api'

import { hoursWrite, participantRecord } from '../http'

export const GET = adminRoute<undefined, HoursParticipantRecord>({
  output: hoursParticipantRecordSchema,
  handler: async ({ query }) => {
    const doc = await readHoursDocument()
    const needle = query.q?.trim().toLocaleLowerCase('ru') ?? ''
    const records = doc.participants
      .map(participantRecord)
      .filter((participant) =>
        needle
          ? [participant.name, participant.email, participant.role, participant.grade].some(
              (value) => value?.toLocaleLowerCase('ru').includes(needle),
            )
          : true,
      )
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
    const start = (query.page - 1) * query.pageSize
    return moduleListResult({
      items: records.slice(start, start + query.pageSize),
      total: records.length,
    })
  },
})

export const POST = adminRoute<HoursParticipantCreate, HoursParticipantRecord>({
  input: hoursParticipantCreateSchema,
  output: hoursParticipantRecordSchema,
  handler: async ({ audit, body }) => {
    const result = await hoursWrite(audit, (doc) => upsertParticipant(doc, body))
    return participantRecord(result.saved)
  },
})
