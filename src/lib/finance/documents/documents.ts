/**
 * The document handlers — upload, attach, read, retype, delete (spec
 * `docs/specs/339-ledger-intake.md` §D, issue #382).
 *
 * **The gate lives HERE, not on the route** (EARS-501/523, spec 311 EARS-405).
 * A surface that forgets to check is a bug, not a hole: every function below
 * answers the access question itself, so a CLI, a future importer and the two
 * route handlers under `/p/finance/api/documents` all get the same answer.
 *
 * **Three different access questions, and they are genuinely different.**
 *
 *  - *May you PUT a document into the archive?* — the intake gate
 *    (`assertFinanceIntakeAccess`), because attaching a document is filling the
 *    intake. `finance-entry` anywhere; a role-less member only onto items they
 *    submitted (EARS-502). An approver is not admitted, for the reason
 *    `core/actor.ts` argues at length: EARS-501 splits the roles BY ACT.
 *  - *May you READ its content?* — EARS-523, which is NOT upload provenance.
 *    The submitter reads documents currently linked to their own items; both
 *    flow roles read everything; `platform-user` — the role that opens
 *    `/p/finance` for everyone (EARS-530) — buys nothing here. That exclusion
 *    is written into EARS-530 itself.
 *  - *May it MOVE?* — EARS-516, which is not about the actor at all. Posted
 *    items freeze every mutation; refused/cancelled items retain their links
 *    and bytes. No uploader, approver or admin bypass exists.
 *
 * **What this file deliberately does not do.** It does not enforce the document
 * gate at posting time: `intake/posting.ts` asks whether a ready document is
 * linked (EARS-506), while this layer owns attachment and storage lifecycle.
 * It renders nothing (#357 owns `/p/finance`),
 * and it reads no `kind` to decide anything (EARS-515: the kind is data).
 * Object storage and Postgres cannot share a transaction; `storage_state`
 * records audited intent before either external side effect and leaves a
 * retryable handle instead of an anonymous blob after a failure.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'

import { and, eq, inArray } from 'drizzle-orm'

import { findMemberByEmail } from '@/lib/member'
import {
  financeDocument,
  FINANCE_DOCUMENT_KINDS,
  FINANCE_DOCUMENT_LEGACY_DIGEST,
  FINANCE_DOCUMENT_MIME_TYPES,
  type FinanceDocumentKind,
} from '@/lib/platform/db/schema/finance/finance-document'
import { financeDocumentLink } from '@/lib/platform/db/schema/finance/finance-document-link'
import { financeIntakeItem } from '@/lib/platform/db/schema/finance/finance-intake-item'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import {
  assertFinanceIntakeAccess,
  financeAuditContext,
  holdsFinanceFlowRole,
  type FinanceActor,
} from '../core/actor'
import { FinanceAccessRefusal, FinanceRefusal } from '../core/errors'
import {
  buildFinanceDocumentStorageKey,
  resolveFinanceDocumentStorage,
  type FinanceDocumentStorage,
} from './storage'

/**
 * The ceiling on one upload.
 *
 * 25 MiB is a scanned multi-page invoice with room to spare and a phone photo
 * several times over; it is not a number the corpus dictated, so it is stated
 * once, here, rather than repeated in a form and a route. A file above it is
 * refused rather than truncated: half a document is not a smaller document.
 */
export const FINANCE_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024

