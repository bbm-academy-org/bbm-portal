// @vitest-environment node
import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The SHAPE of the finance module (spec 338 EARS-323, EARS-334).
 *
 * EARS-323 is a claim about the tree, not about behaviour: the module lives at
 * `src/lib/finance/` with its public API in `index.ts`, its tables appear only
 * through the platform migration pipeline, and `pnpm boundaries` stays green —
 * only the finance module imports `schema/finance/`, and no route imports a
 * table file. The only honest test of the last part is to RUN
 * dependency-cruiser against the REAL tree, which is what this file does; the
 * fixture trees that prove the RULES bite live in
 * `tests/unit/platform-boundaries.spec.ts`.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONFIG = resolve(REPO_ROOT, '.dependency-cruiser.cjs')
const DEPCRUISE_BIN = resolve(
  REPO_ROOT,
  'node_modules',
  'dependency-cruiser',
  'bin',
  'dependency-cruise.mjs',
)

type Cruise = { code: number; output: string }

let cruise: Cruise | undefined
let financeApi: Record<string, unknown> | undefined

beforeAll(
  async () => {
    const run = new Promise<Cruise>((settle) => {
      execFile(
        process.execPath,
        [DEPCRUISE_BIN, 'src', '--config', CONFIG, '--output-type', 'err'],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          // A non-zero exit arrives as a numeric `error.code`; a failed spawn or
          // a signal reads as -1, as `spawnSync`'s null status did.
          const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
          settle({ code, output: `${stdout ?? ''}${stderr ?? ''}` })
        },
      )
    })
    // The cruise runs in a child process, so the module graph loads alongside it.
    ;[cruise, financeApi] = await Promise.all([run, import('@/lib/finance')])
  },
  // Both costs are inherent: a real dependency-cruiser run over the real tree
  // and a cold load of the whole finance module graph. Measured 2026-11-25 on
  // the Windows dev box: the cruise 4-9.7 s and the module load ~1.9 s alone,
  // each inside a case and past Vitest's 5 s default under machine load (#599).
  // Paid once here; 60 s still fails a genuinely hung cruise.
  60_000,
)

