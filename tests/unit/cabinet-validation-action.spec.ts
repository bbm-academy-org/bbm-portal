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

  it('EARS-436: an admin reaches the registry validator, never a caller-provided module path', async () => {
    authMock.mockResolvedValue({ user: { roles: ['platform-admin'] } } as never)

    await expect(validateCabinetResponse('not-registered.items', 'one', {})).resolves.toEqual({
      success: false,
      issues: 'Для ресурса «not-registered.items» не объявлена схема модуля (EARS-436).',
    })
  })
})
