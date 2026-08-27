// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  attachFinanceDocument,
  deleteFinanceDocument,
  detachFinanceDocument,
  FinanceAccessRefusal,
  FinanceRefusal,
  listFinanceDocuments,
  readFinanceDocument,
  setFinanceDocumentKind,
  uploadFinanceDocument,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import {
  APPROVER,
  ENTRY,
  fixtureWrite,
  MEMBER,
  postIntakeItem,
  seedIntakeItemFor,
  seedIntakeReferences,
  truncateFinanceTables,
} from './finance-helpers'

/**
 * Documents against the REAL `core` tables (spec
 * `docs/specs/339-ledger-intake.md` §D, issue #382).
 *
 * This tier carries the weight because every clause of §D is a statement about
 * ROWS. EARS-523's «the submitter reads their OWN items' documents» is a join
 * from a document through `finance_document_link` to `finance_intake_item
 * .created_by`; EARS-516's «never deleted or replaced» turns on whether ANY
 * linked item reached `posted`. A mocked repository would assert the module's
 * opinion of those joins rather than the joins.
 *
 * Storage is pointed at a throwaway directory — the dev fallback of EARS-514 is
 * the code path under test here as well, since no bucket is configured on a dev
 * stand or in CI.
 *
 * Needs `PLATFORM_DATABASE_URL` (this worktree's branch DB — see
 * `.claude/rules/parallel-sessions.md`, "Platform database").
 */
const db = getPlatformDb()

let storageDir: string

beforeAll(() => {
  storageDir = mkdtempSync(path.join(tmpdir(), 'bbm-finance-docs-int-'))
  process.env.FINANCE_DOCUMENTS_DIR = storageDir
  delete process.env.FINANCE_DOCUMENTS_S3_BUCKET
})

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  rmSync(storageDir, { recursive: true, force: true })
  await closePlatformDb()
})

const PDF = Buffer.from('%PDF-1.7 fixture invoice')

async function uploadFor(actor: typeof ENTRY, intakeItemIds: number[], kind = 'ru_invoice') {
  return uploadFinanceDocument(actor, {
    filename: 'invoice.pdf',
    mime: 'application/pdf',
    bytes: PDF,
    kind,
    intakeItemIds,
  })
}

describe('storing a document (spec 339 EARS-514/515)', () => {
  it('EARS-514: an upload lands in private storage with its metadata row and uploader', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)

    const doc = await uploadFor(ENTRY, [item.id])

    expect(doc.filename).toBe('invoice.pdf')
    expect(doc.mime).toBe('application/pdf')
    expect(doc.size).toBe(PDF.byteLength)
    expect(doc.kind).toBe('ru_invoice')
    expect(doc.storageKey).toMatch(/^finance\/documents\//)
    expect(doc.uploadedBy).toBe(refs.entryMemberId)

    const rows = await db.execute(sql`select storage_key, mime from core.finance_document`)
    expect(rows.rows).toHaveLength(1)

    // The content really is retrievable through the module, and ONLY the
    // module's own key knows where it went.
    const read = await readFinanceDocument(ENTRY, doc.id)
    expect(read.bytes.equals(PDF)).toBe(true)
  })

  it('EARS-514: every document write is audited (spec 201)', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)

    const doc = await uploadFor(ENTRY, [item.id])

    const events = await db.execute(sql`
      select table_name, actor_email from core.audit_event
      where table_name in ('finance_document', 'finance_document_link')
      order by table_name
    `)
    const captured = events.rows as { table_name: string; actor_email: string }[]
    expect(captured.map((row) => row.table_name)).toEqual([
      'finance_document',
      'finance_document_link',
    ])
    expect(new Set(captured.map((row) => row.actor_email))).toEqual(new Set([ENTRY.email]))
    expect(doc.id).toBeGreaterThan(0)
  })

  it('EARS-514: only the entry role uploads outside its own request', async () => {
    const refs = await seedIntakeReferences()
    const entryItem = await seedIntakeItemFor(ENTRY, refs)

    await expect(uploadFor(MEMBER, [entryItem.id])).rejects.toThrow(FinanceAccessRefusal)
    await expect(uploadFor(APPROVER, [entryItem.id])).rejects.toThrow(FinanceAccessRefusal)
  })

  it('EARS-502: a role-less member attaches a document to their OWN request', async () => {
    const refs = await seedIntakeReferences()
    const own = await seedIntakeItemFor(MEMBER, refs, { source: 'request' })

    const doc = await uploadFor(MEMBER, [own.id])

    expect(doc.uploadedBy).toBe(refs.memberMemberId)
    expect((await listFinanceDocuments(MEMBER, { intakeItemId: own.id })).map((d) => d.id)).toEqual([
      doc.id,
    ])
  })

  it('EARS-502: a role-less member may not upload without naming an own item', async () => {
    await seedIntakeReferences()
    await expect(uploadFor(MEMBER, [])).rejects.toThrow(FinanceAccessRefusal)
  })

  it('EARS-514: one document may confirm several items', async () => {
    const refs = await seedIntakeReferences()
    const first = await seedIntakeItemFor(ENTRY, refs)
    const second = await seedIntakeItemFor(ENTRY, refs)

    const doc = await uploadFor(ENTRY, [first.id, second.id])

    expect((await listFinanceDocuments(ENTRY, { intakeItemId: first.id }))[0].id).toBe(doc.id)
    expect((await listFinanceDocuments(ENTRY, { intakeItemId: second.id }))[0].id).toBe(doc.id)

    // …and the same pair cannot be linked twice.
    await expect(
      attachFinanceDocument(ENTRY, { documentId: doc.id, intakeItemId: first.id }),
    ).rejects.toThrow(FinanceRefusal)
  })

  it('EARS-515: any kind may be attached — the kind gates nothing', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)

    const screenshot = await uploadFinanceDocument(ENTRY, {
      filename: 'sber.png',
      mime: 'image/png',
      bytes: Buffer.from('\x89PNG fixture'),
      kind: 'bank_screenshot',
      intakeItemIds: [item.id],
    })
    const foreign = await uploadFor(ENTRY, [item.id], 'foreign_invoice')

    expect(screenshot.kind).toBe('bank_screenshot')
    expect(foreign.kind).toBe('foreign_invoice')
  })
})

