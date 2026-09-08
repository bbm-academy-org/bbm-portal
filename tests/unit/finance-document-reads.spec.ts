// @vitest-environment node
/**
 * The READ path of the document archive against the connection pool (#470).
 *
 * The board's stop-state on the acceptance stand was not a slow query: every
 * pooled client sat `idle in transaction`, each holding one client and waiting
 * for a second, because the member lookup inside `listFinanceDocuments`'
 * transaction ran on the POOL. With the pg default of 10 clients a board of ten
 * rows wedged the whole process for good. Both facets are pinned here:
 *
 *  1. a transaction never asks the pool for a second client — the member lookup
 *     is handed the transaction's own executor;
 *  2. the BOARD reads the documents of every row in ONE transaction, so the
 *     number of clients a board load needs does not grow with the row count.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { financeDocumentLink } from '@/lib/platform/db/schema/finance/finance-document-link'

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  /** Every transaction opened through the one door, in order. */
  transactions: [] as unknown[],
  items: [] as Row[],
  links: [] as Row[],
  /** `{ db }` as each member lookup received it — `undefined` means «the pool». */
  memberLookupExecutors: [] as unknown[],
}))

function fakeTx(): unknown {
  const tx = {
    select(): unknown {
      let table: unknown = null
      const builder = {
        from(source: unknown) {
          table = source
          return builder
        },
        innerJoin() {
          return builder
        },
        where(): Promise<Row[]> {
          return Promise.resolve(table === financeDocumentLink ? db.links : db.items)
        },
      }
      return builder
    },
  }
  db.transactions.push(tx)
  return tx
}

vi.mock('@/lib/platform/db/transaction', () => ({
  platformTransaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx()),
  platformReadTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx()),
}))

vi.mock('@/lib/member', () => ({
  findMemberByEmail: async (email: string, options?: { db?: unknown }) => {
    db.memberLookupExecutors.push(options?.db)
    return email === MEMBER.email ? { id: 15 } : null
  },
}))

const MEMBER = { email: 'member@bbm.academy', roles: ['platform-user'] }

const document = (id: number): Row => ({
  id,
  storageKey: `finance/${id}.pdf`,
  contentDigest: 'x'.repeat(64),
  filename: `act-${id}.pdf`,
  mime: 'application/pdf',
  size: 1024,
  kind: 'act',
  storageState: 'ready',
  uploadedBy: 15,
  uploadedAt: new Date('2026-09-01T10:00:00Z'),
})

beforeEach(() => {
  db.transactions = []
  db.memberLookupExecutors = []
  db.items = []
  db.links = []
})

describe('finance documents — the read path and the pool (#470)', () => {
  it('resolves the member on the TRANSACTION, never asking the pool for a second client', async () => {
    const { listFinanceDocuments } = await import('@/lib/finance/documents/documents')
    db.items = [{ id: 41, source: 'request', createdBy: 15, status: 'submitted' }]
    db.links = [{ intakeItemId: 41, document: document(7) }]

    const documents = await listFinanceDocuments(MEMBER, { intakeItemId: 41 })

    expect(documents.map((view) => view.id)).toEqual([7])
    expect(db.transactions).toHaveLength(1)
    expect(db.memberLookupExecutors).toEqual([db.transactions[0]])
  })

  it('reads the documents of a whole board in ONE transaction, whatever the row count', async () => {
    const { listFinanceDocumentsByItems } = await import('@/lib/finance/documents/documents')
    const ids = Array.from({ length: 30 }, (_, index) => 100 + index)
    db.items = ids.map((id) => ({ id, source: 'request', createdBy: 15, status: 'submitted' }))
    db.links = [
      { intakeItemId: 100, document: document(1) },
      { intakeItemId: 100, document: document(2) },
      { intakeItemId: 101, document: document(3) },
    ]

    const byItem = await listFinanceDocumentsByItems(MEMBER, ids)

    expect(db.transactions).toHaveLength(1)
    expect(db.memberLookupExecutors).toEqual([db.transactions[0]])
    expect(byItem.get(100)?.map((view) => view.id)).toEqual([1, 2])
    expect(byItem.get(101)?.map((view) => view.id)).toEqual([3])
    expect(byItem.get(102) ?? []).toEqual([])
  })

  it('opens no transaction at all for an empty board', async () => {
    const { listFinanceDocumentsByItems } = await import('@/lib/finance/documents/documents')

    expect((await listFinanceDocumentsByItems(MEMBER, [])).size).toBe(0)
    expect(db.transactions).toHaveLength(0)
  })
})
