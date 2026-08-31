import {
  hoursParticipantRecordSchema,
  hoursParticipantUpdateSchema,
  findParticipant,
  normalizeEmail,
  upsertParticipant,
  type HoursParticipantRecord,
  type HoursParticipantUpdate,
} from '@/lib/hours'
import { adminRoute, ModuleApiError } from '@/lib/platform/api'

import { hoursRead, hoursWrite, participantRecord, routeText } from '../../http'

function emailParam(value: string | string[] | undefined): string {
  return normalizeEmail(routeText(value, 'email'))
}

export const GET = adminRoute<undefined, HoursParticipantRecord>({
  output: hoursParticipantRecordSchema,
  handler: async ({ params }) => {
    const email = emailParam(params.email)
    const doc = await hoursRead()
    const participant = doc.participants.find((candidate) => candidate.email === email)
    if (!participant) throw new ModuleApiError('not-found', `Участник ${email} не найден.`)
    return participantRecord(participant)
  },
})

export const PATCH = adminRoute<HoursParticipantUpdate, HoursParticipantRecord>({
  input: hoursParticipantUpdateSchema,
  output: hoursParticipantRecordSchema,
  handler: async ({ audit, body, params }) => {
    const email = emailParam(params.email)
    const result = await hoursWrite(audit, (doc) => {
      if (!findParticipant(doc, email)) {
        throw new ModuleApiError('not-found', `Участник ${email} не найден.`)
      }
      return upsertParticipant(doc, { email, ...body })
    })
    return participantRecord(result.saved)
  },
})
