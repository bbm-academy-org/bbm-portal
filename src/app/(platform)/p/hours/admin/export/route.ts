import { auth } from '@/auth'
import { HoursDataError, isHoursAdmin, readHoursDocument, sessionEmail } from '@/lib/hours'

/**
 * Выгрузка JSON-документа для владельца (спека 081 п.25, сценарий 10): данные
 * для верификационной рассылки без SSH на прод.
 *
 * Route handler НЕ проходит через `(platform)/layout.tsx` — OIDC-гейт группы его
 * не защищает. Поэтому здесь и сессия, и allowlist администраторов проверяются
 * заново (п.10: гейт применяется к каждой серверной точке, а не только к
 * рендеру).
 *
 * Отдаётся сериализованный РАЗОБРАННЫЙ документ: если база модуля часов не
 * отвечает, владелец получит внятную 500-ку, а не половину выгрузки.
 */

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const session = await auth()
  const email = sessionEmail(session)
  if (!isHoursAdmin(email, process.env.HOURS_ADMIN_EMAILS)) {
    return new Response('Доступ только для администраторов модуля часов.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  try {
    const doc = await readHoursDocument()
    return new Response(`${JSON.stringify(doc, null, 2)}\n`, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="bbm-hours.json"',
        'cache-control': 'no-store',
      },
    })
  } catch (cause) {
    if (!(cause instanceof HoursDataError)) throw cause
    return new Response('Данные недоступны: база модуля часов не отвечает. Оценки не тронуты.', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
}
