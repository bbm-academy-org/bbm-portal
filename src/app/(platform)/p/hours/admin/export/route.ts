import { auth } from '@/auth'
import { HoursDataError, isHoursAdmin, readHoursDocument, sessionEmail } from '@/lib/hours'
import { PLATFORM_ADMIN_ROLE, claimGateResponse } from '@/lib/platform/authGate'

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

  // Спека 311 EARS-461/EARS-462: обработчик под `/p` не проходит ни через один
  // layout, поэтому claim-гейт рабочего пространства он применяет сам. Это
  // единственный такой путь под `/p` сегодня — «под /p» не значит «за гейтом»,
  // пока обработчик не проверит клейм. Проверка идёт ПЕРВОЙ и отвечает голой
  // 403 (D-5); allowlist ниже остаётся до EARS-421/EARS-452, которые его
  // удаляют вместе с этим маршрутом.
  const refusal = claimGateResponse(session, PLATFORM_ADMIN_ROLE)
  if (refusal) return refusal

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
