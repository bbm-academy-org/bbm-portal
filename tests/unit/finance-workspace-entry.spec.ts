import { describe, expect, it } from 'vitest'

import { WORKSPACE_REGISTRY } from '@/lib/workspace/registry'
import type { InternalWorkspaceEntry } from '@/lib/workspace/contract'

const EXPECTED_RESOURCES = [
  ['currencies', 'Валюты', ['list', 'show', 'create', 'edit', 'delete']],
  ['accounts', 'Счета', ['list', 'show', 'create', 'edit', 'delete']],
  ['projects', 'Проекты', ['list', 'show', 'create', 'edit', 'delete']],
  ['products', 'Продукты', ['list', 'show', 'create', 'edit', 'delete']],
  ['purposes', 'Назначения расходов', ['list', 'show', 'create', 'edit', 'delete']],
  ['categories', 'Статьи расходов', ['list', 'show', 'create', 'edit', 'delete']],
] as const

describe('the finance workspace declaration (spec 338 EARS-324, CRUD check)', () => {
  it('EARS-324: replaces the planned tile with one internal member-readable entry', async () => {
    const finance = (await import('@/lib/finance')) as {
      financeWorkspaceEntry?: InternalWorkspaceEntry
    }
    const entry = finance.financeWorkspaceEntry

    expect(entry).toBeDefined()
    expect(entry).toMatchObject({
      kind: 'internal',
      slug: 'finance',
      name: 'Финансы',
      href: '/p/finance',
    })
    expect(entry).not.toHaveProperty('requiredClaim')
    expect(WORKSPACE_REGISTRY).toContain(entry)
    expect(
      WORKSPACE_REGISTRY.filter(
        (candidate) => candidate.kind === 'planned' && candidate.name === 'Финансы',
      ),
    ).toEqual([])
  })

  it('EARS-324: declares all six finance reference resources with the accepted CRUD surface', async () => {
    const finance = (await import('@/lib/finance')) as {
      financeWorkspaceEntry?: InternalWorkspaceEntry
    }
    const resources = finance.financeWorkspaceEntry?.admin?.resources

    expect(resources).toHaveLength(6)
    expect(
      resources?.map((resource) => [resource.name, resource.label, resource.operations]),
    ).toEqual(EXPECTED_RESOURCES)
    for (const resource of resources ?? []) {
      expect(resource.schema.safeParse({}).success).toBe(false)
    }
  })
})
