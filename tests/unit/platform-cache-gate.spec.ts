import { describe, expect, it, vi } from 'vitest'

// Cache gate for the platform surface (spec 060 req.6): the /p/okr page and the
// (platform) root layout must opt out of static/route caching with an explicit
// `dynamic = 'force-dynamic'` route-segment config, so an authed render can
// never be served from a cache to an anonymous visitor (152-FZ: no team PII to
// anonymous callers). The heavy leaf imports are mocked — this test pins the
// exported segment config, not the render.

vi.mock('@/modules/okr/view/OkrLayout', () => ({ OkrLayout: () => null }))
vi.mock('@/modules/okr/view/OkrView', () => ({ OkrView: () => null }))
vi.mock('@/auth', () => ({ auth: async () => null }))

describe('platform cache gate (force-dynamic route-segment config)', () => {
  it('/p/okr page opts out of static/route caching', async () => {
    const page = await import('@/app/(platform)/p/okr/page')
    expect(page.dynamic).toBe('force-dynamic')
  })

  it('(platform) root layout opts out of static/route caching for the whole subtree', async () => {
    const layout = await import('@/app/(platform)/layout')
    expect(layout.dynamic).toBe('force-dynamic')
  })
})
