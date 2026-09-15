import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migrationsDir = resolve(process.cwd(), 'src/lib/platform/db/migrations')

describe('0014_finance_document_link_insert_guard.sql (#416)', () => {
  it('registers a new migration after finance reference proposals', () => {
    const journal = JSON.parse(
      readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> }

    // Its POSITION, not «it is last»: the journal grows, and this migration's
    // identity is that it follows 0013, not that nothing follows it.
    expect(journal.entries[14]).toMatchObject({
      idx: 14,
      tag: '0014_finance_document_link_insert_guard',
    })
    expect(journal.entries[13]?.tag).toBe('0013_finance_reference_proposals')
  })

  it('guards link INSERT as well as UPDATE and DELETE against terminal intake items', () => {
    const migration = readFileSync(
      resolve(migrationsDir, '0014_finance_document_link_insert_guard.sql'),
      'utf8',
    )

    expect(migration).toMatch(/BEFORE INSERT OR UPDATE OR DELETE/i)
    expect(migration).toMatch(/TG_OP = 'INSERT'/)
    expect(migration).toMatch(/NEW\.intake_item_id/)
    expect(migration).toMatch(/'posted', 'refused', 'cancelled'/)
    expect(migration).toMatch(/EARS-516/)
  })
})
