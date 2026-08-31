import { describe, expect, it } from 'vitest'

describe('finance cabinet contracts (spec 338 EARS-301/306/307/326)', () => {
  it('EARS-326: publishes one strict record/create/update schema per reference', async () => {
    const finance = (await import('@/lib/finance')) as Record<string, unknown>
    const contracts = finance.financeReferenceContracts as
      | Record<
          string,
          {
            record: { safeParse(value: unknown): { success: boolean } }
            create: { safeParse(value: unknown): { success: boolean } }
            update: { safeParse(value: unknown): { success: boolean } }
          }
        >
      | undefined

    expect(Object.keys(contracts ?? {})).toEqual([
      'currencies',
      'accounts',
      'projects',
      'products',
      'purposes',
      'categories',
    ])
    for (const contract of Object.values(contracts ?? {})) {
      expect(contract.record.safeParse({}).success).toBe(false)
      expect(contract.create.safeParse({}).success).toBe(false)
      expect(contract.update.safeParse({ unexpected: true }).success).toBe(false)
    }
  })

  /**
   * The guard decides whether a `[resource]` segment names a real reference.
   * An `in` check also answers true for every Object.prototype key, so
   * `/api/p/finance/admin/toString` slipped past it and blew up downstream
   * instead of answering 404.
   */
  it('EARS-326: rejects inherited prototype keys as reference names', async () => {
    const { isFinanceReferenceResource } = await import('@/lib/finance')

    for (const name of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect(isFinanceReferenceResource(name), name).toBe(false)
    }
    expect(isFinanceReferenceResource('categories')).toBe(true)
  })

  it('EARS-306/307: requires purpose binding and category allocability', async () => {
    const { financeReferenceContracts } = await import('@/lib/finance')

    expect(
      financeReferenceContracts.purposes.create.safeParse({ name: 'Продакшн урока' }).success,
    ).toBe(false)
    expect(
      financeReferenceContracts.categories.create.safeParse({ name: 'Продакшн' }).success,
    ).toBe(false)
  })
})
