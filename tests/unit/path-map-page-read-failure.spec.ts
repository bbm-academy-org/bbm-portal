import { describe, expect, it, vi } from 'vitest'

/**
 * `/p/path` (#534 review): a READ failure mounts the read-failure state, not
 * the map view's «file has errors» state; a parse failure still goes to the
 * map view. `getPathMap` is mocked to return each shape.
 */

const loadMock = vi.hoisted(() => vi.fn())

// The edit Server Action (#539) pulls in Auth.js, which needs Next's runtime; the
// page only passes it through, so a stub stands in.
vi.mock('@/app/(platform)/p/path/actions', () => ({ savePathMapEditAction: async () => null }))
vi.mock('@/modules/path-map/view/PathMapLayout', () => ({
  PathMapLayout: ({ children }: { children: unknown }) => children,
}))
vi.mock('@/lib/path-map', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/path-map')>()),
  getPathMap: loadMock,
}))

const base = {
  file: 'bbm-academy-org/path-maps · maps/doctor-school.yaml',
  origin: { kind: 'github', repo: 'bbm-academy-org/path-maps', path: 'maps/doctor-school.yaml' },
  sha: null,
  stale: false,
  asOf: '2026-11-03T10:00:00Z',
}

type Child = { type: { name?: string }; props: Record<string, unknown> }

async function children(): Promise<Child[]> {
  const page = await import('@/app/(platform)/p/path/page')
  const tree = (await page.default()) as unknown as { props: { children: Child[] } }
  return tree.props.children
}

describe('/p/path page — read vs parse failure', () => {
  it('a read failure renders PathMapReadError with its reason', async () => {
    loadMock.mockResolvedValueOnce({
      ...base,
      ok: false,
      errors: ['GitHub отклонил токен'],
      failure: { kind: 'read', reason: 'auth', message: 'GitHub отклонил токен' },
    })
    const [, body] = await children()
    expect(body.type.name).toBe('PathMapReadError')
    expect(body.props).toMatchObject({ reason: 'auth', message: 'GitHub отклонил токен' })
  })

  it('a parse failure still renders the map view with its error list', async () => {
    loadMock.mockResolvedValueOnce({
      ...base,
      ok: false,
      errors: ['tracks: обязательное поле'],
      failure: { kind: 'parse' },
    })
    const [, body] = await children()
    expect(body.type.name).toBe('PathMapView')
  })

  it('passes the stale reason to the source notice', async () => {
    loadMock.mockResolvedValueOnce({
      ...base,
      ok: true,
      map: { title: 'x', beacon: { title: 'b' }, tracks: [] },
      warnings: [],
      stale: true,
      staleReason: 'auth',
    })
    const [notice] = await children()
    expect(notice.props).toMatchObject({ stale: true, staleReason: 'auth' })
  })
})
