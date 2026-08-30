import {
  createPublicationBatch,
  hoursPublicationRecordSchema,
  hoursPublicationRequestSchema,
  recordPublicationDelivery,
  type HoursPublicationRecord,
  type HoursPublicationRequest,
} from '@/lib/hours'
import { readHoursDocument } from '@/lib/hours/store-core'
import { adminRoute, ModuleApiError } from '@/lib/platform/api'

import { hoursWrite, publicationRecord } from '../http'

const DELIVERY_TIMEOUT_MS = 10_000

export const GET = adminRoute<undefined, HoursPublicationRecord>({
  output: hoursPublicationRecordSchema,
  handler: async ({ searchParams }) => {
    const periodId = searchParams.get('periodId')?.trim()
    if (!periodId) throw new ModuleApiError('bad-request', 'periodId: выберите период.')
    return publicationRecord(await readHoursDocument(), periodId)
  },
})

export const POST = adminRoute<HoursPublicationRequest, HoursPublicationRecord>({
  input: hoursPublicationRequestSchema,
  output: hoursPublicationRecordSchema,
  handler: async ({ audit, body }) => {
    const webhookUrl = process.env.MATTERMOST_HOURS_WEBHOOK_URL?.trim()
    if (!webhookUrl) {
      throw new ModuleApiError(
        'conflict',
        'Публикация в Mattermost не настроена — позови администратора.',
      )
    }

    const created = await hoursWrite(audit, (doc) =>
      createPublicationBatch(doc, body.periodId, body.previewFingerprint, new Date().toISOString()),
    )

    for (const [position, message] of created.saved.messages.entries()) {
      let delivery: 'sent' | 'failed' | 'unknown'
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: message.text }),
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        })
        delivery =
          response.status === 200 && (await response.text()).trim() === 'ok' ? 'sent' : 'failed'
      } catch {
        delivery = 'unknown'
      }

      const progressed = await hoursWrite(audit, (doc) =>
        recordPublicationDelivery(doc, body.periodId, position, delivery, new Date().toISOString()),
      )
      if (delivery !== 'sent') {
        const sent = progressed.saved.messages.filter(
          (candidate) => candidate.delivery === 'sent',
        ).length
        throw new ModuleApiError(
          'conflict',
          `${delivery === 'unknown' ? 'Результат доставки неизвестен' : 'Mattermost не подтвердил доставку'}. Отправлено ${sent} из ${progressed.saved.messages.length}; автоматический повтор заблокирован.`,
        )
      }
    }

    return publicationRecord(await readHoursDocument(), body.periodId)
  },
})
