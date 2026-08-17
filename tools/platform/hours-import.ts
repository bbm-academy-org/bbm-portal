#!/usr/bin/env node
/**
 * `pnpm platform:hours:import <hours.json>` — the cutover import and its verdict
 * (spec 124 EARS-13, EARS-16, EARS-27; runbook
 * `docs/runbooks/hours-core-cutover.md`).
 *
 *   pnpm platform:member:seed  /srv/bbm/cutover/members.json   # FIRST (EARS-14)
 *   pnpm platform:hours:import /srv/bbm/data/hours.json        # then this
 *   pnpm platform:hours:verify /srv/bbm/data/hours.json        # the verdict alone
 *
 * What it does, in order:
 *
 *  1. reads the production document THROUGH THE FROZEN JSON STORE
 *     (`src/lib/hours/store.ts`) — the same parser, the same normalization
 *     (`lower(btrim(email))` on every participant and assessment email) and the
 *     same refusals the running app has always applied to that file. Re-parsing it
 *     here with `JSON.parse` would import a document the app never had;
 *  2. writes it into the `core` tables in ONE transaction that first takes the
 *     module advisory lock (EARS-10/EARS-13) — refusing outright if any `hours_*`
 *     table already holds a row, and aborting with the list of emails that have no
 *     seeded `member`;
 *  3. exports the result back out of `core` and prints ONE verdict line comparing
 *     it with the pre-import export (EARS-27). Exit code follows the verdict.
 *
 * The source file is never opened for writing, at any point (EARS-16) — the JSON
 * store's mutation path is not called here at all. That is what keeps the rollback
 * of EARS-25 warm: until the owner accepts the stand, redeploying the previous
 * image must find the file exactly as it was.
 *
 * A DIFFERING verdict does not undo the import — the rows are committed and the
 * documented answer is the truncate-and-retry of the runbook, inside the window.
 * That asymmetry is deliberate: an automatic truncate is the one operation in this
 * pipeline that could delete real history on a typo.
 */
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { readHoursDocument as readCoreDocument } from '@/lib/hours'
import type { HoursDocument } from '@/lib/hours'
import { importDocument, type HoursRowCounts } from '@/lib/hours/core/import'
import { HOURS_LOCK_KEY } from '@/lib/hours/core/lock'
import { takeHoursLock } from '@/lib/hours/core/persist'
// The frozen JSON store, imported directly and on purpose: it is no longer part of
// the module's public surface (EARS-12 — the app has no JSON fallback), and this
// tool is the last reader it has left before #256 deletes it (EARS-15).
import { readHoursDocument as readJsonDocument } from '@/lib/hours/store'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { compareExports, verdictLines, type ExportComparison } from './hours-export-diff'
import { loadPlatformToolEnv } from './load-env.mjs'

const TAG = 'platform:hours:import'

export type ImportOutcome = {
  summary: HoursRowCounts
  comparison: ExportComparison
  /** The verdict as printed — first line is the verdict itself (EARS-27). */
  lines: string[]
}

export type VerifyOutcome = {
  comparison: ExportComparison
  lines: string[]
}

/**
 * Read the source document through the frozen JSON store (EARS-13, EARS-16).
 *
 * `HOURS_DATA_FILE` is how that store learns its path, and it reads the variable
 * per call (`resolveDataFile`) — so it is set around this one call and restored
 * afterwards rather than exported process-wide, which would leave a stray path
 * behind for anything else in the process (the int specs run several of these in
 * one worker).
 *
 * Read-only by construction: only the store's reader is called, never its
 * mutation path.
 */
export async function readSourceDocument(file: string): Promise<HoursDocument> {
  const previous = process.env.HOURS_DATA_FILE
  process.env.HOURS_DATA_FILE = resolve(file)
  try {
    return await readJsonDocument()
  } finally {
    if (previous === undefined) delete process.env.HOURS_DATA_FILE
    else process.env.HOURS_DATA_FILE = previous
  }
}

/**
 * Import the document and produce the verdict (EARS-13, EARS-27).
 *
 * The post-import export is read AFTER the transaction commits, deliberately:
 * EARS-27's question is «what would the owner download now», and the only honest
 * answer comes from the same read path `/p/hours/admin/export` uses, on committed
 * data.
 */
export async function importHours(file: string): Promise<ImportOutcome> {
  const source = await readSourceDocument(file)
  const db = getPlatformDb()

  const summary = await db.transaction(async (tx) => {
    await takeHoursLock(tx, HOURS_LOCK_KEY)
    return importDocument(tx, source)
  })

  const core = await readCoreDocument()
  const comparison = compareExports(source, core)
  return { summary, comparison, lines: verdictLines(comparison) }
}

/**
 * The verdict alone, against whatever `core` currently holds (EARS-26, EARS-27).
 *
 * Its own command because the rehearsal, the post-import check and a later
 * spot-check are the same question asked at three different times, and re-running
 * an import to answer it is not an option: the import refuses non-empty tables,
 * which is exactly right and exactly why the verdict has to be separable.
 */
export async function verifyHours(file: string): Promise<VerifyOutcome> {
  const source = await readSourceDocument(file)
  const core = await readCoreDocument()
  const comparison = compareExports(source, core)
  return { comparison, lines: verdictLines(comparison) }
}

export function summaryLines(summary: HoursRowCounts): string[] {
  return [
    `  core.hours_period      ${summary.periods} row(s)`,
    `  core.hours_participant ${summary.participants} row(s)`,
    `  core.hours_assessment  ${summary.assessments} row(s)`,
    `  core.hours_publication ${summary.publications} row(s)`,
  ]
}

export function parseArgv(argv: string[], usage: string): string {
  const files = argv.filter((arg) => arg !== '' && !arg.startsWith('--'))
  if (files.length !== 1) throw new Error(usage)
  return resolve(files[0])
}

async function main(): Promise<void> {
  loadPlatformToolEnv()
  const file = parseArgv(process.argv.slice(2), 'usage: pnpm platform:hours:import <hours.json>')
  console.log(`\n▶ ${TAG}: ${file}`)

  const outcome = await importHours(file)
  for (const line of summaryLines(outcome.summary)) console.log(line)
  console.log('')
  for (const line of outcome.lines) console.log(line)
  if (!outcome.comparison.identical) {
    console.error(
      `\n✗ ${TAG}: the post-import export is NOT the pre-import export. The rows ARE committed;\n` +
        '  the documented answer is the truncate-and-retry of docs/runbooks/hours-core-cutover.md,\n' +
        '  valid only inside the maintenance window. The source hours.json is untouched (EARS-16).',
    )
    process.exitCode = 1
    return
  }
  console.log('')
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
      console.error(`\n✗ ${TAG} FAILED: ${(err as Error)?.message ?? String(err)}`)
      await closePlatformDb().catch(() => undefined)
      process.exit(1)
    })
}
