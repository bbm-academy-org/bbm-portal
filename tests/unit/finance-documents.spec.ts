// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertFinanceDocumentUpload,
  FinanceRefusal,
  FINANCE_DOCUMENT_KINDS,
  FINANCE_DOCUMENT_MAX_BYTES,
  FINANCE_DOCUMENT_MIME_TYPES,
} from '@/lib/finance'
import {
  buildFinanceDocumentStorageKey,
  resolveFinanceDocumentStorage,
} from '@/lib/finance/documents/storage'

const s3Mock = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  denyHeads: false,
  delayHeads: false,
  commands: [] as Array<{ name: string; input: Record<string, unknown> }>,
}))

vi.mock('@aws-sdk/client-s3', () => {
  class S3Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  class HeadObjectCommand extends S3Command {}
  class PutObjectCommand extends S3Command {}
  class GetObjectCommand extends S3Command {}
  class DeleteObjectCommand extends S3Command {}

  class S3Client {
    async send(command: S3Command): Promise<Record<string, unknown>> {
      s3Mock.commands.push({ name: command.constructor.name, input: command.input })
      const key = String(command.input.Key)

      if (command instanceof HeadObjectCommand) {
        if (s3Mock.delayHeads) await new Promise<void>((resolve) => setTimeout(resolve, 0))
        if (s3Mock.denyHeads) throw s3Error(403)
        if (!s3Mock.objects.has(key)) throw s3Error(404)
        return {}
      }

      if (command instanceof PutObjectCommand) {
        if (command.input.IfNoneMatch === '*' && s3Mock.objects.has(key)) throw s3Error(412)
        s3Mock.objects.set(key, Buffer.from(command.input.Body as Uint8Array))
        return {}
      }

      if (command instanceof DeleteObjectCommand) {
        s3Mock.objects.delete(key)
        return {}
      }

      return {
        Body: {
          transformToByteArray: async () => s3Mock.objects.get(key),
        },
      }
    }
  }

  return { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand }
})

function s3Error(status: number): Error {
  return Object.assign(new Error(`S3 ${status}`), { $metadata: { httpStatusCode: status } })
}

/**
 * The document layer's pure half (spec `docs/specs/339-ledger-intake.md` §D,
 * issue #382): what a storage location IS, what an upload is allowed to be, and
 * that the `kind` taxonomy is data rather than a gate.
 *
 * What deliberately is NOT here: the access decision (EARS-523) and the
 * immutability refusal (EARS-516). Both are statements about ROWS — who created
 * the intake item, whether it posted — so they are proved against the real
 * tables in `tests/int/platform/finance-documents.int.spec.ts`, not against a
 * mock's opinion of them.
 */

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bbm-finance-docs-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

beforeEach(() => {
  s3Mock.objects.clear()
  s3Mock.denyHeads = false
  s3Mock.delayHeads = false
  s3Mock.commands.length = 0
})