function financeDocumentDigest(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

/** A document as the module hands it out. Never the storage key's contents. */
export type FinanceDocumentView = {
  id: number
  filename: string
  mime: string
  size: number
  kind: FinanceDocumentKind
  uploadedBy: number
  uploadedAt: Date
}

/** A durable upload exists and the caller must retry it by this public id. */
export class FinanceDocumentUploadPending extends Error {
  override readonly name = 'FinanceDocumentUploadPending'

  constructor(
    readonly documentId: number,
    readonly cause?: unknown,
  ) {
    super(`Загрузка документа #${documentId} не завершена; повторите её по этому идентификатору.`)
  }
}

export type UploadFinanceDocumentInput = {
  filename: string
  mime: string
  bytes: Buffer
  kind: string
  /**
   * The items this document confirms. Optional for a flow-role holder (a file
   * may arrive before the line it belongs to); REQUIRED for a role-less member,
   * whose whole permission is «their own items» (EARS-502).
   */
  intakeItemIds?: readonly number[]
}

function toView(row: typeof financeDocument.$inferSelect): FinanceDocumentView {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    size: Number(row.size),
    kind: row.kind as FinanceDocumentKind,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt,
  }
}

const EXTENSIONS_BY_MIME: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/tiff': ['.tif', '.tiff'],
  'image/heic': ['.heic', '.heif'],
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

function detectedMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  const gif = bytes.subarray(0, 6).toString('ascii')
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'image/tiff'
  }
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brands = bytes.subarray(8, Math.min(bytes.length, 32)).toString('ascii')
    if (/(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(brands)) return 'image/heic'
  }
  return null
}

/** Match caller-controlled multipart metadata to the file's actual signature. */
export function assertFinanceDocumentBytes(input: {
  filename: string
  mime: string
  bytes: Buffer
}): void {
  const actual = detectedMime(input.bytes)
  if (actual === null || actual !== input.mime) {
    throw new FinanceRefusal(
      `Содержимое файла не совпадает с заявленным типом «${input.mime}» (EARS-514). ` +
        'Допустимы только настоящие PDF и изображения.',
    )
  }
  const extension = path.extname(input.filename).toLowerCase()
  if (!(EXTENSIONS_BY_MIME[actual] ?? []).includes(extension)) {
    throw new FinanceRefusal(
      `Расширение файла «${extension || '(нет)'}» не соответствует его формату «${actual}» (EARS-514).`,
    )
  }
}

/**
 * What an upload is allowed to BE (EARS-514/515) — shape only, no actor and no
 * rows, so a form can ask the same question before it sends a byte.
 */
export function assertFinanceDocumentUpload(input: {
  filename: string
  mime: string
  size: number
  kind: string
}): void {
  if (typeof input.filename !== 'string' || input.filename.trim() === '') {
    throw new FinanceRefusal('У документа должно быть имя файла — оно попадает в архив как есть.')
  }
  if (!(FINANCE_DOCUMENT_MIME_TYPES as readonly string[]).includes(input.mime)) {
    throw new FinanceRefusal(
      `Тип «${input.mime}» не принимается: подтверждающий документ это PDF или изображение ` +
        `(${FINANCE_DOCUMENT_MIME_TYPES.join(', ')}) — EARS-514. Архив бухгалтерии не файлопомойка.`,
    )
  }
  if (!Number.isInteger(input.size) || input.size <= 0) {
    throw new FinanceRefusal(
      'Пустой файл не документ: это неудавшаяся загрузка, которая потом выглядит как доказательство.',
    )
  }
  if (input.size > FINANCE_DOCUMENT_MAX_BYTES) {
    throw new FinanceRefusal(
      `Файл ${input.size} байт больше предела в ${FINANCE_DOCUMENT_MAX_BYTES} байт (EARS-514).`,
    )
  }
  if (!(FINANCE_DOCUMENT_KINDS as readonly string[]).includes(input.kind)) {
    throw new FinanceRefusal(
      `Вид документа «${input.kind}» не входит в набор спеки 339 ` +
        `(${FINANCE_DOCUMENT_KINDS.join(', ')}). Вид — это ДАННЫЕ (EARS-515): он ничего не ` +
        'запрещает, но и произвольным быть не может — иначе аналитика по видам не собирается.',
    )
  }
}

/** Who this actor is in `core.member` — every document names its uploader. */
async function requireMemberId(actor: FinanceActor): Promise<number> {
  const member = await findMemberByEmail(actor.email)
  if (member === null) {
    throw new FinanceAccessRefusal(
      `У ${actor.email} нет записи в общем реестре людей (core.member), а документ обязан ` +
        'называть загрузившего. Заведите участника — src/lib/member.',
    )
  }
  return member.id
}

