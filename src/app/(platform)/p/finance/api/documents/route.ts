import { auth } from '@/auth'
import {
  FinanceAccessRefusal,
  FinanceRefusal,
  FINANCE_DOCUMENT_MAX_BYTES,
  uploadFinanceDocument,
} from '@/lib/finance'
import { claimGateResponse, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

/**
 * Uploading a confirming document (spec `docs/specs/339-ledger-intake.md` §D
 * EARS-514/515, issue #382).
 *
 * **Why this path.** `/p/finance/api/…` rather than a top-level `/api/finance`:
 * the platform lives under `/p/*` (ADR-003), and an `api` segment inside the
 * product's own subtree cannot later collide with the page `/p/finance/documents`
 * that #357's surface might want.
 *
 * **A route handler passes through NO layout.** The `(platform)` group's OIDC
 * gate does not protect it (spec 311 EARS-461/462), so the workspace claim is
 * checked HERE and first — «под /p» does not mean «за гейтом» until the handler
 * says so. What that claim buys is only the right to be ASKED the finance
 * question; the module's own gates (EARS-501/502) then decide, and they would
 * refuse a forged request that somehow reached this function anyway.
 *
 * The body is `multipart/form-data` — `file` plus `kind` plus repeated
 * `intakeItemId` fields. `Request.formData()` buffers, so the size ceiling is
 * checked against the parsed part rather than trusting `content-length`; a
 * lying header would otherwise be the whole limit.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const session = await auth()
  const refusal = claimGateResponse(session, PLATFORM_USER_ROLE)
  if (refusal) return refusal

  const email = session?.user?.email
  if (typeof email !== 'string' || email === '') {
    return text(
      403,
      'Сессия без email не может загружать документы: запись обязана быть атрибутирована.',
    )
  }
  const actor = { email, roles: (session?.user as { roles?: string[] })?.roles ?? [] }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return text(400, 'Ожидается multipart/form-data с полями file, kind и intakeItemId.')
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return text(400, 'Поле «file» обязательно и должно быть файлом.')
  }
  if (file.size > FINANCE_DOCUMENT_MAX_BYTES) {
    // Answered before the bytes are materialised into a Buffer — a 25 MiB
    // ceiling that first allocates the file is not a ceiling.
    return text(413, `Файл больше предела в ${FINANCE_DOCUMENT_MAX_BYTES} байт (EARS-514).`)
  }

  const intakeItemIds: number[] = []
  for (const raw of form.getAll('intakeItemId')) {
    const id = Number(raw)
    if (!Number.isInteger(id) || id <= 0) return text(400, `Некорректный intakeItemId: «${raw}».`)
    intakeItemIds.push(id)
  }

  try {
    const document = await uploadFinanceDocument(actor, {
      filename: file.name,
      mime: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
      kind: String(form.get('kind') ?? ''),
      intakeItemIds,
    })
    // The storage key is deliberately NOT in the answer: it is the one field
    // that would let a client try the object store directly (EARS-523).
    return Response.json(
      {
        id: document.id,
        filename: document.filename,
        mime: document.mime,
        size: document.size,
        kind: document.kind,
        uploadedAt: document.uploadedAt,
      },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    )
  } catch (cause) {
    if (cause instanceof FinanceAccessRefusal) return text(403, cause.message)
    if (cause instanceof FinanceRefusal) return text(422, cause.message)
    throw cause
  }
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
