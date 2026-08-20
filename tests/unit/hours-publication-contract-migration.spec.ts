import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The CONTRACT half of spec 201 EARS-31 as a tested artifact (#281, migration
 * `0005_hours_publication_drop_messages.sql`).
 *
 * Everything about the contract release that CAN be asserted against the
 * migrated database is asserted there — `tests/int/platform/hours-core.int.spec.ts`
 * reads the column list back out of `information_schema`, and
 * `tests/int/platform/audit-coverage.int.spec.ts` pins that
 * `core.hours_publication.messages` is gone while the allowlist entry EARS-33
 * owns stays until #275.
 *
 * What the integration tier structurally CANNOT reach is the inside of this
 * migration. Its first statement re-runs the #274 backfill, and that statement
 * only has anything to read while the `jsonb` column still exists — i.e. for the
 * few milliseconds between the two statements of this one file. By the time any
 * test connects, the column is gone and the re-run is unobservable. So the two
 * properties issue #281 states as acceptance criteria are pinned HERE, on the
 * file's text:
 *
 *  1. **The re-run is the SHIPPED statement, not a re-typed copy.** It is
 *     compared byte-for-byte with the block `0004_hours_publication_message.sql`
 *     carries between its `-- >>> backfill` markers — the same statement
 *     `tests/int/platform/hours-publication-message.int.spec.ts` proves correct,
 *     idempotent and reconciling against a real database. A copy that drifted by
 *     one column would be a silent data loss in exactly the window nobody can
 *     observe.
 *  2. **The re-run PRECEDES the `DROP COLUMN`.** In the other order the re-run
 *     reads a column that no longer exists and the migration simply fails; that
 *     is the benign outcome. The order is pinned because the statement's whole
 *     purpose is the app-rollback window between the two releases
 *     (`docs/runbooks/migrations-expand-contract.md`): a rolled-back app writes
 *     the `jsonb` array ONLY, and whatever it recorded there must be reconciled
 *     into the child table before the array is destroyed.
 */

const migrationsDir = resolve(process.cwd(), 'src/lib/platform/db/migrations')

/**
 * `.sql` is not in `.gitattributes`' `eol=lf` list, so a Windows checkout hands
 * these files back with CRLF and a Linux one with LF. The comparison below is
 * about the STATEMENT, never about which machine checked the repo out, so both
 * sides are normalised before anything is matched.
 */
const readSql = (name: string) =>
  readFileSync(resolve(migrationsDir, name), 'utf8').replaceAll('\r\n', '\n')

const expand = readSql('0004_hours_publication_message.sql')
const contract = readSql('0005_hours_publication_drop_messages.sql')

/** The statement between the markers both migrations carry. */
function backfillStatement(sqlText: string, file: string): string {
  const match = /-- >>> backfill\n([\s\S]*?)\n-- <<< backfill/.exec(sqlText)
  if (!match) throw new Error(`no backfill markers in ${file}`)
  return match[1]
}

describe('0005_hours_publication_drop_messages.sql — the contract release (#281)', () => {
  it('re-runs the backfill statement of 0004 verbatim, not a re-typed copy of it', () => {
    expect(backfillStatement(contract, '0005')).toBe(backfillStatement(expand, '0004'))
  })

  it('drops core.hours_publication.messages', () => {
    expect(contract).toMatch(/ALTER TABLE "core"\."hours_publication" DROP COLUMN "messages"/)
  })

  it('re-runs the backfill BEFORE the drop, in that order, in the one file', () => {
    const backfillAt = contract.indexOf('-- >>> backfill')
    const dropAt = contract.search(/ALTER TABLE "core"\."hours_publication" DROP COLUMN "messages"/)

    expect(backfillAt).toBeGreaterThan(-1)
    expect(dropAt).toBeGreaterThan(-1)
    expect(backfillAt).toBeLessThan(dropAt)
  })

  it('is registered in the drizzle journal after 0004', () => {
    const journal = JSON.parse(
      readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> }

    const expandEntry = journal.entries.find((e) => e.tag === '0004_hours_publication_message')
    const contractEntry = journal.entries.find(
      (e) => e.tag === '0005_hours_publication_drop_messages',
    )

    expect(expandEntry).toBeDefined()
    expect(contractEntry).toBeDefined()
    expect(contractEntry!.idx).toBeGreaterThan(expandEntry!.idx)
  })
})
