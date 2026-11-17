#!/usr/bin/env node
/**
 * `pnpm platform:finance:fx:sync [--from YYYY-MM-DD] [--to YYYY-MM-DD]` — store
 * the Bank of Russia daily rates (spec `docs/specs/339-ledger-intake.md` §I,
 * EARS-552; issue #548).
 *
 *   pnpm platform:finance:fx:sync                                  # daily: last stored date … today (Moscow)
 *   pnpm platform:finance:fx:sync --from 2026-09-01 --to 2026-11-17  # backfill
 *
 * One command for both the daily run (`deploy/cron/finance-fx-sync.sh`) and a
 * backfill: idempotent by the table's unique key, so a range that overlaps what
 * is stored inserts only what is missing. Writes through the finance module's
 * `syncCbrRates` as `system:finance-fx-sync`. Exit 1 on any failure — cron
 * mails/logs a non-zero run; a partial backfill resumes on re-run.
 */
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { syncCbrRates } from '@/lib/finance'
import { closePlatformDb } from '@/lib/platform/db/client'

import { loadPlatformToolEnv } from './load-env.mjs'

const TAG = 'platform:finance:fx:sync'

export type FxSyncArgs = { from?: string; to?: string }

export function parseFxSyncArgv(argv: readonly string[]): FxSyncArgs {
  const args: FxSyncArgs = {}
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag !== '--from' && flag !== '--to') {
      throw new Error(
        `unknown argument «${flag}» — usage: ${TAG} [--from YYYY-MM-DD] [--to YYYY-MM-DD]`,
      )
    }
    const value = argv[i + 1]
    if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`${flag} needs a date YYYY-MM-DD, got «${value ?? ''}»`)
    }
    args[flag === '--from' ? 'from' : 'to'] = value
    i += 1
  }
  return args
}

async function main(): Promise<void> {
  loadPlatformToolEnv()
  const args = parseFxSyncArgv(process.argv.slice(2))
  console.log(
    `▶ ${TAG}: cbr.ru XML_daily ${args.from ?? '(last stored)'} … ${args.to ?? '(today, Moscow)'}`,
  )
  const summary = await syncCbrRates({
    ...args,
    onDay: ({ date, effectiveDate, quoted, inserted }) =>
      console.log(`  ${date} → effective ${effectiveDate}: ${quoted} quoted, ${inserted} inserted`),
  })
  console.log(
    `✓ ${TAG}: ${summary.from} … ${summary.to}, ${summary.days} day(s) asked, ${summary.inserted} row(s) inserted`,
  )
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = resolve(fileURLToPath(import.meta.url))
if (
  invokedPath &&
  invokedPath === selfPath &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  main()
    .then(() => closePlatformDb())
    .catch(async (err: unknown) => {
      console.error(`✗ ${TAG} FAILED: ${(err as Error)?.message ?? String(err)}`)
      await closePlatformDb().catch(() => undefined)
      process.exit(1)
    })
}