describe('where a finance document is stored (spec 339 EARS-514)', () => {
  it('EARS-514: with no private bucket configured, storage falls back to local disk', async () => {
    const dir = tempDir()
    const storage = resolveFinanceDocumentStorage({ FINANCE_DOCUMENTS_DIR: dir })

    expect(storage.driver).toBe('local')

    await storage.put('finance/documents/2026/08/abc.pdf', Buffer.from('%PDF-1.7 fixture'))
    const back = await storage.get('finance/documents/2026/08/abc.pdf')

    expect(back.toString('utf8')).toBe('%PDF-1.7 fixture')
    // The bytes really landed on disk under the configured root, and nothing
    // escaped it: the key is a path, and a path is the classic traversal seam.
    expect(readFileSync(path.join(dir, 'finance/documents/2026/08/abc.pdf'), 'utf8')).toBe(
      '%PDF-1.7 fixture',
    )
  })

  it('EARS-514: production refuses to start the archive without its private bucket', () => {
    expect(() =>
      resolveFinanceDocumentStorage({
        NODE_ENV: 'production',
        FINANCE_DOCUMENTS_DIR: tempDir(),
      }),
    ).toThrow(FinanceRefusal)
  })

  it('EARS-514: a configured private bucket selects object storage instead of disk', () => {
    const storage = resolveFinanceDocumentStorage({
      FINANCE_DOCUMENTS_S3_BUCKET: 'bbm-portal-finance-private',
      FINANCE_DOCUMENTS_S3_ENDPOINT: 'https://s3.twcstorage.ru',
      FINANCE_DOCUMENTS_S3_REGION: 'ru-1',
      FINANCE_DOCUMENTS_S3_ACCESS_KEY_ID: 'key',
      FINANCE_DOCUMENTS_S3_SECRET_ACCESS_KEY: 'secret',
      S3_BUCKET: 'bbm-portal-media',
    })

    expect(storage.driver).toBe('s3')
    expect(storage.bucket).toBe('bbm-portal-finance-private')
  })

  it('EARS-514: pointing document storage at the PUBLIC media bucket is refused', () => {
    expect(() =>
      resolveFinanceDocumentStorage({
        FINANCE_DOCUMENTS_S3_BUCKET: 'bbm-portal-media',
        S3_BUCKET: 'bbm-portal-media',
      }),
    ).toThrow(FinanceRefusal)
  })

  it('EARS-514: an S3 bucket named without credentials is refused, not silently ignored', () => {
    // A half-configured bucket must not degrade into the disk fallback: an
    // operator who set the bucket believes the files are in it.
    expect(() =>
      resolveFinanceDocumentStorage({ FINANCE_DOCUMENTS_S3_BUCKET: 'bbm-portal-finance-private' }),
    ).toThrow(FinanceRefusal)
  })

  it('EARS-523: a storage key never resolves outside the configured root', async () => {
    const dir = tempDir()
    const storage = resolveFinanceDocumentStorage({ FINANCE_DOCUMENTS_DIR: dir })
    const outside = path.join(dir, '..', 'escaped.txt')
    writeFileSync(outside, 'not yours')

    await expect(storage.get('../escaped.txt')).rejects.toThrow(FinanceRefusal)
    await expect(storage.put('../escaped.txt', Buffer.from('x'))).rejects.toThrow(FinanceRefusal)
  })

  it('EARS-514: the storage key is unguessable and carries no member-supplied path', () => {
    const first = buildFinanceDocumentStorageKey('счёт от Anthropic.pdf', new Date('2026-08-27'))
    const second = buildFinanceDocumentStorageKey('счёт от Anthropic.pdf', new Date('2026-08-27'))

    expect(first).not.toBe(second)
    expect(first).toMatch(/^finance\/documents\/2026\/08\/[0-9a-f-]{36}\.pdf$/)
    expect(first).not.toContain('счёт')
  })

  it('EARS-516: S3 uses one atomic create-only write and never treats denied HEAD as absence', async () => {
    const storage = resolveFinanceDocumentStorage({
      FINANCE_DOCUMENTS_S3_BUCKET: 'bbm-portal-finance-private',
      FINANCE_DOCUMENTS_S3_ACCESS_KEY_ID: 'key',
      FINANCE_DOCUMENTS_S3_SECRET_ACCESS_KEY: 'secret',
    })
    const key = 'finance/documents/2026/08/occupied.pdf'
    s3Mock.objects.set(key, Buffer.from('original'))
    s3Mock.denyHeads = true

    await expect(storage.put(key, Buffer.from('replacement'))).rejects.toThrow(FinanceRefusal)
    expect(s3Mock.objects.get(key)?.toString()).toBe('original')
    expect(s3Mock.commands).toEqual([
      expect.objectContaining({
        name: 'PutObjectCommand',
        input: expect.objectContaining({ IfNoneMatch: '*' }),
      }),
    ])
  })

  it('EARS-516: concurrent S3 writers cannot both create the same object key', async () => {
    const storage = resolveFinanceDocumentStorage({
      FINANCE_DOCUMENTS_S3_BUCKET: 'bbm-portal-finance-private',
      FINANCE_DOCUMENTS_S3_ACCESS_KEY_ID: 'key',
      FINANCE_DOCUMENTS_S3_SECRET_ACCESS_KEY: 'secret',
    })
    const key = 'finance/documents/2026/08/race.pdf'
    s3Mock.delayHeads = true

    const results = await Promise.allSettled([
      storage.put(key, Buffer.from('first')),
      storage.put(key, Buffer.from('second')),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })
})

describe('what may be uploaded (spec 339 EARS-514/515)', () => {
  const ok = { filename: 'invoice.pdf', mime: 'application/pdf', size: 1024, kind: 'ru_invoice' }

  it('EARS-514: a PDF and an image are accepted', () => {
    expect(() => assertFinanceDocumentUpload(ok)).not.toThrow()
    expect(() =>
      assertFinanceDocumentUpload({ ...ok, filename: 'shot.png', mime: 'image/png' }),
    ).not.toThrow()
    expect(FINANCE_DOCUMENT_MIME_TYPES).toContain('application/pdf')
  })

  it('EARS-514: a type outside the PDF-and-images set is refused', () => {
    expect(() =>
      assertFinanceDocumentUpload({ ...ok, filename: 'macro.xlsm', mime: 'application/zip' }),
    ).toThrow(FinanceRefusal)
    expect(() =>
      assertFinanceDocumentUpload({ ...ok, filename: 'a.html', mime: 'text/html' }),
    ).toThrow(FinanceRefusal)
  })

  it('EARS-514: an oversize upload and an empty one are both refused', () => {
    expect(() =>
      assertFinanceDocumentUpload({ ...ok, size: FINANCE_DOCUMENT_MAX_BYTES + 1 }),
    ).toThrow(FinanceRefusal)
    expect(() => assertFinanceDocumentUpload({ ...ok, size: 0 })).toThrow(FinanceRefusal)
  })

  it('EARS-515: the kind set is the corpus five plus the statement and a rest bucket', () => {
    expect([...FINANCE_DOCUMENT_KINDS]).toEqual([
      'ru_invoice',
      'fiscal_receipt',
      'foreign_invoice',
      'payment_order',
      'bank_screenshot',
      'bank_statement',
      'other',
    ])
  })

  it('EARS-515: the kind is DATA — every kind is accepted at upload, none gates it', () => {
    for (const kind of FINANCE_DOCUMENT_KINDS) {
      expect(() => assertFinanceDocumentUpload({ ...ok, kind })).not.toThrow()
    }
    // …and a kind outside the taxonomy is still a refusal: «data, not a gate»
    // narrows what the kind DECIDES, not what the column may hold.
    expect(() => assertFinanceDocumentUpload({ ...ok, kind: 'napkin' })).toThrow(FinanceRefusal)
  })
})
