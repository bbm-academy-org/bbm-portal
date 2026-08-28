import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migrationsDir = resolve(process.cwd(), 'src/lib/platform/db/migrations')
const readSql = (name: string) =>
  readFileSync(resolve(migrationsDir, name), 'utf8').replaceAll('\r\n', '\n')

describe('0012_finance_document_content_digest.sql — the recovery identity migration (#382)', () => {
  it('marks old rows unverified, then removes that default before any new write', () => {
    const migration = readSql('0012_finance_document_content_digest.sql')
    const addAt = migration.indexOf(
      `ADD COLUMN "content_digest" text DEFAULT 'legacy-unverified' NOT NULL`,
    )
    const dropDefaultAt = migration.indexOf(`ALTER COLUMN "content_digest" DROP DEFAULT`)

    expect(addAt).toBeGreaterThan(-1)
    expect(dropDefaultAt).toBeGreaterThan(addAt)
    expect(migration).toContain(`content_digest = 'legacy-unverified'`)
    expect(migration).toMatch(/NEW\.content_digest IS DISTINCT FROM OLD\.content_digest/)
    expect(migration).toMatch(/audit_row_change[\s\S]*'content_digest'/)
  })

  it('is registered after the lifecycle migration', () => {
    const journal = JSON.parse(
      readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> }
    const lifecycle = journal.entries.find(
      (entry) => entry.tag === '0011_finance_document_lifecycle',
    )
    const digest = journal.entries.find(
      (entry) => entry.tag === '0012_finance_document_content_digest',
    )

    expect(lifecycle).toBeDefined()
    expect(digest).toBeDefined()
    expect(digest!.idx).toBeGreaterThan(lifecycle!.idx)
  })
})
