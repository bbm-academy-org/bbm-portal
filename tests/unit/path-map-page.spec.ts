import { describe, expect, it, vi } from 'vitest'

/**
 * `/p/path` (#530): the route is a thin mount of the path-map view over the
 * committed YAML file. Pinned here: it renders per request (the (platform)
 * cache gate, spec 060 req.6 — same rule as `/p/okr` and `/p/hours`), and it
 * hands the view what `loadPathMap` read, with the file path for the error and
 * empty states. The font-loading layout is mocked: `next/font` is a build-time
 * transform that vitest does not run.
 */

vi.mock('@/modules/path-map/view/PathMapLayout', () => ({
  PathMapLayout: ({ children }: { children: unknown }) => children,
}))

describe('/p/path page', () => {
  it('opts out of static/route caching', async () => {
    const page = await import('@/app/(platform)/p/path/page')
    expect(page.dynamic).toBe('force-dynamic')
  })

  it('passes the loaded map and its file path to the view', async () => {
    const page = await import('@/app/(platform)/p/path/page')
    const tree = page.default() as unknown as {
      props: { children: { props: { result: { ok: boolean }; file: string } } }
    }
    const view = tree.props.children
    expect(view.props.file).toBe('content/path-map/doctor-school.yaml')
    expect(view.props.result.ok).toBe(true)
  })
})

describe('the path-map workspace declaration', () => {
  it('is an internal app at /p/path with no cabinet section and no pulse', async () => {
    const { pathMapWorkspaceEntry } = await import('@/lib/path-map')
    expect(pathMapWorkspaceEntry).toMatchObject({
      kind: 'internal',
      slug: 'path',
      name: 'Карта пути',
      href: '/p/path',
    })
    expect('admin' in pathMapWorkspaceEntry).toBe(false)
    expect('status' in pathMapWorkspaceEntry).toBe(false)
  })
})
