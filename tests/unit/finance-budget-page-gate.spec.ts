// Specifies the signed-out render of src/app/(platform)/p/finance/reports/budget/page.tsx.
//
// «Выйти» is a server action; Auth.js clears the session cookie, so Next
// re-renders the CURRENT route inside that action response before following the
// redirect (`x-action-revalidated`). Layouts and the page render in parallel, so
// the `/p` gate's redirect does not stop the page body from running with no
// session — the page must answer the same gate itself instead of handing an
// empty actor to the finance module (which refuses it with FinanceAccessRefusal).
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BudgetDashboardPage from '@/app/(platform)/p/finance/reports/budget/page'

const authMock = vi.hoisted(() => vi.fn())
const getLiveBudgetMock = vi.hoisted(() => vi.fn())
const redirectMock = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to })
  }),
)
const forbiddenMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403')
  }),
)

vi.mock('@/auth', () => ({ auth: authMock }))
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  forbidden: forbiddenMock,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/p/finance/reports/budget',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance')>()
  return { ...actual, getLiveBudget: getLiveBudgetMock, listCurrencies: async () => [] }
})

const ROUTE = '/p/finance/reports/budget'

// Imported statically (vi.mock is hoisted above it): the page's cold module graph is
// paid at collection, not inside a test's 5 s budget on a loaded full run.
function renderPage() {
  return BudgetDashboardPage({ searchParams: Promise.resolve({}) })
}

describe('/p/finance/reports/budget without a member session', () => {
  beforeEach(() => {
    authMock.mockReset()
    getLiveBudgetMock.mockReset()
    redirectMock.mockClear()
    forbiddenMock.mockClear()
  })

  it('a signed-out render goes to sign-in, as the /p gate does, and never asks the module', async () => {
    authMock.mockResolvedValue(null)
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith(
      `/api/auth/signin?callbackUrl=${encodeURIComponent(ROUTE)}`,
    )
    expect(getLiveBudgetMock).not.toHaveBeenCalled()
  })

  it('a session without platform-user gets the bare refusal, as the /p gate does', async () => {
    authMock.mockResolvedValue({ user: { email: 'guest@bbm.local', roles: [] } })
    await expect(renderPage()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403')
    expect(getLiveBudgetMock).not.toHaveBeenCalled()
  })
})