/** The member id, or `null` — for the READ path, where «not a member» is a refusal, not an error. */
async function memberIdOrNull(actor: FinanceActor): Promise<number | null> {
  if (typeof actor.email !== 'string' || actor.email.trim() === '') return null
  const member = await findMemberByEmail(actor.email)
  return member?.id ?? null
}

/** The items named, loaded — with a readable refusal for any that does not exist. */
async function loadItems(tx: PlatformTx, ids: readonly number[]) {
  if (ids.length === 0) return []
  const rows = await tx
    .select()
    .from(financeIntakeItem)
    .where(inArray(financeIntakeItem.id, [...ids]))
    .for('update')
  const found = new Set(rows.map((row) => row.id))
  const missing = ids.filter((id) => !found.has(id))
  if (missing.length > 0) {
    throw new FinanceRefusal(`Позиции приёмки не существует: ${missing.join(', ')}.`)
  }
  return rows
}

/**
 * Is every named item this actor's OWN request (EARS-502)?
 *
 * The carve-out is the CALLER's fact, exactly as `FinanceIntakeAct` says: the
 * handler holds the rows, so it is the only place that can know they are
 * `source = 'request'` and were submitted by this actor. An EMPTY list is
 * deliberately NOT «own» — an unattached upload names no item to own, so it is
 * the entry role's act, not the submitter's.
 */
function isOwnRequestSet(
  items: readonly { source: string; createdBy: number }[],
  memberId: number | null,
): boolean {
  if (items.length === 0 || memberId === null) return false
  return items.every((item) => item.source === 'request' && item.createdBy === memberId)
}

function assertItemsAcceptDocument(items: readonly { status: string; id: number }[]): void {
  const terminal = items.filter((item) => ['posted', 'refused', 'cancelled'].includes(item.status))
  if (terminal.length === 0) return
  throw new FinanceRefusal(
    `К терминальным позициям приёмки (${terminal.map((item) => `#${item.id}`).join(', ')}) нельзя прикреплять новые документы (EARS-516).`,
  )
}

/**
 * Upload one document and link it to the items it confirms (EARS-514/515).
 *
 * Three monotone acts: commit `pending_upload` metadata and links; PUT bytes;
 * commit `ready`. A failure before PUT creates no object, and a failure during
 * or after PUT leaves the storage key, uploader, metadata and audit trail in
 * Postgres. That is a durable recovery handle, not a claim that S3 joined the
 * database transaction.
 */
export async function uploadFinanceDocument(
  actor: FinanceActor,
  input: UploadFinanceDocumentInput,
  storage: FinanceDocumentStorage = resolveFinanceDocumentStorage(),
): Promise<FinanceDocumentView> {
  const bytes = input.bytes
  if (!Buffer.isBuffer(bytes)) {
    throw new FinanceRefusal('Содержимое документа должно быть буфером байтов.')
  }
  assertFinanceDocumentUpload({
    filename: input.filename,
    mime: input.mime,
    size: bytes.byteLength,
    kind: input.kind,
  })
  assertFinanceDocumentBytes({ filename: input.filename, mime: input.mime, bytes })

  const uploadedBy = await requireMemberId(actor)
  const itemIds = [...new Set(input.intakeItemIds ?? [])]
  const storageKey = buildFinanceDocumentStorageKey(input.filename)

  const pending = await platformTransaction(financeAuditContext(actor), async (tx) => {
    const items = await loadItems(tx, itemIds)
    assertFinanceIntakeAccess(actor, { ownRequest: isOwnRequestSet(items, uploadedBy) })
    assertItemsAcceptDocument(items)

    const [row] = await tx
      .insert(financeDocument)
      .values({
        storageKey,
        contentDigest: financeDocumentDigest(bytes),
        filename: input.filename,
        mime: input.mime,
        size: bytes.byteLength,
        kind: input.kind,
        uploadedBy,
      })
      .returning()
    if (items.length > 0) {
      await tx.insert(financeDocumentLink).values(
        items.map((item) => ({
          documentId: row.id,
          intakeItemId: item.id,
          linkedBy: uploadedBy,
        })),
      )
    }
    return row
  })

  try {
    return await resumeFinanceDocumentUpload(actor, pending.id, bytes, storage)
  } catch (cause) {
    if (cause instanceof FinanceDocumentUploadPending) throw cause
    // The initial caller does not yet know the id. Once metadata committed,
    // every later refusal/failure must carry that stable recovery handle.
    throw new FinanceDocumentUploadPending(pending.id, cause)
  }
}

