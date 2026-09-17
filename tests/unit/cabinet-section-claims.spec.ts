/**
 * WHO administers a cabinet SECTION (spec 311 EARS-401/404/462/466, spec 339
 * EARS-529 as widened by owner decision 34, 2026-09-14).
 *
 * The cabinet was born with one claim over all of it: `/p/admin` is
 * `platform-admin` and every section inside it inherits that. Decision 34 broke
 * that assumption — the finance reference tables are administered by
 * `finance-entry` as well — and the fix is NOT a second literal sprinkled over
 * the handlers: the section DECLARES who administers it, in the composition
 * root, and every enforcement point (the shell gate, the sidebar, the index,
 * the Server Function, the module's HTTP handlers) derives the claim set from
 * that one declaration.
 *
 * Driven by a FIXTURE registry for the reason `cabinet-shell.spec.ts` gives,
 * with ONE assertion against the live registry: that the finance section really
 * carries the declaration decision 34 is about.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  cabinetClaimsForPath,
  cabinetResources,
  cabinetSectionClaims,
  cabinetSections,
  cabinetSectionSlugOf,
  CABINET_ROOT,
} from '@/app/(platform)/p/admin/resources'
import { PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'
import type { WorkspaceEntry } from '@/lib/workspace/contract'

const schema = z.object({ id: z.string() })

/** A section with no declaration of its own: `platform-admin` and nothing else. */
const HOURS: WorkspaceEntry = {
  kind: 'internal',
  slug: 'hours',
  name: 'Часы',
  description: 'Самооценка часов',
  href: '/p/hours',
  icon: 'hours',
  admin: {
    label: 'Часы',
    resources: [{ name: 'periods', label: 'Периоды', operations: ['list', 'edit'], schema }],
  },
}

/** A section that names a second administering claim (decision 34's shape). */
const MONEY: WorkspaceEntry = {
  kind: 'internal',
  slug: 'money',
  name: 'Деньги',
  description: 'Справочники',
  href: '/p/money',
  icon: 'money',
  admin: {
    label: 'Деньги',
    additionalClaims: ['money-entry'],
    resources: [{ name: 'purposes', label: 'Назначения', operations: ['list', 'edit'], schema }],
  },
}

const FIXTURE: WorkspaceEntry[] = [HOURS, MONEY]

const admits = (claims: readonly string[]) => (slug: string) =>
  cabinetSectionClaims(FIXTURE, slug).some((claim) => claims.includes(claim))

describe('a cabinet section declares who administers it (EARS-466, EARS-529)', () => {
  it('a section with no declaration is `platform-admin` and nothing else', () => {
    expect(cabinetSectionClaims(FIXTURE, 'hours')).toEqual([PLATFORM_ADMIN_ROLE])
  })

  it('a declared claim is ADDED to `platform-admin`, never a replacement for it', () => {
    expect(cabinetSectionClaims(FIXTURE, 'money')).toEqual([PLATFORM_ADMIN_ROLE, 'money-entry'])
  })

  it('an unknown slug admits nothing but `platform-admin` — fail-closed', () => {
    expect(cabinetSectionClaims(FIXTURE, 'nope')).toEqual([PLATFORM_ADMIN_ROLE])
  })

  it('the cabinet ROOT admits whoever may enter at least one section', () => {
    expect(cabinetClaimsForPath(FIXTURE, CABINET_ROOT)).toEqual([
      PLATFORM_ADMIN_ROLE,
      'money-entry',
    ])
  })

  it('a path INSIDE a section carries that section claim set and no other', () => {
    expect(cabinetClaimsForPath(FIXTURE, `${CABINET_ROOT}/hours/periods`)).toEqual([
      PLATFORM_ADMIN_ROLE,
    ])
    expect(cabinetClaimsForPath(FIXTURE, `${CABINET_ROOT}/money/purposes/edit/7`)).toEqual([
      PLATFORM_ADMIN_ROLE,
      'money-entry',
    ])
  })

  it('a Refine resource name resolves to the section that owns it', () => {
    expect(cabinetSectionSlugOf('money.purposes')).toBe('money')
    expect(cabinetSectionSlugOf('money')).toBe('money')
  })
})

describe('the shell offers only what the viewer may enter (EARS-437)', () => {
  it('a section the viewer cannot administer contributes no group and no route', () => {
    const names = cabinetResources(FIXTURE, admits(['money-entry'])).map((r) => r.name)
    expect(names).toEqual(['money', 'money.purposes'])
  })

  it('an admin still sees every section', () => {
    const names = cabinetResources(FIXTURE, admits([PLATFORM_ADMIN_ROLE])).map((r) => r.name)
    expect(names).toEqual(['hours', 'hours.periods', 'money', 'money.purposes'])
  })

  it('the index of sections is filtered by the same predicate as the sidebar', () => {
    expect(cabinetSections(FIXTURE, admits(['money-entry'])).map((s) => s.slug)).toEqual(['money'])
    expect(cabinetSections(FIXTURE).map((s) => s.slug)).toEqual(['hours', 'money'])
  })
})

describe('the live composition root carries decision 34', () => {
  it('EARS-529: the finance section names `finance-entry` beside `platform-admin`', async () => {
    const [{ WORKSPACE_REGISTRY }, { FINANCE_ENTRY_ROLE }] = await Promise.all([
      import('@/lib/workspace'),
      import('@/lib/finance'),
    ])
    expect(cabinetSectionClaims(WORKSPACE_REGISTRY, 'finance')).toEqual([
      PLATFORM_ADMIN_ROLE,
      FINANCE_ENTRY_ROLE,
    ])
  })

  it('a neighbouring section is untouched by it', async () => {
    const { WORKSPACE_REGISTRY } = await import('@/lib/workspace')
    expect(cabinetSectionClaims(WORKSPACE_REGISTRY, 'hours')).toEqual([PLATFORM_ADMIN_ROLE])
  })
})
