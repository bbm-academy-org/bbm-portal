/**
 * Loads the 47 reconstructed Mattermost requests into a BRANCH database, as a
 * stand for the #517 acceptance run. Read-only against production: the rows
 * were exported once with `psql -At -c "select json_agg(…)"` over an ssh
 * session and this script only writes to `PLATFORM_DATABASE_URL`, which the
 * guard below refuses unless it names `platform_<N>`.
 *
 * References are matched BY NAME and created when missing — the branch DB's
 * ids are its own. The rows go in with `source_ref` null and `note` verbatim,
 * exactly as production holds them, so the migration's repair has the same
 * input here that it will have there.
 *
 * Usage: node docs/evidence/517/load-prod-corpus.mjs <rows.json>
 */
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

process.loadEnvFile('.env')
const url = process.env.PLATFORM_DATABASE_URL ?? ''
if (!/\/platform_\d+(\?|$)/.test(url)) {
  throw new Error('refusing: PLATFORM_DATABASE_URL must name a branch database platform_<N>')
}

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const db = new Client({ connectionString: url })
await db.connect()

const cache = new Map()
async function ref(table, name, insert) {
  if (name === null || name === undefined) return null
  const key = `${table}:${name}`
  if (cache.has(key)) return cache.get(key)
  const found = await db.query(`select id from core.${table} where name = $1`, [name])
  const id = found.rows[0]?.id ?? (await insert(name))
  cache.set(key, id)
  return id
}

async function member(name) {
  return ref('member', name, async (value) => {
    const slug = `corpus-${cache.size}-${Date.now()}`
    const { rows: r } = await db.query(
      `insert into core.member (slug, email, name) values ($1, $2, $3) returning id`,
      [slug, `${slug}@example.invalid`, value],
    )
    return r[0].id
  })
}

await db.query(`set local role none`).catch(() => {})
await db.query('begin')
// The capture trigger refuses a write with no actor context (spec 201
// EARS-26), and the stamping trigger would overwrite `created_at`. This is a
// fixture load, not an application write.
await db.query(`select set_config('app.actor_email', 'corpus-loader@example.invalid', true),
                       set_config('app.source', 'cli:517-corpus', true)`)
await db.query('alter table core.finance_intake_item disable trigger user')

// The corpus keeps its PRODUCTION ids — the acceptance criterion of #517 names
// «request 6 (Higgsfield)» — so the seeded requests of `pnpm dev:seed` make
// room for it. Only the intake tier is cleared: the reference catalogues, the
// ledger operations and the members the seed created all stay.
await db.query('delete from core.finance_document_link')
await db.query('delete from core.finance_purpose_proposal')
await db.query('delete from core.finance_intake_item')

let loaded = 0
for (const row of rows) {
  const projectId = await ref('finance_project', row.project_name, async (name) => {
    const { rows: r } = await db.query(
      `insert into core.finance_project (name) values ($1) returning id`,
      [name],
    )
    return r[0].id
  })
  const productId = await ref('finance_product', row.product_name, async (name) => {
    const { rows: r } = await db.query(
      `insert into core.finance_product (name, project_id) values ($1, $2) returning id`,
      [name, projectId],
    )
    return r[0].id
  })
  const purposeId = await ref('finance_purpose', row.purpose_name, async (name) => {
    const { rows: r } = await db.query(
      `insert into core.finance_purpose (name, product_binding) values ($1, 'optional') returning id`,
      [name],
    )
    return r[0].id
  })
  const createdBy = await member(row.created_by_name)
  const counterpartyId = await ref('finance_counterparty', row.counterparty_name, async (name) => {
    const { rows: r } = await db.query(
      `insert into core.finance_counterparty (name, created_by) values ($1, $2) returning id`,
      [name, createdBy],
    )
    return r[0].id
  })
  const memberId = row.member_name === null ? null : await member(row.member_name)
  await db.query(
    `insert into core.finance_intake_item
       (id, source, kind, status, occurred_on, amount, currency, paid_amount, paid_currency,
        fee_amount, fee_currency, purpose_id, project_id, product_id, counterparty_id,
        member_id, note, already_paid, personal_funds, refusal_reason,
        decided_by, decided_at, created_by, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23, timestamptz '2026-09-20 11:00:00+00', timestamptz '2026-09-20 11:00:00+00')
     on conflict (id) do nothing`,
    [
      row.id,
      row.source,
      row.kind,
      row.status,
      row.occurred_on,
      row.amount,
      row.currency,
      row.paid_amount,
      row.paid_currency,
      row.fee_amount,
      row.fee_currency,
      purposeId,
      projectId,
      productId,
      counterpartyId,
      memberId,
      row.note,
      row.already_paid,
      row.personal_funds,
      row.refusal_reason,
      row.decided_at === null ? null : createdBy,
      row.decided_at,
      createdBy,
    ],
  )
  loaded += 1
}

await db.query('alter table core.finance_intake_item enable trigger user')
await db.query(`select setval(pg_get_serial_sequence('core.finance_intake_item','id'),
                              (select max(id) from core.finance_intake_item))`)
await db.query('commit')
console.log(`loaded ${loaded} corpus rows`)
await db.end()