/** The document row, or a readable refusal. */
async function requireDocument(tx: PlatformTx, documentId: number, lock = false) {
  const query = tx.select().from(financeDocument).where(eq(financeDocument.id, documentId))
  const [row] = lock ? await query.for('update') : await query
  if (row === undefined) throw new FinanceRefusal(`Документа #${documentId} не существует.`)
  return row
}

function assertRecoveryBytes(document: typeof financeDocument.$inferSelect, bytes: Buffer): void {
  if (!Buffer.isBuffer(bytes)) {
    throw new FinanceRefusal('Содержимое документа должно быть буфером байтов.')
  }
  if (bytes.byteLength !== Number(document.size)) {
    throw new FinanceRefusal(
      `Повтор документа #${document.id} содержит ${bytes.byteLength} байт вместо исходных ${document.size} (EARS-514/516).`,
    )
  }
  const actualDigest = financeDocumentDigest(bytes)
  if (
    document.contentDigest !== FINANCE_DOCUMENT_LEGACY_DIGEST &&
    actualDigest !== document.contentDigest
  ) {
    throw new FinanceRefusal(
      `Повтор документа #${document.id} не совпадает с исходно загруженными байтами (EARS-514/516).`,
    )
  }
  if (
    document.contentDigest === FINANCE_DOCUMENT_LEGACY_DIGEST &&
    document.storageState === 'pending_upload'
  ) {
    throw new FinanceRefusal(
      `Незавершённый документ #${document.id} создан до учёта контрольной суммы, поэтому его исходные байты нельзя подтвердить. ` +
        'Удалите незавершённую запись и загрузите документ заново (EARS-514/516).',
    )
  }
  assertFinanceDocumentUpload({
    filename: document.filename,
    mime: document.mime,
    size: bytes.byteLength,
    kind: document.kind,
  })
  assertFinanceDocumentBytes({ filename: document.filename, mime: document.mime, bytes })
}

/**
 * Finish one durable `pending_upload` by its public id (EARS-514).
 *
 * The row and its linked intake items stay locked while storage is checked and
 * written. S3 still does not join the database transaction: if PUT succeeds and
 * commit fails, the row remains pending and the exact repeat is a storage no-op.
 * Holding the locks only prevents a supported delete/status act from racing the
 * recovery into an anonymous object.
 */
export async function resumeFinanceDocumentUpload(
  actor: FinanceActor,
  documentId: number,
  bytes: Buffer,
  storage: FinanceDocumentStorage = resolveFinanceDocumentStorage(),
): Promise<FinanceDocumentView> {
  const memberId = await requireMemberId(actor)
  try {
    return await platformTransaction(financeAuditContext(actor), async (tx) => {
      const document = await requireDocument(tx, documentId, true)
      const items = await linkedItems(tx, document.id, true)
      assertFinanceIntakeAccess(actor, { ownRequest: isOwnRequestSet(items, memberId) })
      assertRecoveryBytes(document, bytes)

      if (document.storageState === 'pending_delete') {
        throw new FinanceRefusal(
          `Документ #${document.id} уже удаляется и не может возобновить загрузку (EARS-514/516).`,
        )
      }
      if (document.storageState === 'ready') {
        const existing = await storage.get(document.storageKey)
        if (!existing.equals(bytes)) {
          throw new FinanceRefusal(
            `Готовый документ #${document.id} нельзя заменить другими байтами (EARS-516).`,
          )
        }
        return toView(document)
      }

      await storage.put(document.storageKey, bytes)
      const [ready] = await tx
        .update(financeDocument)
        .set({ storageState: 'ready' })
        .where(eq(financeDocument.id, document.id))
        .returning()
      return toView(ready)
    })
  } catch (cause) {
    if (cause instanceof FinanceAccessRefusal || cause instanceof FinanceRefusal) throw cause
    throw new FinanceDocumentUploadPending(documentId, cause)
  }
}

