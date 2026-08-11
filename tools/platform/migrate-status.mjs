#!/usr/bin/env node
// bbm-portal — `pnpm platform:migrate:status`: what would `platform:migrate` do
// next, without doing it (#125).
//
//   pnpm platform:migrate:status
//
// drizzle-kit 0.31 ships `generate`, `migrate`, `check`, `up` and `drop` — there
// is no status command, so this is ours. It reads the journal drizzle-kit writes
// (`meta/_journal.json`) and the rows drizzle wrote into its migrations table,
// and prints the two sets side by side.
//
// The join is on the journal's `when` timestamp: drizzle stores it verbatim in
// `created_at` when it applies a migration, and does NOT store the tag. A row
// whose `created_at` matches no journal entry is reported as an ORPHAN rather
// than ignored — it means the tree and the database disagree about history,
// which is the one thing a status command exists to surface.
//
// The other such disagreement is UNREACHABLE, and it is why this command is not
// merely informational. drizzle applies a migration only when its `folderMillis`
// is STRICTLY NEWER than the newest `created_at` in the ledger, so a migration
// generated in one worktree before — but merged after — one generated in another
// is skipped forever, with `drizzle-kit migrate` exiting 0 the whole time. In a
// repo whose canon opens with «parallel sessions are the norm here», that state
// has to be named rather than shown as an eternally-pending row.
//
// Read-only: it opens a connection and runs one SELECT; nothing here writes. It
// exits 0 on pending migrations (a normal state) and NON-ZERO on UNREACHABLE or
// ORPHAN, where silence would be indistinguishable from "all good".

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { loadDotEnv } from './load-env.mjs'

// These two restate values owned by `src/lib/platform/db/config.ts`, which this
// plain-.mjs tool cannot import. tests/unit/platform-migrate-status.spec.ts
// asserts both sides agree, so the restatement cannot drift silently.
export const MIGRATIONS_DIR = './src/lib/platform/db/migrations'
export const PLATFORM_MIGRATIONS_TABLE_FQN = 'core.__drizzle_migrations'

/**
 * The journal drizzle-kit maintains next to the generated SQL. Missing file ⇒
 * no migrations, not a crash: a tree that has never generated one is a legal
 * state, and `status` is the command you run to find that out.
 */
export function readJournalEntries(dir) {
  const journalPath = resolve(process.cwd(), dir, 'meta', '_journal.json')
  if (!existsSync(journalPath)) return []
  const parsed = JSON.parse(readFileSync(journalPath, 'utf8'))
  return Array.isArray(parsed?.entries) ? parsed.entries : []
}

/**
 * Compare the journal with the rows in the migrations table. Pure.
 *
 * @param entries    journal entries, in `idx` order
 * @param appliedWhen  `created_at` values read from the migrations table
 */
export function formatMigrationStatus({ entries, appliedWhen }) {
  const applied = []
  const pending = []
  const unreachable = []
  const lines = []
  const appliedSet = new Set((appliedWhen ?? []).map(Number))
  const explained = new Set()

  // drizzle's migrator applies a migration only when
  // `Number(lastDbMigration.created_at) < migration.folderMillis`, so this
  // watermark is the cut-off: an unapplied migration at or below it will NEVER
  // be applied, however many times `platform:migrate` runs.
  const watermark = appliedSet.size ? Math.max(...appliedSet) : null

  for (const entry of entries ?? []) {
    const when = Number(entry.when)
    if (appliedSet.has(when)) {
      explained.add(when)
      applied.push(entry.tag)
      // `created_at` holds folderMillis — when the migration was GENERATED.
      // drizzle records no apply time, so the label must not imply one.
      lines.push(`  ✓ ${entry.tag} — applied (migration ts ${new Date(when).toISOString()})`)
    } else if (watermark !== null && when <= watermark) {
      unreachable.push(entry.tag)
      lines.push(
        `  ✗ ${entry.tag} — UNREACHABLE: generated ${new Date(when).toISOString()}, which is not ` +
          `newer than the newest applied migration (${new Date(watermark).toISOString()}). ` +
          'drizzle applies strictly-newer migrations only, so this will never run — regenerate ' +
          'it on top of current HEAD instead of re-merging it (parallel worktrees, ' +
          '.claude/rules/parallel-sessions.md).',
      )
    } else {
      pending.push(entry.tag)
      lines.push(`  · ${entry.tag} — PENDING`)
    }
  }

  const orphans = [...appliedSet].filter((when) => !explained.has(when)).sort((a, b) => a - b)
  for (const when of orphans) {
    lines.push(
      `  ! ORPHAN — ${PLATFORM_MIGRATIONS_TABLE_FQN} records a migration applied at ` +
        `${new Date(when).toISOString()} that no journal entry explains`,
    )
  }

  return { total: (entries ?? []).length, applied, pending, unreachable, orphans, lines }
}

