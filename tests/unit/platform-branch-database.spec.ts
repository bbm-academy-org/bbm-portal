// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
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
