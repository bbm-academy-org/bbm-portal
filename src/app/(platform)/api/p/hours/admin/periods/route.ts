import { randomUUID } from 'node:crypto'

import {
  createPeriod,
  hoursPeriodCreateSchema,
  hoursPeriodRecordSchema,
  type HoursPeriodCreate,
  type HoursPeriodRecord,
} from '@/lib/hours'
import { readHoursDocument } from '@/lib/hours/store-core'
import { adminRoute, moduleListResult } from '@/lib/platform/api'

import { hoursWrite, periodRecord } from '../http'

export const GET = adminRoute<undefined, HoursPeriodRecord>({
  output: hoursPeriodRecordSchema,
  handler: async ({ query }) => {
    const doc = await readHoursDocument()
    const needle = query.q?.trim().toLocaleLowerCase('ru') ?? ''
    const records = doc.periods
      .map((period) => periodRecord(doc, period.id))
      .filter((period) =>
        needle
          ? `${period.label} ${period.dateFrom} ${period.dateTo}`
              .toLocaleLowerCase('ru')
              .includes(needle)
          : true,
      )
    const start = (query.page - 1) * query.pageSize
    return moduleListResult({
      items: records.slice(start, start + query.pageSize),
      total: records.length,
    })
  },
})

export const POST = adminRoute<HoursPeriodCreate, HoursPeriodRecord>({
  input: hoursPeriodCreateSchema,
  output: hoursPeriodRecordSchema,
  handler: async ({ audit, body }) => {
    const result = await hoursWrite(audit, (doc) => createPeriod(doc, body, randomUUID()))
    return periodRecord(result.doc, result.saved.id, result.warnings)
  },
})
