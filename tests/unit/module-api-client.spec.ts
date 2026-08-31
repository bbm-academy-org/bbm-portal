import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createModuleApiClient } from '@/lib/platform/cabinet'

const ok = (body: unknown) => Response.json(body)

describe('the shared typed module API client', () => {
  it('parses singleton and nested-resource envelopes through the supplied module validator', async () => {
    const validateResponse = vi.fn(
      async (_resource: string, _envelope: string, payload: unknown) => ({
        success: true as const,
        data: payload,
      }),
    )
    const fetchImpl = vi.fn(async () =>
      ok({ data: { id: 7, value: 'anna' } }),
    ) as unknown as typeof fetch
    const client = createModuleApiClient({ validateResponse, fetchImpl })

    const record = await client.one<{ id: number; value: string }>({
      resource: 'member.aliases',
      path: '/member/admin/members/7/aliases/11',
    })

    expect(record).toEqual({ id: 7, value: 'anna' })
    expect(validateResponse).toHaveBeenCalledWith('member.aliases', 'one', {
      data: { id: 7, value: 'anna' },
    })
  })

  it('sends workflow actions with JSON headers and keeps the module refusal message', async () => {
    const validateResponse = vi.fn()
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { code: 'conflict', message: 'preview is stale' } }, { status: 409 }),
    ) as unknown as typeof fetch
    const client = createModuleApiClient({ validateResponse, fetchImpl })

    await expect(
      client.one({
        resource: 'hours.publication',
        path: '/hours/admin/publication',
        init: { method: 'POST', body: JSON.stringify({ periodId: '2026-08' }) },
      }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'preview is stale' })
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/p/hours/admin/publication',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          accept: 'application/json',
          'content-type': 'application/json',
        }),
      }),
    )
  })

  it('is the one envelope and error path for nested, singleton and workflow screens', () => {
    const files = [
      'src/app/(platform)/p/admin/member/members/AliasPanel.tsx',
      'src/app/(platform)/p/admin/hours/publication/HoursPublicationScreen.tsx',
      'src/app/(platform)/p/admin/okr/parameters/OkrParametersScreen.tsx',
    ]

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source, file).toContain('createModuleApiClient')
      expect(source, file).not.toMatch(/response\.json\(|\bfetch\(/)
    }
  })
})
