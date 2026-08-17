#!/usr/bin/env node
/**
 * `pnpm platform:member:seed <dataset.json> [--dry-run]` — the manual member seed
 * of the cutover (spec 124 EARS-14; runbook `docs/runbooks/hours-core-cutover.md`).
 *
 *   pnpm platform:member:seed /srv/bbm/cutover/members.json --dry-run
 *   pnpm platform:member:seed /srv/bbm/cutover/members.json
 *
 * THE DATASET FILE IS NEVER COMMITTED. It holds real names, real emails and the
 * external handles of ~11 people, one join away from salary data — it is prepared
 * by hand with the owner and lives only on the box for the length of the window
 * (EARS-14). The fixtures under `tests/int/platform/fixtures/` are obviously fake
 * people whose only job is to pin the mechanics.
 *
 * Shape:
 *
 *   {
 *     "members": [
 *       {
 *         "email": "anton@bbm.academy",        // REQUIRED — the identity, normalized
 *         "name": "Антон Сидоров",             // REQUIRED
 *         "role": "CTO",                       // optional, null clears it
 *         "status": "active" | "inactive",     // optional, default active
 *         "timezone": "Europe/Moscow",         // optional, default Europe/Moscow
 *         "slug": "anton",                     // optional, default from the email local part
 *         "aliases": [                          // optional (EARS-17)
 *           { "kind": "mattermost_id", "value": "dobroyar", "note": "MM login" }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Idempotent, because a seed applied to a live registry gets re-run: the person is
 * matched by NORMALIZED email, only the fields the dataset actually changes are
 * pushed, and an alias already present under the same (kind, normalized value) is
 * left alone. Nobody is ever deleted — a narrower dataset is not a removal
 * instruction (EARS-19 keeps removal in the owner's SQL escape hatch).
 *
 * ONE transaction for the whole dataset: a refusal on the eleventh person must not
 * leave ten half-seeded ones behind, since the operator's next move inside the
 * window is to fix the file and re-run. `--dry-run` is that same transaction,
 * rolled back — so the plan it prints is a plan the database actually accepted,
 * constraints included, not a guess.
 *
 * The writes go through the member module's public API
 * (`upsertMemberWithAliases`, `src/lib/member/index.ts`) rather than SQL of its
 * own: EARS-8, and the normalization the constraints depend on has exactly one
 * definition.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { upsertMemberWithAliases } from '@/lib/member'
import type { MemberAliasSeed, MemberSeedInput } from '@/lib/member'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { loadPlatformToolEnv } from './load-env.mjs'

const TAG = 'platform:member:seed'

/** The statuses `core.member`'s CHECK accepts — refused here, not by the database. */
const STATUSES = ['active', 'inactive']

export type MemberDataset = { members: MemberSeedInput[] }

export type MemberSeedSummary = {
  members: { created: number; updated: number; unchanged: number }
  aliases: { inserted: number; present: number }
  dryRun: boolean
}

/** A dataset the seed refuses to apply, with the entry named. */
export class MemberDatasetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemberDatasetError'
  }
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MemberDatasetError(`${where} must be a non-empty string`)
  }
  return value
}

function optionalString(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new MemberDatasetError(`${where} must be a string`)
  return value
}

function parseAliases(raw: unknown, where: string): MemberAliasSeed[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new MemberDatasetError(`${where} must be an array`)
  return raw.map((entry, index) => {
    const at = `${where}[${index}]`
    const alias = (entry ?? {}) as Record<string, unknown>
    return {
      kind: requireString(alias.kind, `${at}.kind`),
      value: requireString(alias.value, `${at}.value`),
      note:
        alias.note === undefined || alias.note === null
          ? null
          : requireString(alias.note, `${at}.note`),
    }
  })
}

/**
 * Validate the dataset before a single statement runs.
 *
 * Every message names the offending entry by index, because the operator is
 * editing a hand-written file inside a maintenance window: "members[7].email must
 * be a non-empty string" is actionable, "null value in column violates not-null
 * constraint" is not. `status` is checked here too — the CHECK on the column would
 * catch it, but only after the transaction has done real work.
 */
