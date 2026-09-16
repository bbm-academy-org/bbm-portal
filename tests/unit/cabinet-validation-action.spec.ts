import { beforeEach, describe, expect, it, vi } from 'vitest'

import { auth } from '@/auth'
import { validateCabinetResponse } from '@/app/(platform)/p/admin/actions'

vi.mock('@/auth', () => ({ auth: vi.fn() }))

const authMock = vi.mocked(auth)

describe('EARS-436/462: registry-derived validation stays behind the cabinet gate', () => {
  beforeEach(() => authMock.mockReset())

  it('EARS-462: a platform member cannot invoke the validation Server Function', async () => {
    authMock.mockResolvedValue({ user: { roles: ['platform-user'] } } as never)

    await expect(validateCabinetResponse('okr.parameters', 'one', {})).rejects.toThrow(/forbidden/i)
  })

  it('EARS-529 (decision 34): a section-claim holder reaches the validator for ITS OWN section', async () => {
    const { FINANCE_ENTRY_ROLE } = await import('@/lib/finance')
    authMock.mockResolvedValue({
      user: { roles: ['platform-user', FINANCE_ENTRY_ROLE] },
    } as never)

    await expect(validateCabinetResponse('finance.purposes', 'one', {})).resolves.toMatchObject({
      success: false,
    })
  })

  it('EARS-462: and is refused for a section it does not administer — the gate is per section', async () => {
    const { FINANCE_ENTRY_ROLE } = await import('@/lib/finance')
    authMock.mockResolvedValue({
      user: { roles: ['platform-user', FINANCE_ENTRY_ROLE] },
    } as never)

    await expect(validateCabinetResponse('hours.periods', 'one', {})).rejects.toThrow(/forbidden/i)
  })

  it('EARS-436: an admin reaches the registry validator, never a caller-provided module path', async () => {
    authMock.mockResolvedValue({ user: { roles: ['platform-admin'] } } as never)

    await expect(validateCabinetResponse('not-registered.items', 'one', {})).resolves.toEqual({
      success: false,
      issues: 'Для ресурса «not-registered.items» не объявлена схема модуля (EARS-436).',
    })
  })
})
