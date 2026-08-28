/**
 * Where a finance document's bytes actually live (spec
 * `docs/specs/339-ledger-intake.md` §D EARS-514, issue #382).
 *
 * **One decision, taken from the environment, in one place.** A private bucket
 * is mandatory in production; local disk is the explicit dev/CI fallback from
 * EARS-514. A missing production bucket is therefore a refusal rather than an
 * ephemeral archive inside the app container.
 *
 * **What is NOT symmetric with the media adapter, deliberately.** The media
 * bucket is configured with `disablePayloadAccessControl`, i.e. the file's URL
 * IS the public bucket URL and the app never sees the request. Nothing here may
 * ever do that. This adapter hands out bytes to a caller that has already
 * passed the EARS-523 gate; it produces no URL, signed or otherwise, and there
 * is no code path that turns a `storage_key` into an address a browser could
 * follow. A pre-signed URL would be a public URL with an expiry, and EARS-523
 * says «no public or unauthenticated URL to a document shall exist» without an
 * expiry clause.
 *
 * **Three refusals rather than three silent degradations.** Pointing document
 * storage at the PUBLIC media bucket, naming a bucket without credentials, and
 * a key that escapes the configured root are each a refusal, because each of
 * them otherwise looks like it worked: the files land somewhere readable, or
 * they land on the disk of a machine the operator believes is talking to S3, or
 * they land outside the archive entirely.
 *
 * The prod bucket itself is not created here — Terraform is centralized in the
 * `bbm` ops repo (ADR-002 §2), tracked as `sidorovanthon/bbm#172`. This module
 * must not ship until it exists.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { FinanceRefusal } from '../core/errors'

/** Where the disk fallback keeps the archive when nothing names a directory. */
export const FINANCE_DOCUMENTS_DEFAULT_DIR = '.finance-documents'

/**
 * The environment as this file reads it — passed in rather than reached for, so
 * the decision is a pure function a unit test can put through every branch.
 */
export type FinanceDocumentStorageEnv = {
  NODE_ENV?: string
  FINANCE_DOCUMENTS_S3_BUCKET?: string
  FINANCE_DOCUMENTS_S3_ENDPOINT?: string
  FINANCE_DOCUMENTS_S3_REGION?: string
  FINANCE_DOCUMENTS_S3_ACCESS_KEY_ID?: string
  FINANCE_DOCUMENTS_S3_SECRET_ACCESS_KEY?: string
  FINANCE_DOCUMENTS_DIR?: string
  /** The PUBLIC media bucket (`src/payload.config.ts`) — read only to refuse it. */
  S3_BUCKET?: string
}

/**
 * The archive as the module uses it. Three verbs and no fourth: there is no
 * `move`, no `copy` and no `url`, and their absence is EARS-514/516 rather than
 * an unfinished interface.
 */
export type FinanceDocumentStorage = {
  readonly driver: 'local' | 's3'
  /** The bucket, when there is one — for diagnostics and for the tests. */
  readonly bucket: string | null
  /** Writes bytes at `key`. Refuses an OCCUPIED key: a document is never replaced. */
  put(key: string, body: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  /**
   * Removes an object. Only reached after `deleteFinanceDocument` has decided
   * the linked items do not retain it under EARS-516.
   */
  remove(key: string): Promise<void>
}

const trimmed = (value: string | undefined): string => (value ?? '').trim()

/**
 * The object key for a new document.
 *
 * Three properties, each of them load-bearing:
 *
 *  - **the uploader's filename never becomes a path.** It is metadata in the
 *    row; a name that reached the key would carry whatever the person typed —
 *    `../`, a drive letter, a NUL — into a filesystem call;
 *  - **a random UUID**, so keys are not enumerable. Guessing is not supposed to
 *    be the attack that matters (the handler asks EARS-523 before it reads),
 *    but an archive whose keys are `1.pdf`, `2.pdf` makes every future mistake
 *    a total one;
 *  - **the year/month prefix**, so a human looking into the bucket during an
 *    incident can find their bearings, and so a lifecycle rule can ever be
 *    written per period.
 */
export function buildFinanceDocumentStorageKey(filename: string, now: Date = new Date()): string {
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const ext = path.extname(filename).toLowerCase()
  // Only a short, plainly safe extension survives — it is a convenience for
  // whoever opens the bucket, never something the code trusts.
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
  return `finance/documents/${year}/${month}/${randomUUID()}${safeExt}`
}

/**
 * Resolve `key` inside `root`, or refuse.
 *
 * The keys this module generates are safe by construction; this check is for
 * the ones it did not generate — a key read back out of the database, a key
 * from a future importer. `..` in a storage key is the one bug in this file
 * that would let a caller read `/etc/passwd` through an authorized handler.
 */
function resolveInsideRoot(root: string, key: string): string {
  const absoluteRoot = path.resolve(root)
  const target = path.resolve(absoluteRoot, key)
  const relative = path.relative(absoluteRoot, target)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FinanceRefusal(
      `Ключ хранения «${key}» ведёт за пределы архива финансовых документов. ` +
        'Ключ — это путь, а путь наружу из корня архива не бывает опечаткой.',
    )
  }
  return target
}

