import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «Карта пути» v2, task D (#539) — the Server Action behind the editor. Its
 * own exported endpoint is a boundary (EARS-462): it asks `auth()` itself,
 * hands the session, the raw input and the env-built source to
 * `runPathMapEdit`, and revalidates `/p/path` only after a successful commit.
 * The source and the save are mocked here; their behaviour has its own spec.
 */

const state = vi.hoisted(() => ({
  session: null as unknown,
  revalidated: [] as string[],
  outcome: { status: 'ok', sha: 'sha-2', commit: 'c', summary: 's' } as Record<string, unknown>,
  calls: [] as Array<{ session: unknown; input: unknown; source: unknown }>,
}))

vi.mock('@/auth', () => ({ auth: async () => state.session }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => state.revalidated.push(p) }))
vi.mock('@/lib/path-map/save', () => ({
  runPathMapEdit: async (args: { session: unknown; input: unknown; source: unknown }) => {
    state.calls.push(args)
    return state.outcome
  },
}))
vi.mock('@/lib/path-map/source', () => ({
  pathMapSourceFromEnv: () => ({ kind: 'github', marker: 'env-source' }),
}))

import { savePathMapEditAction } from '@/app/(platform)/p/path/actions'

beforeEach(() => {
  state.revalidated = []
  state.calls = []
  state.session = { user: { name: 'Антон', roles: ['platform-user'] } }
})

describe('savePathMapEditAction', () => {
  it('passes the session, the input and the env source to the save and revalidates on success', async () => {
    const input = { command: { op: 'node.remove', nodeId: 'x' }, baseSha: 'sha-1' }
    await expect(savePathMapEditAction(input)).resolves.toEqual(state.outcome)
    expect(state.calls).toEqual([
      { session: state.session, input, source: { kind: 'github', marker: 'env-source' } },
    ])
    expect(state.revalidated).toEqual(['/p/path'])
  })

  it('does not revalidate when nothing was written', async () => {
    state.outcome = { status: 'stale' }
    await savePathMapEditAction({ command: {}, baseSha: 'x' })
    expect(state.revalidated).toEqual([])
  })
})