describe('the finance module lives inside its boundary (EARS-323)', () => {
  it('EARS-323: `pnpm boundaries` is green over the real tree with the finance module in it', () => {
    expect(cruise).toBeDefined()
    expect(cruise?.output).not.toContain('finance')
    expect(cruise?.code).toBe(0)
  })

  it('EARS-323: the module has a public API at src/lib/finance/index.ts, and it is the only door', () => {
    const index = readFileSync(join(REPO_ROOT, 'src/lib/finance/index.ts'), 'utf8')
    for (const exported of [
      'recordOperation',
      'reverseOperation',
      'recordConversion',
      'createCurrency',
      'retireReferenceRow',
      'accountBalances',
      'listRegister',
      'postingsMissingOptionalProduct',
    ]) {
      expect(index).toContain(exported)
    }
  })

  it('EARS-516/523: the public API exposes neither raw document storage nor storage keys', () => {
    const api = financeApi
    expect(api).toBeDefined()
    expect(api).not.toHaveProperty('resolveFinanceDocumentStorage')
    expect(api).not.toHaveProperty('buildFinanceDocumentStorageKey')
    expect(api).not.toHaveProperty('FINANCE_DOCUMENTS_DEFAULT_DIR')
  })

  it('EARS-323: only the finance module imports schema/finance, and no route imports a table file', () => {
    const offenders: string[] = []
    for (const file of walk(join(REPO_ROOT, 'src'))) {
      if (!/\.(ts|tsx)$/.test(file)) continue
      const relative = file.slice(REPO_ROOT.length + 1).replace(/\\/g, '/')
      if (!readFileSync(file, 'utf8').includes('db/schema/finance')) continue
      const allowed =
        relative.startsWith('src/lib/finance/') ||
        relative.startsWith('src/modules/finance/') ||
        relative.startsWith('src/lib/platform/db/schema/finance/')
      if (!allowed) offenders.push(relative)
    }
    expect(offenders).toEqual([])
  })

  it('EARS-323: the finance tables exist only as a committed migration, with no ad-hoc DDL in the module', () => {
    const migrations = readdirSync(join(REPO_ROOT, 'src/lib/platform/db/migrations')).filter(
      (name) => name.endsWith('.sql'),
    )
    const financeMigrations = migrations.filter((name) =>
      readFileSync(join(REPO_ROOT, 'src/lib/platform/db/migrations', name), 'utf8').includes(
        'core"."finance_',
      ),
    )
    expect(financeMigrations).toEqual([
      '0008_finance_ledger_core.sql',
      // The F2 intake spine (spec 339, #381) — `finance_intake_item` and the
      // `finance_counterparty` its FK needs. Still a committed migration, still
      // no DDL in the module: the list grows, the rule does not move.
      '0009_finance_intake_spine.sql',
      // The confirming documents (spec 339 §D, #382) — `finance_document` and
      // `finance_document_link`. Same rule again: the archive's TABLES are a
      // committed migration, and the module creates none of them at runtime.
      '0010_finance_documents.sql',
      // The durable Postgres/object-storage lifecycle added by the #382 review.
      '0011_finance_document_lifecycle.sql',
      // The server-computed byte identity required for exact upload recovery.
      '0012_finance_document_content_digest.sql',
      // The request-bound purpose proposal and its universal audit trigger (#383).
      '0013_finance_reference_proposals.sql',
      // #416 closes the missing INSERT arm on the terminal-item link guard.
      '0014_finance_document_link_insert_guard.sql',
      // A request is an INTENT (owner ruling, Антон, 2026-09-03, #388): the
      // paying account and `occurred_on` may be empty while a pre-spend request
      // is unposted, and the `money_facts` CHECK is what keeps that «may» from
      // meaning «anywhere» (EARS-533).
      '0015_finance_intake_money_facts.sql',
      // The audit columns of #516 — a PLATFORM-WIDE migration that happens to
      // touch every finance table too. It belongs on this list for the same
      // reason the others do: the DDL is a committed migration, and the module
      // still creates nothing at runtime. The rule does not move because the
      // migration was not written by the finance task.
      '0016_audit_columns.sql',
      // `provenance jsonb` + the revised EARS-503 ref policy, and the one-off
      // repair that lifts the Mattermost `key=value` block out of `note` (#517).
      '0017_finance_intake_provenance.sql',
      // The Bank of Russia display rates (spec 339 §I, #548) — outside the
      // ledger (EARS-553), but still a committed migration and no runtime DDL.
      '0018_finance_fx_rate.sql',
      // `settles_item_id`, the attach-after-posting link guard and the one-off
      // reimbursement link step of the payment queue (#549).
      '0019_finance_settles_item.sql',
      // The `equity` kind, the `contribution` intake kind and `finance_budget`
      // (spec 338 §D, spec 339 §K, #593).
      '0021_finance_budget_funding.sql',
    ])

    for (const file of walk(join(REPO_ROOT, 'src/lib/finance'))) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/create\s+table|alter\s+table|drop\s+table/i)
    }
  })
})

describe('the ledger posts no allocation, by construction (EARS-334)', () => {
  it('EARS-334: no percentage base, absorption rate or allocation run exists anywhere in the module', () => {
    const offenders: string[] = []
    for (const file of walk(join(REPO_ROOT, 'src/lib/finance'))) {
      const source = readFileSync(file, 'utf8')
      // Comments state the absence, so only IDENTIFIERS count: a `function
      // allocate…`, an `allocationRate` constant, an exported `absorb…`.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      const hits = code.match(/\b(allocat|absorb|apportion|overheadRate|drivenBy)\w*/gi)
      if (hits !== null) offenders.push(`${file}: ${hits.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}