/**
 * The command's exit code. Pure.
 *
 * A pending migration is a normal state and exits 0. An UNREACHABLE one and an
 * ORPHAN row are not states — they are the tree and the database disagreeing
 * about history, in a way that `platform:migrate` reports as success because it
 * genuinely has nothing left it is willing to do. Exiting 0 on those would make
 * this command's silence indistinguishable from "all good", which is the whole
 * failure mode it exists to break.
 */
export function statusExitCode({ unreachable, orphans } = {}) {
  return (unreachable?.length ?? 0) + (orphans?.length ?? 0) > 0 ? 1 : 0
}

// ── the live half ────────────────────────────────────────────────────────────

/**
 * Read the applied timestamps. A missing table (SQLSTATE 42P01) is the normal
 * "never migrated" state — reported as an empty set, not as an error, so the
 * first thing a fresh database prints is a full pending list.
 */
export async function readAppliedWhen(client) {
  try {
    const { rows } = await client.query(
      `SELECT created_at FROM ${PLATFORM_MIGRATIONS_TABLE_FQN} ORDER BY created_at`,
    )
    return rows.map((r) => Number(r.created_at))
  } catch (err) {
    if (err?.code === '42P01') return []
    throw err
  }
}

async function main() {
  // `.env` first, the environment wins (see ./load-env.mjs).
  loadDotEnv()
  const connectionString = process.env.PLATFORM_DATABASE_URL?.trim()
  if (!connectionString) {
    console.error(
      '\n✗ platform:migrate:status FAILED: PLATFORM_DATABASE_URL is not set.\n' +
        "  The platform database is SEPARATE from Payload's `cms` and has no fallback —\n" +
        '  see deploy/README.md and .env.example.',
    )
    process.exit(1)
  }

  const entries = readJournalEntries(MIGRATIONS_DIR)
  const { Client } = await import('pg')
  const client = new Client({ connectionString })
  await client.connect()
  let appliedWhen
  try {
    appliedWhen = await readAppliedWhen(client)
  } finally {
    await client.end()
  }

  const status = formatMigrationStatus({ entries, appliedWhen })
  console.log(`\n▶ platform migrations (${PLATFORM_MIGRATIONS_TABLE_FQN})`)
  if (status.lines.length === 0) console.log('  (none generated yet)')
  else for (const line of status.lines) console.log(line)
  console.log(
    `\n  ${status.applied.length} applied · ${status.pending.length} pending` +
      (status.unreachable.length ? ` · ${status.unreachable.length} UNREACHABLE` : '') +
      (status.orphans.length ? ` · ${status.orphans.length} ORPHAN` : ''),
  )
  process.exitCode = statusExitCode(status)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = resolve(fileURLToPath(import.meta.url))
if (
  invokedPath &&
  invokedPath === selfPath &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  main().catch((err) => {
    console.error(`\n✗ platform:migrate:status FAILED: ${err?.message ?? String(err)}`)
    process.exit(1)
  })
}
