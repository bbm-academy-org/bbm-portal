import { auth } from '@/auth'
import {
  FinanceAccessRefusal,
  FinanceDocumentUploadPending,
  FinanceRefusal,
  FINANCE_DOCUMENT_MAX_BYTES,
  assertFinanceDocumentBytes,
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
 * `intakeItemId` fields. The raw stream is bounded before `formData()` sees it;
 * `content-length` is only an early refusal and never the load-bearing limit.
 */

export const dynamic = 'force-dynamic'

const MULTIPART_OVERHEAD_BYTES = 64 * 1024
const MAX_MULTIPART_BYTES = FINANCE_DOCUMENT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES
const MAX_INTAKE_ITEM_IDS = 64

class MultipartTooLarge extends Error {}

async function boundedFormData(request: Request): Promise<FormData> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_MULTIPART_BYTES) throw new MultipartTooLarge()
  if (request.body === null) throw new TypeError('missing multipart body')

  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_MULTIPART_BYTES) {
      await reader.cancel()
      throw new MultipartTooLarge()
    }
    chunks.push(Buffer.from(value))
  }

  const bounded = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: Buffer.concat(chunks, total),
  })
  return bounded.formData()
}

function multipartShapeRefusal(form: FormData): string | null {
  const entries = [...form.entries()]
  const allowed = new Set(['file', 'kind', 'intakeItemId'])
  if (entries.some(([name]) => !allowed.has(name))) {
    return 'Multipart содержит неизвестное поле: разрешены только file, kind и intakeItemId.'
  }
  if (form.getAll('file').length !== 1 || form.getAll('kind').length !== 1) {
    return 'Поля file и kind должны встречаться ровно по одному разу.'
  }
  if (form.getAll('intakeItemId').length > MAX_INTAKE_ITEM_IDS) {
    return `Один документ нельзя связать более чем с ${MAX_INTAKE_ITEM_IDS} позициями.`
  }
  if (
    entries.some(
      ([name, value]) => name !== 'file' && (typeof value !== 'string' || value.length > 128),
    )
  ) {
    return 'Текстовое поле multipart длиннее допустимого предела.'
  }
  return null
}

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
    form = await boundedFormData(request)
  } catch (cause) {
    if (cause instanceof MultipartTooLarge) {
      return text(413, `Запрос больше предела в ${MAX_MULTIPART_BYTES} байт (EARS-514).`)
    }
    return text(400, 'Ожидается multipart/form-data с полями file, kind и intakeItemId.')
  }

  const shapeRefusal = multipartShapeRefusal(form)
  if (shapeRefusal !== null) {
    return text(400, shapeRefusal)
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return text(400, 'Поле «file» обязательно и должно быть файлом.')
  }
  if (file.name.length > 255) {
    return text(400, 'Имя файла длиннее 255 символов.')
  }
  if (file.size > FINANCE_DOCUMENT_MAX_BYTES) {
    return text(413, `Файл больше предела в ${FINANCE_DOCUMENT_MAX_BYTES} байт (EARS-514).`)
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  try {
    assertFinanceDocumentBytes({ filename: file.name, mime: file.type, bytes })
  } catch {
    return text(
      422,
      'Содержимое, тип или расширение файла не входят в допустимый набор (EARS-514).',
    )
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
      bytes,
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
    if (cause instanceof FinanceDocumentUploadPending) {
      return pendingUpload(cause.documentId)
    }
    if (cause instanceof FinanceAccessRefusal) return text(403, cause.message)
    if (cause instanceof FinanceRefusal) return text(422, cause.message)
    throw cause
  }
}

function pendingUpload(documentId: number): Response {
  return Response.json(
    {
      id: documentId,
      uploadStatus: 'pending',
      recovery: {
        method: 'PUT',
        href: `/p/finance/api/documents/${documentId}`,
      },
    },
    { status: 503, headers: { 'cache-control': 'no-store' } },
  )
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