export function parseMemberDataset(raw: unknown): MemberDataset {
  const root = (raw ?? {}) as Record<string, unknown>
  if (!Array.isArray(root.members)) {
    throw new MemberDatasetError('the dataset must be an object with a `members` array')
  }

  const members = root.members.map((entry, index) => {
    const at = `members[${index}]`
    const entryRaw = (entry ?? {}) as Record<string, unknown>
    const status = optionalString(entryRaw.status, `${at}.status`)
    if (status !== undefined && !STATUSES.includes(status)) {
      throw new MemberDatasetError(`${at}.status must be one of ${STATUSES.join(' | ')}`)
    }
    const member: MemberSeedInput = {
      email: requireString(entryRaw.email, `${at}.email`),
      name: requireString(entryRaw.name, `${at}.name`),
    }
    if (entryRaw.role !== undefined) {
      member.role = entryRaw.role === null ? null : requireString(entryRaw.role, `${at}.role`)
    }
    if (status !== undefined) member.status = status
    const timezone = optionalString(entryRaw.timezone, `${at}.timezone`)
    if (timezone !== undefined) member.timezone = timezone
    const slug = optionalString(entryRaw.slug, `${at}.slug`)
    if (slug !== undefined) member.slug = slug
    const aliases = parseAliases(entryRaw.aliases, `${at}.aliases`)
    if (aliases !== undefined) member.aliases = aliases
    return member
  })

  const seen = new Map<string, number>()
  members.forEach((member, index) => {
    const key = member.email.trim().toLowerCase()
    const first = seen.get(key)
    if (first !== undefined) {
      throw new MemberDatasetError(
        `members[${index}].email «${member.email}» repeats members[${first}] — one person, one entry`,
      )
    }
    seen.set(key, index)
  })

  return { members }
}

/** Read and validate a dataset file. */
export function readMemberDataset(file: string): MemberDataset {
  return parseMemberDataset(JSON.parse(readFileSync(file, 'utf8')) as unknown)
}

/** Thrown to roll a `--dry-run` transaction back after it has done all the work. */
class DryRunRollback extends Error {
  constructor(readonly summary: MemberSeedSummary) {
    super('dry run')
    this.name = 'DryRunRollback'
  }
}

/**
 * Apply the dataset — one transaction, whole or nothing (EARS-14).
 *
 * `dryRun` runs the identical statements and then rolls back by throwing: the
 * summary it returns is therefore the summary of a seed the database ACCEPTED, so
 * a duplicate alias or a bad status is found in the rehearsal rather than half-way
 * through the real run.
 */
export async function seedMembers(
  dataset: MemberDataset,
  options?: { dryRun?: boolean },
): Promise<MemberSeedSummary> {
  const dryRun = options?.dryRun === true
  const db = getPlatformDb()
  try {
    return await db.transaction(async (tx) => {
      const summary: MemberSeedSummary = {
        members: { created: 0, updated: 0, unchanged: 0 },
        aliases: { inserted: 0, present: 0 },
        dryRun,
      }
      for (const member of dataset.members) {
        const outcome = await upsertMemberWithAliases(member, { db: tx })
        if (outcome.created) summary.members.created += 1
        else if (outcome.profileUpdated) summary.members.updated += 1
        else summary.members.unchanged += 1
        summary.aliases.inserted += outcome.aliasesInserted
        summary.aliases.present += outcome.aliasesPresent
      }
      if (dryRun) throw new DryRunRollback(summary)
      return summary
    })
  } catch (err) {
    if (err instanceof DryRunRollback) return err.summary
    throw err
  }
}

/** The per-table summary the runbook asks the operator to paste (EARS-14). */
export function summaryLines(summary: MemberSeedSummary): string[] {
  return [
    `  core.member       created ${summary.members.created} · updated ${summary.members.updated} · unchanged ${summary.members.unchanged}`,
    `  core.member_alias inserted ${summary.aliases.inserted} · already present ${summary.aliases.present}`,
    ...(summary.dryRun ? ['  DRY RUN — the transaction was rolled back, nothing was written'] : []),
  ]
}

function parseArgv(argv: string[]): { file: string; dryRun: boolean } {
  const args = argv.filter((arg) => arg !== '')
  const dryRun = args.includes('--dry-run')
  const files = args.filter((arg) => !arg.startsWith('--'))
  if (files.length !== 1) {
    throw new MemberDatasetError(
      'usage: pnpm platform:member:seed <dataset.json> [--dry-run] (exactly one dataset file)',
    )
  }
  return { file: resolve(files[0]), dryRun }
}

async function main(): Promise<void> {
  loadPlatformToolEnv()
  const { file, dryRun } = parseArgv(process.argv.slice(2))
  const dataset = readMemberDataset(file)
  console.log(
    `\n▶ ${TAG}${dryRun ? ' (dry run)' : ''}: ${dataset.members.length} member(s) from ${file}`,
  )
  const summary = await seedMembers(dataset, { dryRun })
  for (const line of summaryLines(summary)) console.log(line)
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
