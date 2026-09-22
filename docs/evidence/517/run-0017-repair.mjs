/**
 * Re-runs migration `0017`'s repair block against the branch database.
 *
 * The migration itself had already been applied when the 47 corpus rows were
 * loaded, so the acceptance stand needs the same block run once more. It is
 * lifted VERBATIM out of the committed SQL rather than retyped — the same
 * thing `tests/int/platform/finance-intake-provenance.int.spec.ts` does — and
 * the block is idempotent by construction: it selects on a `source_system=`
 * line inside `note`, which its own first pass removes.
 */
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

process.loadEnvFile('.env')
const url = process.env.PLATFORM_DATABASE_URL ?? ''
if (!/\/platform_\d+(\?|$)/.test(url)) {
  throw new Error('refusing: PLATFORM_DATABASE_URL must name a branch database platform_<N>')
}

const MARKER = 'DO $intake_provenance_repair$'
const sql = readFileSync(
  'src/lib/platform/db/migrations/0017_finance_intake_provenance.sql',
  'utf8',
)
const start = sql.indexOf(MARKER)
const end = sql.indexOf('$intake_provenance_repair$;', start)
if (start === -1 || end === -1) throw new Error('repair block not found in 0017')

const db = new Client({ connectionString: url })
await db.connect()
db.on('notice', (notice) => console.log(notice.message))
await db.query(sql.slice(start, end + MARKER.length - 'DO '.length))
await db.end()
