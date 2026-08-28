// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  attachFinanceDocument,
  deleteFinanceDocument,
  detachFinanceDocument,
  FinanceAccessRefusal,
  FinanceDocumentUploadPending,
  FinanceRefusal,
  listFinanceDocuments,
  readFinanceDocument,
  resumeFinanceDocumentUpload,
  setFinanceDocumentKind,
  uploadFinanceDocument,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { platformTransaction } from '@/lib/platform/db/transaction'
import {
  resolveFinanceDocumentStorage,
  type FinanceDocumentStorage,
} from '@/lib/finance/documents/storage'

import { auditEventsFor, auditWatermark } from './audit-helpers'
import {
  APPROVER,
  ENTRY,
  FIXTURE_AUDIT_CTX,
  fixtureWrite,
  MEMBER,
  postIntakeItem,
  seedIntakeItemFor,
  seedIntakeReferences,
  truncateFinanceTables,
} from './finance-helpers'
import { asMigrator, assertSplitWhereMandatory, privilegeSplitState } from './privilege-helpers'

async function expectTriggerRefusal(work: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(work).rejects.toThrow()
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  )
  const cause = (error as { cause?: { message?: string } })?.cause
  expect(String(cause?.message ?? (error as Error)?.message)).toMatch(pattern)
}

