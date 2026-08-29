import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { memberWorkspaceEntry } from '@/lib/member'
import { cabinetResources, cabinetSchemas } from '@/app/(platform)/p/admin/resources'
import type { CabinetWorkspaceEntry } from '@/lib/workspace/contract'
import { WORKSPACE_REGISTRY } from '@/lib/workspace/registry'
import { buildLauncherView, isOpenable, switcherEntries } from '@/lib/workspace'

describe('cabinet-only workspace entries (spec 311 buildability correction, EARS-401/409/441)', () => {
  it('EARS-401/D-10: carries only cabinet identity and its admin section', () => {
    const entry: CabinetWorkspaceEntry = memberWorkspaceEntry
    expect(Object.keys(entry).sort()).toEqual(['admin', 'kind', 'name', 'slug'])
    expect(entry.kind).toBe('cabinet')
    expect(isOpenable(entry)).toBe(false)
  })

  it('EARS-401/D-10: a cabinet-only entry cannot grow a launcher target by type', () => {
    const entry: CabinetWorkspaceEntry = {
      kind: 'cabinet',
      slug: 'fixture',
      name: 'Fixture',
      admin: { label: 'Fixture', resources: [] },
      // @ts-expect-error cabinet-only entries have no href
      href: '/p/fixture',
    }
    expect(entry.href).toBe('/p/fixture')
  })

  it('EARS-402/412: is absent from launcher and switcher by construction', async () => {
    expect(await buildLauncherView([memberWorkspaceEntry], () => true)).toEqual([])
    expect(switcherEntries([memberWorkspaceEntry], () => true)).toEqual([])
  })

  it('EARS-409/441/D-9: appears in the cabinet under the singular member slug', () => {
    expect(memberWorkspaceEntry.slug).toBe('member')
    expect(WORKSPACE_REGISTRY).toContain(memberWorkspaceEntry)
    const resources = cabinetResources(WORKSPACE_REGISTRY)
    const members = resources.find((resource) => resource.name === 'member.members')
    expect(members).toMatchObject({
      list: '/p/admin/member/members',
      show: '/p/admin/member/members/show/:id',
      create: '/p/admin/member/members/create',
      edit: '/p/admin/member/members/edit/:id',
    })
    expect(cabinetSchemas(WORKSPACE_REGISTRY)['member.members']).toBe(
      memberWorkspaceEntry.admin.resources[0].schema,
    )
  })

  it('EARS-409/434: the cabinet index consumes the cabinet-only section too', async () => {
    const { default: AdminIndexPage } = await import('@/app/(platform)/p/admin/page')
    const html = renderToStaticMarkup(createElement(AdminIndexPage))
    expect(html).toContain('data-section="member"')
    expect(html).toContain('data-section-item="member.members"')
  })
})
