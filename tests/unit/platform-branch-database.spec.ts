// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  parseCreateFlags,
  planPostCreateSteps,
  branchDatabaseName,
  deriveBranchMaintenanceTarget,
  formatBranchDatabaseUrl,
  isDroppableBranchDatabaseName,
  mergeEnvValue,
} from '../../tools/platform/branch-database.mjs'

const PLATFORM_URL = 'postgres://payload:pw@postgres:5432/platform?sslmode=require'

describe('per-worktree platform branch database derivation', () => {
  it('derives only platform_<N> from a numeric task worktree id', () => {
    expect(branchDatabaseName('200')).toBe('platform_200')

    for (const bad of ['', '0', '-1', 'cms', '200-extra', 'platform_200']) {
      expect(() => branchDatabaseName(bad)).toThrow(/numeric/i)
    }
  })

  it('builds a branch PLATFORM_DATABASE_URL without changing credentials or query params', () => {
    expect(formatBranchDatabaseUrl(PLATFORM_URL, '200')).toBe(
      'postgres://payload:pw@postgres:5432/platform_200?sslmode=require',
    )
  })

  it('refuses to derive from Payload cms rather than hiding a bad base URL', () => {
    expect(() => formatBranchDatabaseUrl('postgres://payload:pw@postgres:5432/cms', '200')).toThrow(
      /cms|Payload/i,
    )
  })

  it('reuses the maintenance-target seam for the branch database', () => {
    const target = deriveBranchMaintenanceTarget(PLATFORM_URL, '200')

    expect(target.ok).toBe(true)
    expect(target.database).toBe('platform_200')
    expect(target.maintenanceUrl).toBe(
      'postgres://payload:pw@postgres:5432/postgres?sslmode=require',
    )
  })
})

describe('safe branch database drop guard', () => {
  it('allows dropping only platform_<numeric-task-id>', () => {
    expect(isDroppableBranchDatabaseName('platform_200', '200')).toBe(true)

    for (const name of ['platform', 'platform_abc', 'platform_201', 'cms_200', 'cms']) {
      expect(isDroppableBranchDatabaseName(name, '200')).toBe(false)
    }
  })
})

describe('worktree .env patching', () => {
  it('adds PLATFORM_DATABASE_URL to a fresh worktree env file without copying anything else', () => {
    expect(mergeEnvValue('', 'PLATFORM_DATABASE_URL', 'postgres://u:p@h:5432/platform_200')).toBe(
      'PLATFORM_DATABASE_URL=postgres://u:p@h:5432/platform_200\n',
    )
  })

  it('updates an existing PLATFORM_DATABASE_URL and preserves unrelated lines', () => {
    expect(
      mergeEnvValue(
        'DATABASE_URL=postgres://payload:pw@postgres:5432/cms\nPLATFORM_DATABASE_URL=old\n',
        'PLATFORM_DATABASE_URL',
        'postgres://u:p@h:5432/platform_200',
      ),
    ).toBe(
      'DATABASE_URL=postgres://payload:pw@postgres:5432/cms\nPLATFORM_DATABASE_URL=postgres://u:p@h:5432/platform_200\n',
    )
  })
})

/**
 * «A migrated AND seeded database in one command» (#436).
 *
 * The owner's no-reminders criterion is that an agent bringing a stand up by
 * the documented path — `pnpm task:worktree N` → `pnpm dev:db:branch` →
 * `PORT=<n> pnpm dev` — gets a populated stand by construction, with no skill
 * text, hook or handoff line telling it to seed. So `dev:db:branch` owns the
 * whole bring-up: create the database, migrate it, seed it. What is asserted
 * here is the pure half — which follow-up steps the command has decided to run,
 * and that each of them can be switched off deliberately by name.
 */
describe('what dev:db:branch runs after creating the database', () => {
  it('migrates and then seeds, in that order', () => {
    expect(planPostCreateSteps({})).toEqual(['platform:migrate', 'dev:seed'])
  })

  it('drops the seed on --no-seed, keeping the migrate', () => {
    expect(planPostCreateSteps({ seed: false })).toEqual(['platform:migrate'])
  })

  it('runs nothing extra when both are declined', () => {
    expect(planPostCreateSteps({ migrate: false, seed: false })).toEqual([])
  })

  it('never seeds an unmigrated database', () => {
    // There is no «seed but do not migrate»: the seed would fail on a missing
    // schema, and a half-brought-up stand that LOOKS deliberate is worse than a
    // refusal to offer the combination at all.
    expect(planPostCreateSteps({ migrate: false })).toEqual([])
  })

  it('reads the two opt-outs off the command line', () => {
    expect(parseCreateFlags(['--no-seed'])).toEqual({ migrate: true, seed: false })
    expect(parseCreateFlags(['--no-migrate'])).toEqual({ migrate: false, seed: true })
    expect(parseCreateFlags([])).toEqual({ migrate: true, seed: true })
  })
})