function localStorage(dir: string): FinanceDocumentStorage {
  return {
    driver: 'local',
    bucket: null,
    async put(key, body) {
      const target = resolveInsideRoot(dir, key)
      await mkdir(path.dirname(target), { recursive: true })
      // `wx` — fail if it exists. A document is never replaced (EARS-516), and
      // the flag is what makes that true against a racing second writer rather
      // than only against a caller that remembered to check.
      await writeFile(target, body, { flag: 'wx' })
    },
    async get(key) {
      return readFile(resolveInsideRoot(dir, key))
    },
    async remove(key) {
      await rm(resolveInsideRoot(dir, key), { force: true })
    },
  }
}

/**
 * The S3 client, imported lazily.
 *
 * `@aws-sdk/client-s3` is a heavy dependency and a dev stand never touches it —
 * a top-level import would put the whole SDK into every bundle that reaches
 * this module, to serve a branch that is off by default. The import is also the
 * one place that would fail loudly if the dependency went missing, which is
 * better than a build that succeeds and a bucket that is never written.
 */
async function s3Client(config: {
  endpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}) {
  const { S3Client } = await import('@aws-sdk/client-s3')
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    // Timeweb addresses buckets by path, not by virtual-host subdomain — the
    // same setting the media adapter carries in `src/payload.config.ts`.
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  })
}

function s3Storage(config: {
  bucket: string
  endpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}): FinanceDocumentStorage {
  return {
    driver: 's3',
    bucket: config.bucket,
    async put(key, body) {
      const client = await s3Client(config)
      const { PutObjectCommand } = await import('@aws-sdk/client-s3')
      try {
        // `If-None-Match: *` is the S3 equivalent of local `wx`: the create and
        // the occupied-key check are one operation, so racing writers cannot
        // both pass a preceding HEAD and then overwrite each other.
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ACL: 'private',
            IfNoneMatch: '*',
          }),
        )
      } catch (cause) {
        const status = (cause as { $metadata?: { httpStatusCode?: number } })?.$metadata
          ?.httpStatusCode
        if (status === 409 || status === 412) {
          throw new FinanceRefusal(
            `Объект «${key}» в архиве уже существует. Документ не заменяется — ` +
              'исправление неверного документа это прикрепление другого (EARS-516).',
          )
        }
        throw cause
      }
    },
    async get(key) {
      const client = await s3Client(config)
      const { GetObjectCommand } = await import('@aws-sdk/client-s3')
      const answer = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
      const bytes = await answer.Body?.transformToByteArray()
      if (bytes === undefined) {
        throw new FinanceRefusal(`Объект «${key}» в приватном архиве пуст или недоступен.`)
      }
      return Buffer.from(bytes)
    },
    async remove(key) {
      const client = await s3Client(config)
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
    },
  }
}

/**
 * Which archive this process is talking to (EARS-514).
 *
 * Pure with respect to its argument, so every branch — including the three
 * refusals — is a unit test rather than an environment somebody has to
 * reproduce.
 */
export function resolveFinanceDocumentStorage(
  env: FinanceDocumentStorageEnv = process.env as FinanceDocumentStorageEnv,
): FinanceDocumentStorage {
  const bucket = trimmed(env.FINANCE_DOCUMENTS_S3_BUCKET)
  if (bucket === '') {
    if (trimmed(env.NODE_ENV) === 'production') {
      throw new FinanceRefusal(
        'FINANCE_DOCUMENTS_S3_BUCKET обязателен в production: локальный архив допустим только в dev/CI ' +
          '(EARS-514; приватный бакет — sidorovanthon/bbm#172).',
      )
    }
    // The acceptance criterion of #382: a dev stand with no bucket works.
    return localStorage(trimmed(env.FINANCE_DOCUMENTS_DIR) || FINANCE_DOCUMENTS_DEFAULT_DIR)
  }

  const publicBucket = trimmed(env.S3_BUCKET)
  if (publicBucket !== '' && bucket === publicBucket) {
    throw new FinanceRefusal(
      `FINANCE_DOCUMENTS_S3_BUCKET указывает на «${bucket}» — это ПУБЛИЧНЫЙ бакет медиа ` +
        '(S3_BUCKET, public-read по решению #3). Документы бухгалтерии в нём читает кто угодно ' +
        'по ключу. Нужен отдельный приватный бакет (EARS-514, инфраструктура — sidorovanthon/bbm#172).',
    )
  }

  const accessKeyId = trimmed(env.FINANCE_DOCUMENTS_S3_ACCESS_KEY_ID)
  const secretAccessKey = trimmed(env.FINANCE_DOCUMENTS_S3_SECRET_ACCESS_KEY)
  if (accessKeyId === '' || secretAccessKey === '') {
    throw new FinanceRefusal(
      `Бакет «${bucket}» назван, но FINANCE_DOCUMENTS_S3_ACCESS_KEY_ID / ` +
        'FINANCE_DOCUMENTS_S3_SECRET_ACCESS_KEY пусты. Молча свалиться на локальный диск нельзя: ' +
        'оператор, назвавший бакет, считает, что файлы лежат в нём.',
    )
  }

  return s3Storage({
    bucket,
    endpoint: trimmed(env.FINANCE_DOCUMENTS_S3_ENDPOINT) || undefined,
    region: trimmed(env.FINANCE_DOCUMENTS_S3_REGION) || 'ru-1',
    accessKeyId,
    secretAccessKey,
  })
}