function assertDocumentReady(document: typeof financeDocument.$inferSelect, act: string): void {
  if (document.storageState === 'ready') return
  throw new FinanceRefusal(
    `Документ #${document.id} ещё не завершил действие с приватным хранилищем ` +
      `(состояние «${document.storageState}»), поэтому ${act} нельзя (EARS-514/516).`,
  )
}

/** Every intake item this document confirms — the EARS-516 and EARS-523 input. */
async function linkedItems(tx: PlatformTx, documentId: number, lock = false) {
  const query = tx
    .select({
      id: financeIntakeItem.id,
      status: financeIntakeItem.status,
      source: financeIntakeItem.source,
      createdBy: financeIntakeItem.createdBy,
      operationId: financeIntakeItem.operationId,
    })
    .from(financeDocumentLink)
    .innerJoin(financeIntakeItem, eq(financeDocumentLink.intakeItemId, financeIntakeItem.id))
    .where(eq(financeDocumentLink.documentId, documentId))
  return lock ? query.for('update') : query
}

function assertLinkMayBeRemoved(
  documentId: number,
  items: readonly { status: string; id: number }[],
  act: string,
): void {
  const retained = items.filter((item) => ['posted', 'refused', 'cancelled'].includes(item.status))
  if (retained.length === 0) return
  throw new FinanceRefusal(
    `Документ #${documentId} хранится с терминальной позицией (${retained.map((item) => `#${item.id}`).join(', ')}), ` +
      `поэтому ${act} нельзя (EARS-516).`,
  )
}

/**
 * EARS-516: has this document already confirmed a posting?
 *
 * `status = 'posted'` and `operation_id is not null` are the same fact — the
 * `finance_intake_item_posting_shape` CHECK makes them equivalent — so reading
 * either is reading the clause's «linked to a posted operation».
 */
function assertNotPosted(
  documentId: number,
  items: readonly { status: string; id: number }[],
  act: string,
): void {
  const posted = items.filter((item) => item.status === 'posted')
  if (posted.length === 0) return
  throw new FinanceRefusal(
    `Документ #${documentId} подтверждает проведённую операцию (позиции ` +
      `${posted.map((item) => `#${item.id}`).join(', ')}), поэтому ${act} нельзя (EARS-516). ` +
      'Исправление неверного документа — прикрепить другой, а не подменить этот.',
  )
}

/**
 * May this actor read the CONTENT of this document (EARS-523)?
 *
 * Returns nothing and throws on refusal, in the shape of the actor gates: a
 * function that returned a boolean would eventually be called without its
 * result being looked at.
 */
async function assertReadAccess(
  tx: PlatformTx,
  actor: FinanceActor,
  document: typeof financeDocument.$inferSelect,
): Promise<void> {
  if (holdsFinanceFlowRole(actor)) return

  const memberId = await memberIdOrNull(actor)
  if (memberId !== null) {
    // EARS-523 follows current owned links; upload provenance grants no read.
    const items = await linkedItems(tx, document.id)
    if (items.some((item) => item.source === 'request' && item.createdBy === memberId)) return
  }

  throw new FinanceAccessRefusal(
    `Содержимое документа #${document.id} читают роли «finance-entry» / «finance-approve» ` +
      'и автор заявки, к которой он приложен (EARS-523). Открытое чтение /p/finance для всех ' +
      'участников (EARS-530) на содержимое документов НЕ распространяется.',
  )
}