describe('who may read a document (spec 339 EARS-523)', () => {
  it('EARS-523: the submitter reads their own items documents and no one elses', async () => {
    const refs = await seedIntakeReferences()
    const mine = await seedIntakeItemFor(MEMBER, refs, { source: 'request' })
    const theirs = await seedIntakeItemFor(ENTRY, refs)

    const myDoc = await uploadFor(MEMBER, [mine.id])
    const theirDoc = await uploadFor(ENTRY, [theirs.id])

    expect((await readFinanceDocument(MEMBER, myDoc.id)).bytes.equals(PDF)).toBe(true)
    await expect(readFinanceDocument(MEMBER, theirDoc.id)).rejects.toThrow(FinanceAccessRefusal)
  })

  it('EARS-523: both flow roles read every document', async () => {
    const refs = await seedIntakeReferences()
    const mine = await seedIntakeItemFor(MEMBER, refs, { source: 'request' })
    const doc = await uploadFor(MEMBER, [mine.id])

    expect((await readFinanceDocument(ENTRY, doc.id)).bytes.equals(PDF)).toBe(true)
    expect((await readFinanceDocument(APPROVER, doc.id)).bytes.equals(PDF)).toBe(true)
  })

  it('EARS-523: the open member-wide read of /p/finance does not reach document content', async () => {
    const refs = await seedIntakeReferences()
    const theirs = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [theirs.id])

    // MEMBER holds `platform-user` — the role that opens `/p/finance` (EARS-530).
    // It buys nothing here, and the list is refused as flatly as the content.
    await expect(readFinanceDocument(MEMBER, doc.id)).rejects.toThrow(FinanceAccessRefusal)
    await expect(listFinanceDocuments(MEMBER, { intakeItemId: theirs.id })).rejects.toThrow(
      FinanceAccessRefusal,
    )
  })

  it('EARS-523: an actor with no member row reads nothing', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])

    await expect(
      readFinanceDocument({ email: 'stranger@example.com', roles: ['platform-user'] }, doc.id),
    ).rejects.toThrow(FinanceAccessRefusal)
  })
})

describe('a document does not move once it confirmed a posting (spec 339 EARS-516)', () => {
  it('EARS-516: a document linked to a posted operation is never deleted', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])

    await postIntakeItem(item.id)

    await expect(deleteFinanceDocument(ENTRY, doc.id)).rejects.toThrow(FinanceRefusal)
    await expect(
      detachFinanceDocument(ENTRY, { documentId: doc.id, intakeItemId: item.id }),
    ).rejects.toThrow(FinanceRefusal)
    // The content is still there — the refusal is not a soft delete.
    expect((await readFinanceDocument(ENTRY, doc.id)).bytes.equals(PDF)).toBe(true)
  })

  it('EARS-516: nor is it replaced — the module offers no replace at all', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])

    await postIntakeItem(item.id)

    // Correcting a wrong document is attaching another one, which still works.
    await expect(setFinanceDocumentKind(ENTRY, doc.id, 'other')).rejects.toThrow(FinanceRefusal)
    const replacement = await uploadFor(ENTRY, [item.id], 'fiscal_receipt')
    expect(
      (await listFinanceDocuments(ENTRY, { intakeItemId: item.id })).map((d) => d.id).sort(),
    ).toEqual([doc.id, replacement.id].sort())
  })

  it('EARS-516: an unlinked document and one on an unposted item are still deletable', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])

    await setFinanceDocumentKind(ENTRY, doc.id, 'payment_order')
    await deleteFinanceDocument(ENTRY, doc.id)

    const rows = await db.execute(sql`select id from core.finance_document`)
    expect(rows.rows).toHaveLength(0)
    await expect(readFinanceDocument(ENTRY, doc.id)).rejects.toThrow(FinanceRefusal)
  })

  it('EARS-516: documents of refused and cancelled items are kept with them', async () => {
    const refs = await seedIntakeReferences()
    const refused = await seedIntakeItemFor(ENTRY, refs, { status: 'refused' })
    const cancelled = await seedIntakeItemFor(ENTRY, refs, { status: 'cancelled' })

    const onRefused = await uploadFor(ENTRY, [refused.id])
    const onCancelled = await uploadFor(ENTRY, [cancelled.id])

    expect((await listFinanceDocuments(ENTRY, { intakeItemId: refused.id }))[0].id).toBe(
      onRefused.id,
    )
    expect((await listFinanceDocuments(APPROVER, { intakeItemId: cancelled.id }))[0].id).toBe(
      onCancelled.id,
    )
    // Kept, not frozen: a terminal item that never posted is not the EARS-516 case.
    expect((await readFinanceDocument(ENTRY, onRefused.id)).bytes.equals(PDF)).toBe(true)
  })

  it('EARS-516: the same storage key is never written twice', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])

    await expect(
      fixtureWrite(async (tx) =>
        tx.execute(sql`
          insert into core.finance_document (storage_key, filename, mime, size, kind, uploaded_by)
          values (${doc.storageKey}, 'copy.pdf', 'application/pdf', 10, 'other',
                  ${refs.entryMemberId})
        `),
      ),
    ).rejects.toThrow()
  })
})