async function pendingDocumentId(work: Promise<unknown>): Promise<number> {
  const cause = await work.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(cause).toBeInstanceOf(FinanceDocumentUploadPending)
  return (cause as FinanceDocumentUploadPending).documentId
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function withFailingDocumentDml<T>(
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  work: () => Promise<T>,
): Promise<T> {
  const suffix = event.toLowerCase()
  const functionName = `test_finance_document_fail_${suffix}`
  const triggerName = `test_finance_document_fail_${suffix}_trigger`
  await asMigrator(async (client) => {
    await client.query(`
      drop trigger if exists ${triggerName} on core.finance_document;
      drop function if exists core.${functionName}();
      create function core.${functionName}() returns trigger language plpgsql as $$
      begin
        raise exception 'injected finance_document ${event} failure';
      end;
      $$;
      create trigger ${triggerName}
        before ${event} on core.finance_document
        for each row execute function core.${functionName}();
    `)
  })
  try {
    return await work()
  } finally {
    await asMigrator(async (client) => {
      await client.query(`
        drop trigger if exists ${triggerName} on core.finance_document;
        drop function if exists core.${functionName}();
      `)
    })
  }
}

function localStorage(): FinanceDocumentStorage {
  return resolveFinanceDocumentStorage({ FINANCE_DOCUMENTS_DIR: storageDir })
}

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
const privilegeSplit = await privilegeSplitState({
  query: async (text: string) => {
    const { rows } = await db.execute(sql.raw(text))
    return { rows: rows as Record<string, unknown>[] }
  },
})
assertSplitWhereMandatory(privilegeSplit, process.env)

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
    expect(doc).not.toHaveProperty('storageKey')
    expect(doc.uploadedBy).toBe(refs.entryMemberId)

    const rows = await db.execute(sql`select storage_key, mime from core.finance_document`)
    expect(rows.rows).toHaveLength(1)
    expect((rows.rows[0] as { storage_key: string }).storage_key).toMatch(/^finance\/documents\//)

    // The content really is retrievable through the module, and ONLY the
    // module's own key knows where it went.
    const read = await readFinanceDocument(ENTRY, doc.id)
    expect(read.bytes.equals(PDF)).toBe(true)
  })

  it('EARS-514: every document write is audited (spec 201)', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)

    // The audit ledger is append-only and `truncateFinanceTables` deliberately
    // leaves it alone, so the window is taken by id rather than by table: what
    // this test asserts is what THIS upload wrote, not what the file wrote.
    const before = await db.execute(sql`select coalesce(max(id), 0) as id from core.audit_event`)
    const since = (before.rows[0] as { id: string }).id

    const doc = await uploadFor(ENTRY, [item.id])

    const events = await db.execute(sql`
      select table_name, actor_email from core.audit_event
      where id > ${since} and table_name in ('finance_document', 'finance_document_link')
      order by table_name
    `)
    const captured = events.rows as { table_name: string; actor_email: string }[]
    expect(captured.map((row) => row.table_name)).toEqual([
      'finance_document',
      'finance_document',
      'finance_document_link',
    ])
    expect(new Set(captured.map((row) => row.actor_email))).toEqual(new Set([ENTRY.email]))
    expect(doc.id).toBeGreaterThan(0)
  })

  it('EARS-514: a database refusal before metadata commit writes no object', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const storage = localStorage()
    let puts = 0
    const observingStorage: FinanceDocumentStorage = {
      ...storage,
      async put(key, bytes) {
        puts += 1
        await storage.put(key, bytes)
      },
    }

    await withFailingDocumentDml('INSERT', async () => {
      await expect(
        uploadFinanceDocument(
          ENTRY,
          {
            filename: 'invoice.pdf',
            mime: 'application/pdf',
            bytes: PDF,
            kind: 'ru_invoice',
            intakeItemIds: [item.id],
          },
          observingStorage,
        ),
      ).rejects.toThrow()
    })

    expect(puts).toBe(0)
  })

  it('EARS-514: a storage failure keeps audited pending metadata and uploader', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const mark = await auditWatermark(db)
    const storage: FinanceDocumentStorage = {
      ...localStorage(),
      async put() {
        throw new Error('injected object PUT failure')
      },
    }

    await expect(
      uploadFinanceDocument(
        ENTRY,
        {
          filename: 'invoice.pdf',
          mime: 'application/pdf',
          bytes: PDF,
          kind: 'ru_invoice',
          intakeItemIds: [item.id],
        },
        storage,
      ),
    ).rejects.toThrow(/injected object PUT failure/)

    const pending = await db.execute(sql`
      select id, uploaded_by, storage_state
      from core.finance_document
    `)
    expect(pending.rows).toEqual([
      expect.objectContaining({
        uploaded_by: refs.entryMemberId,
        storage_state: 'pending_upload',
      }),
    ])
    const events = await auditEventsFor(db, mark, 'finance_document')
    expect(events).toHaveLength(1)
    expect(events[0].actor_email).toBe(ENTRY.email)
    expect(events[0].diff.storage_state?.new).toBe('pending_upload')
  })

  it('EARS-514: a final database failure returns a handle that idempotently finishes the stored object', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    let documentId = 0

    await withFailingDocumentDml('UPDATE', async () => {
      documentId = await pendingDocumentId(uploadFor(ENTRY, [item.id]))
    })

    const resumed = await resumeFinanceDocumentUpload(ENTRY, documentId, PDF)
    const repeated = await resumeFinanceDocumentUpload(ENTRY, documentId, PDF)

    const pending = await db.execute(sql`
      select storage_key, storage_state, uploaded_by
      from core.finance_document
    `)
    expect(pending.rows).toEqual([
      expect.objectContaining({
        storage_state: 'ready',
        uploaded_by: refs.entryMemberId,
      }),
    ])
    const key = String((pending.rows[0] as { storage_key: string }).storage_key)
    expect(readFileSync(path.join(storageDir, key)).equals(PDF)).toBe(true)
    expect(resumed.id).toBe(documentId)
    expect(repeated).toEqual(resumed)
  })

  it('EARS-514: recovery keeps the original authorization, validation, links and audit contract', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const mark = await auditWatermark(db)
    const base = localStorage()
    let fail = true
    const retryableStorage: FinanceDocumentStorage = {
      ...base,
      async put(key, bytes) {
        if (fail) {
          fail = false
          throw new Error('injected object PUT failure')
        }
        await base.put(key, bytes)
      },
    }
    const documentId = await pendingDocumentId(
      uploadFinanceDocument(
        ENTRY,
        {
          filename: 'invoice.pdf',
          mime: 'application/pdf',
          bytes: PDF,
          kind: 'ru_invoice',
          intakeItemIds: [item.id],
        },
        retryableStorage,
      ),
    )

    await expect(
      resumeFinanceDocumentUpload(MEMBER, documentId, PDF, retryableStorage),
    ).rejects.toThrow(FinanceAccessRefusal)
    await expect(
      resumeFinanceDocumentUpload(ENTRY, documentId, Buffer.from('not a PDF'), retryableStorage),
    ).rejects.toThrow(FinanceRefusal)

    const resumed = await resumeFinanceDocumentUpload(ENTRY, documentId, PDF, retryableStorage)
    const links = await db.execute(sql`
      select document_id, intake_item_id
      from core.finance_document_link
      where document_id = ${documentId}
    `)
    const events = await auditEventsFor(db, mark, 'finance_document')

    expect(resumed.id).toBe(documentId)
    expect(links.rows).toEqual([{ document_id: documentId, intake_item_id: item.id }])
    expect(events.map((event) => event.diff.storage_state?.new)).toEqual([
      'pending_upload',
      'ready',
    ])
  })

  it('EARS-514/516: an ambiguous PUT on a terminal correction resumes without replacing bytes', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    await uploadFor(ENTRY, [item.id])
    await postIntakeItem(item.id)

    const base = localStorage()
    let ambiguous = true
    const ambiguousStorage: FinanceDocumentStorage = {
      ...base,
      async put(key, bytes) {
        await base.put(key, bytes)
        if (ambiguous) {
          ambiguous = false
          throw new Error('injected ambiguous PUT outcome')
        }
      },
    }
    const documentId = await pendingDocumentId(
      uploadFinanceDocument(
        ENTRY,
        {
          filename: 'correction.pdf',
          mime: 'application/pdf',
          bytes: PDF,
          kind: 'fiscal_receipt',
          intakeItemIds: [item.id],
        },
        ambiguousStorage,
      ),
    )

    const recovered = await resumeFinanceDocumentUpload(ENTRY, documentId, PDF, ambiguousStorage)
    const changed = Buffer.from(PDF)
    changed[changed.length - 1] ^= 1

    expect(recovered.id).toBe(documentId)
    await expect(
      resumeFinanceDocumentUpload(ENTRY, documentId, changed, ambiguousStorage),
    ).rejects.toThrow(FinanceRefusal)
    expect((await readFinanceDocument(ENTRY, documentId)).bytes.equals(PDF)).toBe(true)
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
    expect((await listFinanceDocuments(MEMBER, { intakeItemId: own.id })).map((d) => d.id)).toEqual(
      [doc.id],
    )
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
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
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

  it('EARS-523: uploader provenance grants no read after their owned link is detached', async () => {
    const refs = await seedIntakeReferences()
    const mine = await seedIntakeItemFor(MEMBER, refs, { source: 'request' })
    const theirs = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(MEMBER, [mine.id])
    await attachFinanceDocument(ENTRY, { documentId: doc.id, intakeItemId: theirs.id })

    await detachFinanceDocument(MEMBER, { documentId: doc.id, intakeItemId: mine.id })

    await expect(readFinanceDocument(MEMBER, doc.id)).rejects.toThrow(FinanceAccessRefusal)
    expect((await readFinanceDocument(ENTRY, doc.id)).bytes.equals(PDF)).toBe(true)
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
    expect((await readFinanceDocument(ENTRY, onRefused.id)).bytes.equals(PDF)).toBe(true)

    await expect(
      detachFinanceDocument(ENTRY, { documentId: onRefused.id, intakeItemId: refused.id }),
    ).rejects.toThrow(FinanceRefusal)
    await expect(deleteFinanceDocument(ENTRY, onRefused.id)).rejects.toThrow(FinanceRefusal)
    await expect(
      detachFinanceDocument(ENTRY, { documentId: onCancelled.id, intakeItemId: cancelled.id }),
    ).rejects.toThrow(FinanceRefusal)
    await expect(deleteFinanceDocument(ENTRY, onCancelled.id)).rejects.toThrow(FinanceRefusal)
  })

  it('EARS-516: the same storage key is never written twice', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])

    const storageKey = String(
      (await db.execute(sql`select storage_key from core.finance_document where id = ${doc.id}`))
        .rows[0]?.storage_key,
    )
    await expect(
      fixtureWrite(async (tx) =>
        tx.execute(sql`
          insert into core.finance_document (storage_key, filename, mime, size, kind, uploaded_by)
          values (${storageKey}, 'copy.pdf', 'application/pdf', 10, 'other',
                  ${refs.entryMemberId})
        `),
      ),
    ).rejects.toThrow()
  })

  it('EARS-516: the database refuses direct mutation of a document linked to a posted item', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])
    await postIntakeItem(item.id)

    await expectTriggerRefusal(
      fixtureWrite((tx) =>
        tx.execute(sql`update core.finance_document set kind = 'other' where id = ${doc.id}`),
      ),
      /EARS-516/,
    )
    await expectTriggerRefusal(
      fixtureWrite((tx) =>
        tx.execute(sql`delete from core.finance_document_link where document_id = ${doc.id}`),
      ),
      /EARS-516/,
    )
    await expectTriggerRefusal(
      fixtureWrite((tx) => tx.execute(sql`delete from core.finance_document where id = ${doc.id}`)),
      /EARS-516/,
    )
  })

  it('EARS-516: database cascades and truncation cannot erase retained document links', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs, { status: 'refused' })
    await uploadFor(ENTRY, [item.id])

    await expectTriggerRefusal(
      fixtureWrite((tx) =>
        tx.execute(sql`delete from core.finance_intake_item where id = ${item.id}`),
      ),
      /EARS-516/,
    )
    await expectTriggerRefusal(
      db.execute(sql`truncate table core.finance_document cascade`),
      /EARS-516/,
    )
  })

  it('EARS-516: the application role cannot rewrite a terminal status and erase its archive', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])
    await postIntakeItem(item.id)

    const actorRole = await db.execute<{
      in_app: boolean
      in_owner: boolean
      is_super: boolean
    }>(sql`
      select pg_has_role(current_user, 'platform_app', 'usage') as in_app,
             pg_has_role(current_user, 'platform_migrator', 'usage') as in_owner,
             (select rolsuper from pg_roles where rolname = current_user) as is_super
    `)
    if (privilegeSplit.split) {
      expect(actorRole.rows[0]).toEqual({ in_app: true, in_owner: false, is_super: false })
    }

    await expectTriggerRefusal(
      fixtureWrite(async (tx) => {
        await tx.execute(sql`
          update core.finance_intake_item
          set status = 'draft', operation_id = null, posted_by = null, posted_at = null
          where id = ${item.id}
        `)
        await tx.execute(sql`delete from core.finance_document_link where document_id = ${doc.id}`)
        await tx.execute(sql`delete from core.finance_document where id = ${doc.id}`)
      }),
      /EARS-516/,
    )

    expect(
      (await db.execute(sql`select id from core.finance_document where id = ${doc.id}`)).rows,
    ).toHaveLength(1)
  })

  it('EARS-516: a terminal transition wins its race with a document-link deletion', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])
    const statusWritten = deferred()
    const releaseTransition = deferred()

    const transition = platformTransaction(FIXTURE_AUDIT_CTX, async (tx) => {
      await tx.execute(sql`
        update core.finance_intake_item
        set status = 'refused', refusal_reason = 'fixture refusal'
        where id = ${item.id}
      `)
      statusWritten.resolve()
      await releaseTransition.promise
    })
    await statusWritten.promise

    let deletionSettled = false
    const deletion = fixtureWrite((tx) =>
      tx
        .execute(sql`delete from core.finance_document_link where document_id = ${doc.id}`)
        .finally(() => {
          deletionSettled = true
        }),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(deletionSettled).toBe(false)

    releaseTransition.resolve()
    await transition
    await expectTriggerRefusal(deletion, /EARS-516/)
  })

  it('EARS-516: an object-delete failure keeps a retryable audited database handle', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])
    const mark = await auditWatermark(db)
    const storage: FinanceDocumentStorage = {
      ...localStorage(),
      async remove() {
        throw new Error('injected object DELETE failure')
      },
    }

    await expect(deleteFinanceDocument(ENTRY, doc.id, storage)).rejects.toThrow(
      /injected object DELETE failure/,
    )

    const pending = await db.execute(sql`
      select storage_state from core.finance_document where id = ${doc.id}
    `)
    expect(pending.rows).toEqual([{ storage_state: 'pending_delete' }])
    expect((await auditEventsFor(db, mark, 'finance_document')).at(-1)?.diff.storage_state).toEqual(
      {
        old: 'ready',
        new: 'pending_delete',
      },
    )

    await deleteFinanceDocument(ENTRY, doc.id)
    expect(
      (await db.execute(sql`select id from core.finance_document where id = ${doc.id}`)).rows,
    ).toHaveLength(0)
  })

  it('EARS-516: a final database-delete failure remains retryable after object removal', async () => {
    const refs = await seedIntakeReferences()
    const item = await seedIntakeItemFor(ENTRY, refs)
    const doc = await uploadFor(ENTRY, [item.id])
    let removals = 0
    const storage = localStorage()
    const observingStorage: FinanceDocumentStorage = {
      ...storage,
      async remove(key) {
        removals += 1
        await storage.remove(key)
      },
    }

    await withFailingDocumentDml('DELETE', async () => {
      await expect(deleteFinanceDocument(ENTRY, doc.id, observingStorage)).rejects.toThrow()
    })

    expect(removals).toBe(1)
    const pending = await db.execute(sql`
      select storage_state from core.finance_document where id = ${doc.id}
    `)
    expect(pending.rows).toEqual([{ storage_state: 'pending_delete' }])

    await deleteFinanceDocument(ENTRY, doc.id, observingStorage)
    expect(removals).toBe(2)
    expect(
      (await db.execute(sql`select id from core.finance_document where id = ${doc.id}`)).rows,
    ).toHaveLength(0)
  })
})
