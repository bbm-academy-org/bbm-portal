#!/usr/bin/env node
/**
 * `pnpm platform:hours:verify <hours.json>` — the export-diff verdict (spec 124
 * EARS-26, EARS-27).
 *
 *   pnpm platform:hours:verify /data/hours/hours.json.2026-08-18
 *
 * Asks one question and prints one verdict line: is what `core` would export
 * today still, byte for byte, the document that was imported? It answered it in
 * the dev rehearsal (EARS-26), right after the production import inside the
 * 2026-08-18 window, and it stays as the spot-check against the ARCHIVED
 * document on the volume (`hours.json.<date>`, EARS-15).
 *
 * The import side is gone: #256 removed `platform:hours:import` after the owner's
 * acceptance, because a second import is never wanted — `core` is the master now
 * and re-running an import over live rows is the one operation in this pipeline
 * that could destroy real history. What remains is read-only on BOTH sides: the
 * archive is only ever read (`./hours-json.ts`, EARS-16) and `core` is only ever
 * exported.
 *
 * Exit code follows the verdict — 0 identical, 1 differs — so a script can gate
 * on it.
 */
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { readHoursDocument as readCoreDocument } from '@/lib/hours'
import { closePlatformDb } from '@/lib/platform/db/client'

import { compareExports, verdictLines, type ExportComparison } from './hours-export-diff'
import { readJsonDocument } from './hours-json'
import { loadPlatformToolEnv } from './load-env.mjs'

const TAG = 'platform:hours:verify'

export type VerifyOutcome = {
  comparison: ExportComparison
  lines: string[]
}

/**
 * The verdict against whatever `core` currently holds (EARS-26, EARS-27).
 *
 * The `core` side is read through the module's own public read path, so this
 * internal migration check reconstitutes the archived document without
 * exposing a user download route or querying the tables through a second path.
 */
export async function verifyHours(file: string): Promise<VerifyOutcome> {
  const source = await readJsonDocument(file)
  const core = await readCoreDocument()
  const comparison = compareExports(source, core)
  return { comparison, lines: verdictLines(comparison) }
}

export function parseArgv(argv: string[], usage: string): string {
  const files = argv.filter((arg) => arg !== '' && !arg.startsWith('--'))
  if (files.length !== 1) throw new Error(usage)
  return resolve(files[0])
}

async function main(): Promise<void> {
  loadPlatformToolEnv()
  const file = parseArgv(process.argv.slice(2), 'usage: pnpm platform:hours:verify <hours.json>')
  console.log(`\n▶ ${TAG}: ${file} vs core.hours_*`)

  const outcome = await verifyHours(file)
  for (const line of outcome.lines) console.log(line)
  console.log('')
  if (!outcome.comparison.identical) process.exitCode = 1
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
