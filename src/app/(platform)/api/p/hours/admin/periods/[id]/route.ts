import {
  deletePeriod,
  hoursPeriodRecordSchema,
  hoursPeriodUpdateSchema,
  setPeriodStatus,
  updatePeriod,
  type HoursPeriodRecord,
  type HoursPeriodUpdate,
} from '@/lib/hours'
import { adminRoute } from '@/lib/platform/api'

import { hoursRead, hoursWrite, periodRecord, routeText } from '../../http'

export const GET = adminRoute<undefined, HoursPeriodRecord>({
  output: hoursPeriodRecordSchema,
  handler: async ({ params }) => {
    const doc = await hoursRead()
    return periodRecord(doc, routeText(params.id, 'id'))
  },
})

export const PATCH = adminRoute<HoursPeriodUpdate, HoursPeriodRecord>({
  input: hoursPeriodUpdateSchema,
  output: hoursPeriodRecordSchema,
  handler: async ({ audit, body, params }) => {
    const id = routeText(params.id, 'id')
    const result = await hoursWrite(audit, (doc) =>
      'status' in body ? setPeriodStatus(doc, id, body.status) : updatePeriod(doc, { id, ...body }),
    )
    return periodRecord(result.doc, result.saved.id, result.warnings)
  },
})

export const DELETE = adminRoute<undefined, HoursPeriodRecord>({
  output: hoursPeriodRecordSchema,
  handler: async ({ audit, params }) => {
    const id = routeText(params.id, 'id')
    const result = await hoursWrite(audit, (doc) => {
      const record = periodRecord(doc, id)
      const deleted = deletePeriod(doc, id)
      return deleted.ok ? { ...deleted, saved: record } : deleted
    })
    return result.saved
  },
})