/** Metadata plus bytes, for a caller that has passed EARS-523. */
export type FinanceDocumentContent = FinanceDocumentView & { bytes: Buffer }

/**
 * Read a document's content — the ONE way bytes leave the archive (EARS-523).
 *
 * No sibling that returns a URL exists, and that is the clause rather than an
 * unfinished API: an address a browser can follow without this function is
 * precisely «a public or unauthenticated URL to a document».
 */
export async function readFinanceDocument(
  actor: FinanceActor,
  documentId: number,
  storage: FinanceDocumentStorage = resolveFinanceDocumentStorage(),
): Promise<FinanceDocumentContent> {
  const document = await platformTransaction(financeAuditContext(actor), async (tx) => {
    const row = await requireDocument(tx, documentId)
    await assertReadAccess(tx, actor, row)
    assertDocumentReady(row, 'читать его содержимое')
    return row
  })
  try {
    return { ...toView(document), bytes: await storage.get(document.storageKey) }
  } catch (cause) {
    if (cause instanceof FinanceRefusal) throw cause
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new FinanceRefusal(`Документ #${document.id} не удалось прочитать из архива: ${detail}`)
  }
}

/** The documents confirming one intake item, metadata only — same gate as the content. */
export async function listFinanceDocuments(
  actor: FinanceActor,
  filter: { intakeItemId: number },
): Promise<FinanceDocumentView[]> {
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const [item] = await tx
      .select()
      .from(financeIntakeItem)
      .where(eq(financeIntakeItem.id, filter.intakeItemId))
    if (item === undefined) {
      throw new FinanceRefusal(`Позиции приёмки #${filter.intakeItemId} не существует.`)
    }
    if (!holdsFinanceFlowRole(actor)) {
      const memberId = await memberIdOrNull(actor)
      if (memberId === null || item.source !== 'request' || item.createdBy !== memberId) {
        throw new FinanceAccessRefusal(
          `Документы позиции #${item.id} видят роли «finance-entry» / «finance-approve» ` +
            'и автор самой заявки (EARS-523).',
        )
      }
    }
    const rows = await tx
      .select({ document: financeDocument })
      .from(financeDocumentLink)
      .innerJoin(financeDocument, eq(financeDocumentLink.documentId, financeDocument.id))
      .where(
        and(
          eq(financeDocumentLink.intakeItemId, item.id),
          eq(financeDocument.storageState, 'ready'),
        ),
      )
    return rows.map((row) => toView(row.document))
  })
}

/** Attach an EXISTING document to one more item — «one document, several items». */
export async function attachFinanceDocument(
  actor: FinanceActor,
  input: { documentId: number; intakeItemId: number },
): Promise<void> {
  const linkedBy = await requireMemberId(actor)
  await platformTransaction(financeAuditContext(actor), async (tx) => {
    const document = await requireDocument(tx, input.documentId, true)
    assertDocumentReady(document, 'прикреплять его')
    const [item] = await loadItems(tx, [input.intakeItemId])
    assertFinanceIntakeAccess(actor, { ownRequest: isOwnRequestSet([item], linkedBy) })
    assertItemsAcceptDocument([item])

    const [existing] = await tx
      .select()
      .from(financeDocumentLink)
      .where(
        and(
          eq(financeDocumentLink.documentId, document.id),
          eq(financeDocumentLink.intakeItemId, item.id),
        ),
      )
    if (existing !== undefined) {
      throw new FinanceRefusal(
        `Документ #${document.id} уже приложен к позиции #${item.id} — второй раз это ` +
          'двойной клик, а не второй факт.',
      )
    }
    await tx
      .insert(financeDocumentLink)
      .values({ documentId: document.id, intakeItemId: item.id, linkedBy })
  })
}

