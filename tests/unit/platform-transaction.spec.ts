// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `platformTransaction` — the unit half (spec 201 EARS-6, EARS-7, EARS-24).
 *
 * What is asserted here is what a database cannot show: the ORDER of the
 * statements the helper issues, the refusal it makes before opening a
 * transaction at all, and the normalization of the actor. What the database
 * does with those statements is asserted where it actually happens, in
 * `tests/int/platform/audit-*.int.spec.ts`.
 *
 * The pool is mocked rather than reached: this tier is DB-free (it is the only
 * one `pnpm test:unit` runs in CI), and the subject is the helper's own logic.
 */

type Issued = { sql: string; params: unknown[] }

const issued: Issued[] = []
let transactionCalls = 0

const fakeTx = {
  execute: vi.fn(async (query: { toString?: () => string }) => {
    // drizzle's `sql` template exposes its chunks; the readable form is enough
    // for an ORDER assertion, and the parameter list is what carries the actor.
    const inner = query as unknown as { queryChunks?: unknown[] }
    const text = JSON.stringify(inner.queryChunks ?? query)
    // A drizzle `sql` template alternates `StringChunk` objects with the BOUND
    // values themselves, which stay raw primitives in `queryChunks`. The bound
    // values are what carry the actor, so they are exactly the non-objects.
    const params = (inner.queryChunks ?? []).filter((chunk) => typeof chunk !== 'object')
    issued.push({ sql: text, params })
    return { rows: [] }
  }),
}

vi.mock('@/lib/platform/db/client', () => ({
  openPlatformDb: () => ({
    transaction: async <T>(fn: (tx: typeof fakeTx) => Promise<T>) => {
      transactionCalls += 1
      return fn(fakeTx)
    },
  }),
}))

const { platformTransaction } = await import('@/lib/platform/db/transaction')

beforeEach(() => {
  issued.length = 0
  transactionCalls = 0
})

describe('platformTransaction', () => {
  it('EARS-6: issues the audit context before the caller’s first statement', async () => {
    await platformTransaction({ actorEmail: 'anton@bbm.academy', source: 'portal' }, async (tx) => {
      await tx.execute({ queryChunks: ['-- caller'] } as never)
    })

    expect(transactionCalls).toBe(1)
    expect(issued).toHaveLength(2)
    expect(issued[0].sql).toContain('set_config')
    expect(issued[0].sql).toContain('app.actor_email')
    expect(issued[0].sql).toContain('app.source')
    expect(issued[0].params).toEqual(['anton@bbm.academy', 'portal'])
    expect(issued[1].sql).toContain('-- caller')
  })

  it('EARS-6: the advisory lock keeps the FIRST position, the context follows it', async () => {
    // Spec 124 EARS-10 is not disturbed by spec 201: both statements are
    // transaction-scoped, and «first» is load-bearing for the lock (no read may
    // precede mutual exclusion) while the context only has to precede the first
    // audited write.
    await platformTransaction(
      { actorEmail: null, source: 'cli:member-seed' },
      async (tx) => {
        await tx.execute({ queryChunks: ['-- caller'] } as never)
      },
      { lockKey: 1_240_001 },
    )

    expect(issued.map((entry) => entry.sql)).toHaveLength(3)
    expect(issued[0].sql).toContain('pg_advisory_xact_lock')
    expect(issued[1].sql).toContain('set_config')
    expect(issued[2].sql).toContain('-- caller')
  })

  it('EARS-7: an actor-less source passes an empty string, so the trigger reads NULL', async () => {
    await platformTransaction({ actorEmail: null, source: 'migration' }, async () => undefined)
    expect(issued[0].params).toEqual(['', 'migration'])
  })

  it('EARS-7: the actor is normalized to the form `core.member.email` is stored in', async () => {
    await platformTransaction(
      { actorEmail: '  Anton@BBM.Academy ', source: 'portal' },
      async () => undefined,
    )
    expect(issued[0].params).toEqual(['anton@bbm.academy', 'portal'])
  })

  it('EARS-9: `portal` with no actor is refused before a transaction is opened at all', async () => {
    await expect(
      platformTransaction({ actorEmail: '   ', source: 'portal' }, async () => undefined),
    ).rejects.toThrowError(/actorEmail is required/)
    expect(transactionCalls).toBe(0)
    expect(issued).toEqual([])
  })
})

describe('the two mechanisms that keep the helper the only door', () => {
  it('EARS-24: the eslint rule forbids `.transaction(` and a hand-written app.* GUC outside src/lib/platform/db/', async () => {
    // Mechanism 2 of EARS-24, asserted against the config rather than trusted to
    // a comment: a rule that silently loses its selector or its `ignores` would
    // leave the required argument binding only the callers who already chose the
    // helper — which is the exact failure the clause names.
    const config = (await import('../../eslint.config.mjs')).default as Array<{
      files?: string[]
      ignores?: string[]
      rules?: Record<string, unknown>
    }>
    const block = config.find((entry) => entry.rules?.['no-restricted-syntax'])
    expect(block).toBeDefined()
    expect(block?.ignores).toContain('src/lib/platform/db/**')

    const [severity, ...selectors] = block?.rules?.['no-restricted-syntax'] as [
      string,
      ...{ selector: string }[],
    ]
    expect(severity).toBe('error')
    const patterns = selectors.map((entry) => entry.selector)
    expect(patterns).toContain("CallExpression[callee.property.name='transaction']")
    expect(patterns.some((pattern) => pattern.startsWith('Literal[value=/set_config'))).toBe(true)
    expect(
      patterns.some((pattern) => pattern.startsWith('TemplateElement[value.raw=/set_config')),
    ).toBe(true)
  })

  it('EARS-24: `getPlatformDb()` hands out a handle that carries no `.transaction`', async () => {
    // Mechanism 1 is a TYPE, so the compiler is its real test — `PlatformDb` is
    // `Omit<NodePgDatabase, 'transaction'>` and every call site in the repo
    // typechecks against it. What is assertable at runtime is the narrower
    // claim that the module exports the internal escape under its own name, so
    // the two doors stay distinguishable to a reader and to a grep.
    // `importActual`, because this file mocks the module for every other test.
    const client = await vi.importActual<typeof import('@/lib/platform/db/client')>(
      '@/lib/platform/db/client',
    )
    expect(Object.keys(client).sort()).toEqual([
      'PLATFORM_CONNECTION_MARK',
      'closePlatformDb',
      'getPlatformDb',
      'openPlatformDb',
    ])
    expect(client.PLATFORM_CONNECTION_MARK).toBe('-c app.connection=app')
  })
})
