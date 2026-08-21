#!/usr/bin/env node
// bbm-portal — per-worktree platform database bootstrap (#200).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  PLATFORM_DATABASE,
  assertDroppableBranchDatabaseName,
  deriveMaintenanceTarget,
  dropBranchDatabase,
  ensureDatabase,
  formatDropOutcome,
  formatEnsureOutcome,
} from './ensure-database.mjs'
import { loadPlatformToolEnv } from './load-env.mjs'
import { PLATFORM_MIGRATE_DATABASE_URL_VAR, resolveMigrateDatabaseUrl } from './platform-config.mjs'

export { PLATFORM_MIGRATE_DATABASE_URL_VAR }
export const PLATFORM_DATABASE_URL_VAR = 'PLATFORM_DATABASE_URL'
export const TASK_ID_RE = /^[1-9][0-9]*$/

export function branchDatabaseName(taskId) {
  const task = String(taskId ?? '').trim()
  if (!TASK_ID_RE.test(task)) {
    throw new Error('a numeric positive task worktree id is required')
  }
  return `${PLATFORM_DATABASE}_${task}`
}

export function taskIdFromWorktreePath(cwd = process.cwd()) {
  const normalized = String(cwd).replace(/\\/g, '/')
  const match = /(?:^|\/)\.claude\/worktrees\/([1-9][0-9]*)(?:\/|$)/.exec(normalized)
  if (match) return match[1]

  const leaf = basename(normalized)
  return TASK_ID_RE.test(leaf) ? leaf : null
}

export function formatBranchDatabaseUrl(baseConnectionString, taskId) {
  const database = branchDatabaseName(taskId)
  const base = deriveMaintenanceTarget(baseConnectionString)
  if (!base.ok) throw new Error(base.error)

  const normalizedBase = base.database.toLowerCase()
  if (normalizedBase !== PLATFORM_DATABASE && normalizedBase !== database) {
    throw new Error(
      `refusing to derive ${database} from ${base.database}: ` +
        `the base ${PLATFORM_DATABASE_URL_VAR} must point at ${PLATFORM_DATABASE} ` +
        `or this same branch database`,
    )
  }

  const url = new URL(String(baseConnectionString).trim())
  url.pathname = `/${database}`
  return url.toString()
}

export function deriveBranchMaintenanceTarget(baseConnectionString, taskId) {
  return deriveMaintenanceTarget(formatBranchDatabaseUrl(baseConnectionString, taskId))
}

export function isDroppableBranchDatabaseName(database, taskId) {
  try {
    assertDroppableBranchDatabaseName(database, taskId)
    return true
  } catch {
    return false
  }
}

export function mergeEnvValue(contents, key, value) {
  const normalized = String(contents ?? '').replace(/\r\n/g, '\n')
  const lines = normalized ? normalized.replace(/\n$/, '').split('\n') : []
  let replaced = false
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true
      return `${key}=${value}`
    }
    return line
  })
  if (!replaced) next.push(`${key}=${value}`)
  return `${next.join('\n')}\n`
}

function die(msg, code = 1) {
  process.stderr.write(`[dev:db:branch] ${msg}\n`)
  process.exit(code)
}

function out(msg) {
  process.stdout.write(`[dev:db:branch] ${msg}\n`)
}

function parseArgs(argv) {
  const args = [...argv]
  const command = args[0] === 'drop' || args[0] === 'create' ? args.shift() : 'create'
  let envRoot = process.cwd()
  const positional = []

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--env-root') {
      const value = args[i + 1]
      if (!value) die('missing value for --env-root', 2)
      envRoot = resolve(value)
      i += 1
    } else if (arg.startsWith('--')) {
      die(`unknown flag '${arg}'`, 2)
    } else {
      positional.push(arg)
    }
  }

  if (positional.length > 1)
    die('usage: pnpm dev:db:branch [N] | node tools/platform/branch-database.mjs drop <N>', 2)
  return { command, taskId: positional[0] ?? null, envRoot }
}

/**
 * Both echelons of the base environment (#278).
 *
 * `CREATE DATABASE` is DDL, so the branch database is created and dropped
 * through the MIGRATING string — the application role this repo now provisions
 * is `NOCREATEDB` and would fail here, which is the whole point of it. The
 * application string is still required: it is what the worktree's `.env` has to
 * carry for `pnpm dev` and the integration tier.
 */
function loadBaseUrls(envRoot) {
  loadPlatformToolEnv(envRoot)
  const app = process.env[PLATFORM_DATABASE_URL_VAR]?.trim()
  if (!app) {
    throw new Error(
      `${PLATFORM_DATABASE_URL_VAR} is not set in the environment, this worktree .env, ` +
        'or the primary checkout .env; there is no fallback to DATABASE_URL/cms',
    )
  }
  const migrate = resolveMigrateDatabaseUrl(process.env)
  return { app, migrate: migrate.url, split: migrate.split, warning: migrate.warning }
}

function patchWorktreeEnv(envRoot, values) {
  const path = resolve(envRoot, '.env')
  let contents = existsSync(path) ? readFileSync(path, 'utf8') : ''
  for (const [key, value] of Object.entries(values)) {
    contents = mergeEnvValue(contents, key, value)
  }
  writeFileSync(path, contents, 'utf8')
  return path
}

async function create({ taskId, envRoot }) {
  const task = taskId ?? taskIdFromWorktreePath(envRoot)
  const base = loadBaseUrls(envRoot)
  if (base.warning) out(`! ${base.warning}`)

  const branchAppUrl = formatBranchDatabaseUrl(base.app, task)
  const branchMigrateUrl = formatBranchDatabaseUrl(base.migrate, task)
  const outcome = await ensureDatabase(branchMigrateUrl)

  const written = { [PLATFORM_DATABASE_URL_VAR]: branchAppUrl }
  // Only when the estate really is split: writing the variable in an un-split
  // worktree would turn this tool's documented fallback into a silent duplicate.
  if (base.split) written[PLATFORM_MIGRATE_DATABASE_URL_VAR] = branchMigrateUrl
  const envPath = patchWorktreeEnv(envRoot, written)

  out(formatEnsureOutcome(outcome).trim())
  for (const [key, value] of Object.entries(written)) out(`${key}=${value}`)
  out(`wrote ${envPath}; pnpm platform:migrate in this worktree will use ${outcome.database}.`)
}

async function drop({ taskId, envRoot }) {
  if (!taskId) die('drop requires a numeric task id', 2)
  const base = loadBaseUrls(envRoot)
  const branchUrl = formatBranchDatabaseUrl(base.migrate, taskId)
  const outcome = await dropBranchDatabase(branchUrl, taskId)
  out(formatDropOutcome(outcome).trim())
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === 'drop') await drop(args)
  else await create(args)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = resolve(fileURLToPath(import.meta.url))
if (
  invokedPath &&
  invokedPath === selfPath &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  main().catch((err) => die(err?.message ?? String(err), 1))
}