/** Detach a document from a mutable item; terminal items retain it (EARS-516). */
export async function detachFinanceDocument(
  actor: FinanceActor,
  input: { documentId: number; intakeItemId: number },
): Promise<void> {
  const memberId = await requireMemberId(actor)
  await platformTransaction(financeAuditContext(actor), async (tx) => {
    const document = await requireDocument(tx, input.documentId, true)
    assertDocumentReady(document, 'откреплять его')
    const [item] = await loadItems(tx, [input.intakeItemId])
    assertFinanceIntakeAccess(actor, { ownRequest: isOwnRequestSet([item], memberId) })
    assertLinkMayBeRemoved(document.id, [item], 'откреплять его')

    await tx
      .delete(financeDocumentLink)
      .where(
        and(
          eq(financeDocumentLink.documentId, document.id),
          eq(financeDocumentLink.intakeItemId, item.id),
        ),
      )
  })
}

/**
 * Change a document's `kind` — the ONE editable column, and only while nothing
 * it confirms has posted (spec 339 CRUD table: «`kind` only, while no linked
 * item is posted»).
 */
export async function setFinanceDocumentKind(
  actor: FinanceActor,
  documentId: number,
  kind: string,
): Promise<FinanceDocumentView> {
  if (!(FINANCE_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    throw new FinanceRefusal(
      `Вид документа «${kind}» не входит в набор спеки 339 (${FINANCE_DOCUMENT_KINDS.join(', ')}).`,
    )
  }
  const memberId = await requireMemberId(actor)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const document = await requireDocument(tx, documentId, true)
    assertDocumentReady(document, 'менять его вид')
    const items = await linkedItems(tx, document.id, true)
    assertFinanceIntakeAccess(actor, { ownRequest: isOwnRequestSet(items, memberId) })
    assertNotPosted(document.id, items, 'менять его вид')

    const [row] = await tx
      .update(financeDocument)
      .set({ kind })
      .where(eq(financeDocument.id, document.id))
      .returning()
    return toView(row)
  })
}

/**
 * Delete a document only while unlinked or linked exclusively to mutable items.
 * Posted, refused and cancelled items retain their documents (EARS-516).
 *
 * Three monotone acts: commit `pending_delete`; remove bytes; delete the row.
 * Either failure leaves the row, links, storage key and audit trail in place,
 * so the same document id can retry. The links go only with the final row delete
 * through the cascade the link table declares.
 */
export async function deleteFinanceDocument(
  actor: FinanceActor,
  documentId: number,
  storage: FinanceDocumentStorage = resolveFinanceDocumentStorage(),
): Promise<void> {
  const memberId = await requireMemberId(actor)
  const storageKey = await platformTransaction(financeAuditContext(actor), async (tx) => {
    const document = await requireDocument(tx, documentId, true)
    const items = await linkedItems(tx, document.id, true)
    assertFinanceIntakeAccess(actor, { ownRequest: isOwnRequestSet(items, memberId) })
    assertLinkMayBeRemoved(document.id, items, 'удалять его')

    if (document.storageState !== 'pending_delete') {
      await tx
        .update(financeDocument)
        .set({ storageState: 'pending_delete' })
        .where(eq(financeDocument.id, document.id))
    }
    return document.storageKey
  })
  await storage.remove(storageKey)
  await platformTransaction(financeAuditContext(actor), async (tx) => {
    const document = await requireDocument(tx, documentId, true)
    const items = await linkedItems(tx, document.id, true)
    assertFinanceIntakeAccess(actor, { ownRequest: isOwnRequestSet(items, memberId) })
    assertLinkMayBeRemoved(document.id, items, 'удалять его')
    if (document.storageState !== 'pending_delete') {
      throw new FinanceRefusal(
        `Документ #${document.id} нельзя удалить из состояния «${document.storageState}» (EARS-516).`,
      )
    }
    await tx.delete(financeDocument).where(eq(financeDocument.id, document.id))
  })
}
