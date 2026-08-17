#!/usr/bin/env node
/**
 * `pnpm platform:hours:verify <hours.json>` — the export-diff verdict on its own
 * (spec 124 EARS-26, EARS-27).
 *
 *   pnpm platform:hours:verify /srv/bbm/data/hours.json
 *
 * Same verdict `platform:hours:import` ends with, asked separately: in the dev
 * rehearsal (EARS-26), right after the production import, and as a later
 * spot-check. Re-running the import to get the answer is not an option — it
 * refuses non-empty hours tables by design (EARS-13).
 *
 * Read-only on both sides: the source file is only read (EARS-16) and `core` is
 * only exported. Exit code follows the verdict — 0 identical, 1 differs — so a
 * deploy script can gate on it.
 *
 * The logic lives in `./hours-import.ts` (`verifyHours`); this file is the second
 * entry point onto it, nothing more.
 */
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { closePlatformDb } from '@/lib/platform/db/client'

import { parseArgv, verifyHours } from './hours-import'
import { loadPlatformToolEnv } from './load-env.mjs'

const TAG = 'platform:hours:verify'

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
