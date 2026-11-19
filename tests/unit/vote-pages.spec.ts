import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

/**
 * The vote module's surfaces (#575): its workspace declaration (the launcher
 * tile, the app switcher and the cabinet sidebar all derive from it), the
 * member page `/p/vote`, the cabinet pages under `/p/admin/vote`, and the
 * Server Actions behind them.
 *
 * The service and the session are stubbed — the operations themselves are
 * pinned by `vote-service.spec.ts`; here the question is only that every
 * surface is mounted per request and that every action asks the session.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/modules/vote/actions', () => ({
  submitBallotAction: async () => null,
  createPollAction: async () => null,
  openPollAction: async () => null,
  closePollAction: async () => null,
  createConsentFromLeadersAction: async () => null,
}))
vi.mock('@/lib/vote/service', () => ({
  memberOverview: async () => ({ ok: true, value: [] }),
  adminOverview: async () => ({ ok: true, value: [] }),
  pollResults: async () => ({ ok: false, error: 'нет' }),
}))

const redirect = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ redirect, notFound: vi.fn() }))

describe('the vote workspace declaration', () => {
  it('declares the member page and the cabinet section «Голосование»', async () => {
    const { voteWorkspaceEntry } = await import('@/lib/vote')
    expect(voteWorkspaceEntry).toMatchObject({
      kind: 'internal',
      slug: 'vote',
      name: 'Голосование',
      href: '/p/vote',
    })
    expect(voteWorkspaceEntry.admin?.label).toBe('Голосование')
    expect(voteWorkspaceEntry.admin?.resources.map((r) => r.name)).toEqual(['polls'])
  })

  it('is registered in the composition root', async () => {
    const { voteWorkspaceEntry } = await import('@/lib/vote')
    const { WORKSPACE_REGISTRY } = await import('@/lib/workspace/registry')
    expect(WORKSPACE_REGISTRY).toContain(voteWorkspaceEntry)
  })
})

describe('the vote pages render per request', () => {
  it('/p/vote', async () => {
    const page = await import('@/app/(platform)/p/vote/page')
    expect(page.dynamic).toBe('force-dynamic')
  })

  it('/p/admin/vote/polls', async () => {
    const page = await import('@/app/(platform)/p/admin/vote/polls/page')
    expect(page.dynamic).toBe('force-dynamic')
  })

  it('/p/admin/vote/polls/show/[id]', async () => {
    const page = await import('@/app/(platform)/p/admin/vote/polls/show/[id]/page')
    expect(page.dynamic).toBe('force-dynamic')
  })

  it('/p/admin/vote sends the cabinet section to its one resource', async () => {
    const page = await import('@/app/(platform)/p/admin/vote/page')
    page.default()
    expect(redirect).toHaveBeenCalledWith('/p/admin/vote/polls')
  })
})

describe('the vote Server Actions', () => {
  const source = readFileSync(join(REPO_ROOT, 'src', 'modules', 'vote', 'actions.ts'), 'utf8')
  const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])

  it('exports the five actions the pages post to', () => {
    expect(exported.sort()).toEqual([
      'closePollAction',
      'createConsentFromLeadersAction',
      'createPollAction',
      'openPollAction',
      'submitBallotAction',
    ])
  })

  it('every action reads the session itself — the layout gate does not cover an action endpoint', () => {
    for (const name of exported) {
      const body = source.slice(source.indexOf(`export async function ${name}(`))
      const end = body.indexOf('\nexport ', 1)
      const fn = end === -1 ? body : body.slice(0, end)
      expect(fn, name).toContain('await auth()')
    }
  })
})
