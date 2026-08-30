import {
  deletePeriod,
  hoursPeriodRecordSchema,
  hoursPeriodUpdateSchema,
  setPeriodStatus,
  updatePeriod,
  type HoursPeriodRecord,
  type HoursPeriodUpdate,
} from '@/lib/hours'
import { readHoursDocument } from '@/lib/hours/store-core'
import { adminRoute } from '@/lib/platform/api'

import { hoursWrite, periodRecord, routeText } from '../../http'

export const GET = adminRoute<undefined, HoursPeriodRecord>({
  output: hoursPeriodRecordSchema,
  handler: async ({ params }) => {
    const doc = await readHoursDocument()
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
    const before = await readHoursDocument()
    const record = periodRecord(before, id)
    await hoursWrite(audit, (doc) => deletePeriod(doc, id))
    return record
  },
})
