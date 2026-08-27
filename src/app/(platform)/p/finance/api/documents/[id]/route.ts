import { auth } from '@/auth'
import { FinanceAccessRefusal, FinanceRefusal, readFinanceDocument } from '@/lib/finance'
import { claimGateResponse, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

/**
 * Reading a confirming document (spec `docs/specs/339-ledger-intake.md` §D
 * EARS-523, issue #382; acceptance scenario 9).
 *
 * **This handler is the only address a document has.** There is no bucket URL,
 * no pre-signed link and no redirect: the bytes are streamed back through the
 * app after `readFinanceDocument` has answered EARS-523, and a pre-signed URL
 * would simply be a public URL with an expiry — which the clause forbids
 * without an expiry exception.
 *
 * **The claim gate runs first and answers bare** (spec 311 EARS-461/462, D-5),
 * because a route handler passes through no layout. Holding `platform-user` is
 * necessary and nowhere near sufficient: it opens `/p/finance` (EARS-530) and
 * EARS-523 excludes document content from exactly that opening, so the module's
 * own refusal below is what most signed-in members actually meet.
 *
 * **Two different 403s on purpose.** «You are not signed in / not a member» is
 * the gate's bare 403; «you are a member but this is not yours» is the module's
 * message. A 404 for the second would hide which documents exist, but it would
 * also make an authorized reader's typo indistinguishable from a refusal — and
 * the ids are not a secret: the CONTENT is.
 *
 * `content-disposition: attachment` and `X-Content-Type-Options: nosniff`
 * together are why a stored HTML file could not run in the portal's origin even
 * if the mime allowlist ever let one in.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth()
  const refusal = claimGateResponse(session, PLATFORM_USER_ROLE)
  if (refusal) return refusal

  const email = session?.user?.email
  if (typeof email !== 'string' || email === '') {
    return text(403, 'Сессия без email не может читать документы бухгалтерии.')
  }
  const actor = { email, roles: (session?.user as { roles?: string[] })?.roles ?? [] }

  const { id } = await context.params
  const documentId = Number(id)
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return text(400, 'Идентификатор документа — целое положительное число.')
  }

  try {
    const document = await readFinanceDocument(actor, documentId)
    return new Response(new Uint8Array(document.bytes), {
      status: 200,
      headers: {
        'content-type': document.mime,
        'content-length': String(document.size),
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
        'x-content-type-options': 'nosniff',
        // Never a shared cache, never a disk cache: the access decision is
        // per-person and a cached copy outlives it.
        'cache-control': 'no-store, private',
      },
    })
  } catch (cause) {
    if (cause instanceof FinanceAccessRefusal) return text(403, cause.message)
    if (cause instanceof FinanceRefusal) return text(404, cause.message)
    throw cause
  }
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
