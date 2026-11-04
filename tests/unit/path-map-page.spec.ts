import { describe, expect, it, vi } from 'vitest'

/**
 * `/p/path` (#530, #533): the route is a thin mount of the path-map view over
 * the map `getPathMap` read (the private repo, or the local example). Pinned here: it renders per request (the (platform)
 * cache gate, spec 060 req.6 — same rule as `/p/okr` and `/p/hours`), and it
 * hands the view what `getPathMap` read, with the file path for the error and
 * empty states. The font-loading layout is mocked: `next/font` is a build-time
 * transform that vitest does not run.
 */

// The edit Server Action (#539) pulls in Auth.js, which needs Next's runtime; the
// page only passes it through, so a stub stands in.
vi.mock('@/app/(platform)/p/path/actions', () => ({ savePathMapEditAction: async () => null }))
vi.mock('@/modules/path-map/view/PathMapLayout', () => ({
  PathMapLayout: ({ children }: { children: unknown }) => children,
}))

describe('/p/path page', () => {
  it('opts out of static/route caching', async () => {
    const page = await import('@/app/(platform)/p/path/page')
    expect(page.dynamic).toBe('force-dynamic')
  })

  it('passes the loaded map and its file path to the view, after the source notice', async () => {
    // No PATH_MAPS_GITHUB_TOKEN in the test env → the local public example (#533).
    const page = await import('@/app/(platform)/p/path/page')
    const tree = (await page.default()) as unknown as {
      props: {
        children: [
          { props: { origin: string; stale: boolean } },
          {
            props: {
              result: { ok: boolean }
              file: string
              editing: { enabled: boolean; reason?: string }
            }
          },
        ]
      }
    }
    const [notice, view] = tree.props.children
    expect(notice.props.origin).toBe('local')
    expect(notice.props.stale).toBe(false)
    expect(view.props.file).toBe('content/path-map/doctor-school.yaml')
    expect(view.props.result.ok).toBe(true)
    // The local example is never written (#539): editing is off, with the reason.
    expect(view.props.editing).toMatchObject({
      enabled: false,
      reason: 'редактирование доступно только для живой карты',
    })
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
