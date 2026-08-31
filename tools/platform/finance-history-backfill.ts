import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { sql } from 'drizzle-orm'

import {
  applyFinanceHistoryPlan,
  buildFinanceHistoryPlan,
  type ExistingFinanceHistoryOperation,
  type FinanceHistoryMapping,
  type FinanceHistoryPlan,
  type FinanceHistorySnapshot,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { loadMattermostFinanceHistory, readMattermostFileBytes } from './mattermost-finance-history'

type ParsedArgs = {
  command: 'dry-run' | 'apply'
  values: Map<string, string>
}

function usage(): never {
  throw new Error(
    'Usage:\n' +
      '  pnpm platform:finance:history dry-run --mapping <private.json> --output <plan.json> [--fixture <snapshot.json> | --channel <id-or-name>]\n' +
      '  pnpm platform:finance:history apply --plan <plan.json> --digest <sha256:...> --operator-email <member email>',
  )
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv
  if (command !== 'dry-run' && command !== 'apply') usage()
  const values = new Map<string, string>()
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) usage()
    values.set(key.slice(2), value)
  }
  return { command, values }
}

function required(args: ParsedArgs, name: string): string {
  const value = args.values.get(name)?.trim()
  if (!value) throw new Error(`--${name} is required`)
  return value
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(path.resolve(filename), 'utf8')) as T
}

async function existingOperations(): Promise<ExistingFinanceHistoryOperation[]> {
  const result = await getPlatformDb().execute(sql`
    select id, source, source_ref from core.finance_operation
     where source = 'backfill' and source_ref is not null
     order by id
  `)
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    source: String(row.source),
    sourceRef: String(row.source_ref),
  }))
}

async function dryRun(args: ParsedArgs): Promise<void> {
  const mappings = await readJson<FinanceHistoryMapping[]>(required(args, 'mapping'))
  const fixture = args.values.get('fixture')
  const snapshot =
    fixture === undefined
      ? await loadMattermostFinanceHistory({
          databaseUrl: process.env.MATTERMOST_DATABASE_URL?.trim() ?? '',
          filesDir: process.env.MATTERMOST_FILES_DIR?.trim() ?? '',
          channel: args.values.get('channel') ?? 'BBM Финансы',
        })
      : await readJson<FinanceHistorySnapshot>(fixture)
  const plan = buildFinanceHistoryPlan({
    snapshot,
    mappings,
    existingOperations: await existingOperations(),
  })
  const output = path.resolve(required(args, 'output'))
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' })
  process.stdout.write(
    `${JSON.stringify({ mode: 'dry-run', output, planDigest: plan.planDigest, summary: plan.summary }, null, 2)}\n`,
  )
}

async function apply(args: ParsedArgs): Promise<void> {
  const plan = await readJson<FinanceHistoryPlan>(required(args, 'plan'))
  const filesDir = process.env.MATTERMOST_FILES_DIR?.trim() ?? ''
  if (filesDir === '') throw new Error('MATTERMOST_FILES_DIR is required for apply')
  const result = await applyFinanceHistoryPlan(plan, required(args, 'digest'), {
    operatorEmail: required(args, 'operator-email'),
    loadDocumentBytes: (file) => readMattermostFileBytes(filesDir, file),
  })
  process.stdout.write(`${JSON.stringify({ mode: 'apply', ...result }, null, 2)}\n`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  try {
    if (args.command === 'dry-run') await dryRun(args)
    else await apply(args)
  } finally {
    await closePlatformDb()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
