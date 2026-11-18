// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { displayRateBasis, type DisplayRateRequestSnapshot } from '@/lib/finance/fx/display-rate'

/**
 * Which rate a request's display conversion uses (spec
 * `docs/specs/339-ledger-intake.md` §I, EARS-550) and the isolation of the CBR
 * rates from the ledger (EARS-553), issue #548.
 */
const TODAY = '2026-11-17'

function request(overrides: Partial<DisplayRateRequestSnapshot>): DisplayRateRequestSnapshot {
  return {
    currency: 'USD',
    status: 'approved',
    alreadyPaid: false,
    occurredOn: null,
    posting: null,
    ...overrides,
  }
}

describe('the display rate rule (EARS-550)', () => {
  it('EARS-550: an unpaid request converts at the CBR rate for today (Moscow)', () => {
    for (const status of ['draft', 'submitted', 'approved'] as const) {
      expect(displayRateBasis(request({ status, occurredOn: '2026-10-01' }), 'RUB', TODAY)).toEqual(
        {
          kind: 'cbr',
          date: TODAY,
          reason: 'unpaid',
        },
      )
    }
  })

  it("EARS-550: a member's already-paid, unposted request converts at the CBR rate on its occurred_on", () => {
    const basis = displayRateBasis(
      request({ status: 'submitted', alreadyPaid: true, occurredOn: '2026-09-14' }),
      'RUB',
      TODAY,
    )
    expect(basis).toEqual({ kind: 'cbr', date: '2026-09-14', reason: 'occurred_on' })
  })

  it('EARS-550: an already-paid request from a company account, unposted, converts at its occurred_on', () => {
    // The rule reads `already_paid`, whatever paid it: personal_funds is not an input.
    const basis = displayRateBasis(
      request({ status: 'approved', alreadyPaid: true, occurredOn: '2026-10-03' }),
      'EUR',
      TODAY,
    )
    expect(basis).toEqual({ kind: 'cbr', date: '2026-10-03', reason: 'occurred_on' })
  })

  it('EARS-550: already paid with NO occurred_on falls back to today', () => {
    const basis = displayRateBasis(
      request({ status: 'submitted', alreadyPaid: true, occurredOn: null }),
      'RUB',
      TODAY,
    )
    expect(basis).toEqual({ kind: 'cbr', date: TODAY, reason: 'occurred_on_missing' })
  })

  it("EARS-550: a posted request with no ledger amount or step for the pair converts at the CBR rate on the OPERATION's occurred_on, never posted_at", () => {
    const basis = displayRateBasis(
      request({
        status: 'posted',
        alreadyPaid: true,
        // The request's own date and the posting moment both differ on purpose.
        occurredOn: '2026-09-01',
        posting: {
          operationOccurredOn: '2026-09-20',
          postedAt: '2026-11-10T09:00:00Z',
          accountAmounts: [{ currency: 'USD', amount: -5_000n }],
          conversionSteps: [],
        },
      }),
      'RUB',
      TODAY,
    )
    expect(basis).toEqual({ kind: 'cbr', date: '2026-09-20', reason: 'operation_occurred_on' })
  })

  it('EARS-550: a posted cross-currency payment that already holds the display currency shows the ledger amount', () => {
    const basis = displayRateBasis(
      request({
        status: 'posted',
        posting: {
          operationOccurredOn: '2026-09-20',
          postedAt: '2026-09-21T09:00:00Z',
          // A USD invoice paid from a RUB card: the account side lost 4 150.00 ₽.
          accountAmounts: [{ currency: 'RUB', amount: -415_000n }],
          conversionSteps: [],
        },
      }),
      'RUB',
      TODAY,
    )
    expect(basis).toEqual({ kind: 'ledger_amount', amount: 415_000n })
  })

  it('EARS-550: a posted request whose recorded conversion step covers the pair uses that step, in either direction', () => {
    const steps = [
      { fromCurrency: 'RUB', toCurrency: 'USD', fromAmount: 830_000n, toAmount: 10_000n },
    ]
    const posting = {
      operationOccurredOn: '2026-09-20',
      postedAt: '2026-09-21T09:00:00Z',
      accountAmounts: [],
      conversionSteps: steps,
    }
    // USD → RUB reads the step backwards: 8 300.00 ₽ per 100.00 $.
    expect(displayRateBasis(request({ status: 'posted', posting }), 'RUB', TODAY)).toEqual({
      kind: 'ledger_step',
      numerator: 830_000n,
      denominator: 10_000n,
    })
    // A RUB request displayed in USD reads it forwards.
    expect(
      displayRateBasis(request({ currency: 'RUB', status: 'posted', posting }), 'USD', TODAY),
    ).toEqual({ kind: 'ledger_step', numerator: 10_000n, denominator: 830_000n })
  })

  it('EARS-550: a request already in the display currency needs no rate at all', () => {
    expect(displayRateBasis(request({ currency: 'RUB' }), 'RUB', TODAY)).toEqual({
      kind: 'same_currency',
    })
  })

  it('EARS-550: a posted status without its posting facts is a caller defect, not a silent today', () => {
    expect(() =>
      displayRateBasis(request({ status: 'posted', posting: null }), 'RUB', TODAY),
    ).toThrow()
  })
})

describe('CBR rates are a presentation source only (EARS-553)', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const SRC = join(ROOT, 'src')
  const FX_TABLE = 'schema/finance/finance-fx-rate'
  const FX_DIR = 'src/lib/finance/fx/'

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) return walk(full)
      return /\.(ts|tsx|mjs)$/.test(name) ? [full] : []
    })
  }
  const files = walk(SRC).map((f) => ({
    path: relative(ROOT, f).replaceAll('\\', '/'),
    text: readFileSync(f, 'utf8'),
  }))

  it('EARS-553: only the fx directory of the finance module reads the rate table', () => {
    const readers = files.filter((f) => f.text.includes(FX_TABLE)).map((f) => f.path)
    expect(readers.length).toBeGreaterThan(0)
    for (const path of readers) expect(path.startsWith(FX_DIR)).toBe(true)
  })

  it('EARS-553: no posting, conversion, balance, current-money or report code imports the fx directory', () => {
    const ledgerSide = files.filter(
      (f) =>
        f.path.startsWith('src/lib/finance/') &&
        !f.path.startsWith(FX_DIR) &&
        f.path !== 'src/lib/finance/index.ts',
    )
    expect(ledgerSide.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        'src/lib/finance/operations.ts',
        'src/lib/finance/conversions.ts',
        'src/lib/finance/current-money.ts',
        'src/lib/finance/queries.ts',
        'src/lib/finance/intake/posting.ts',
      ]),
    )
    for (const f of ledgerSide) {
      expect(f.text, f.path).not.toMatch(/from ['"](\.\.?\/)+fx\//)
      expect(f.text, f.path).not.toMatch(/from ['"]@\/lib\/finance\/fx\//)
    }
  })

  // The fx functions are also re-exported from the `@/lib/finance` barrel, so a
  // path check alone misses `import { convertForDisplay } from '@/lib/finance'`
  // in a report or F1b surface under src/app/**. The rule is therefore on the
  // identifiers, everywhere in src/** and tools/**: only the requests queue
  // display (spec 339 §Out of scope: «outside the requests queue display»), the
  // fx directory itself, the barrel that re-exports it and the sync CLI may use
  // them.
  const FX_VALUE_EXPORTS = [
    'convertForDisplay',
    'rateOn',
    'convertAtRubRates',
    'syncCbrRates',
    'latestRateDate',
    'displayRateBasis',
    'roundExact',
    'moscowToday',
    // §J — the market valuation read model (EARS-557…562, #558).
    'rateSeries',
    'pickMarketRate',
    'marketRateOn',
    'classifyIntakeItem',
    'measureIntakeItem',
    'measureChain',
    'overpaymentOf',
    'overpaymentWording',
    'aggregateMarket',
    'groupMarket',
    'displayMarketTotals',
    'loadMarketEntries',
    'marketEntryForItem',
    'loadMarketValuation',
    'loadMarketContext',
    'marketQuoteCurrency',
  ]
  const FX_CONSUMERS_ALLOWED = [
    FX_DIR,
    'src/lib/finance/index.ts',
    'src/app/(platform)/p/finance/requests/',
    'tools/platform/finance-fx-sync.ts',
  ]
  const isAllowedConsumer = (path: string) =>
    FX_CONSUMERS_ALLOWED.some((allowed) => path === allowed || path.startsWith(allowed))
  // Comments may name the functions (the schema file documents its writer).
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

  it('EARS-553: outside the requests queue nothing uses the fx functions, via the barrel or otherwise', () => {
    const scanned = [
      ...files,
      ...walk(join(ROOT, 'tools')).map((f) => ({
        path: relative(ROOT, f).replaceAll('\\', '/'),
        text: readFileSync(f, 'utf8'),
      })),
    ]
    expect(scanned.some((f) => f.path.startsWith('src/app/'))).toBe(true)
    const pattern = new RegExp(`\\b(${FX_VALUE_EXPORTS.join('|')})\\b`)
    const offenders = scanned
      .filter((f) => !isAllowedConsumer(f.path))
      .filter((f) => {
        const code = stripComments(f.text)
        return pattern.test(code) || /from ['"](@\/lib\/finance|(\.\.?\/)+)[^'"]*\bfx\//.test(code)
      })
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  // The §J read model reads the ledger through its READ functions (EARS-553,
  // rewritten 2026-11-18). Following every relative / `@/lib/finance` import
  // from the fx files catches the barrel too: `@/lib/finance` re-exports the
  // writers, so an fx file importing it reaches them.
  it('EARS-553: no fx file reaches a ledger write path, directly or through what it imports', () => {
    const WRITE_PATHS = [
      'src/lib/finance/operations.ts',
      'src/lib/finance/conversions.ts',
      'src/lib/finance/intake/posting.ts',
      'src/lib/finance/index.ts',
    ]
    const WRITERS =
      /\b(recordOperation\w*|recordConversion\w*|appendPostings|postIntakeItem\w*|reverseOperation)\b/
    const byPath = new Map(files.map((f) => [f.path, f.text]))
    const resolveImport = (from: string, spec: string): string | null => {
      let base: string
      if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`
      else if (spec.startsWith('.')) base = join(dirname(from), spec).replaceAll('\\', '/')
      else return null
      if (!base.startsWith('src/lib/finance')) return null
      for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
        if (byPath.has(candidate)) return candidate
      }
      return null
    }
    const fxFiles = files.filter((f) => f.path.startsWith(FX_DIR)).map((f) => f.path)
    expect(fxFiles).toEqual(expect.arrayContaining(['src/lib/finance/fx/market.ts']))
    const reached = new Set<string>()
    const queue = [...fxFiles]
    while (queue.length > 0) {
      const path = queue.pop() as string
      if (reached.has(path)) continue
      reached.add(path)
      const code = stripComments(byPath.get(path) ?? '')
      for (const match of code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const target = resolveImport(path, match[1])
        if (target !== null) queue.push(target)
      }
    }
    expect([...reached].filter((p) => WRITE_PATHS.includes(p))).toEqual([])
    for (const path of reached) {
      expect(stripComments(byPath.get(path) ?? ''), path).not.toMatch(WRITERS)
    }
    // The read model does read the ledger — through a read function outside fx.
    expect(reached.has('src/lib/finance/market-facts.ts')).toBe(true)
  })

  it('EARS-553: the fx directory writes no ledger table', () => {
    const fx = files.filter((f) => f.path.startsWith(FX_DIR))
    expect(fx.length).toBeGreaterThan(0)
    for (const f of fx) {
      for (const ledger of [
        'finance-operation',
        'finance-posting',
        'finance-conversion-step',
        'finance-intake-item',
        'finance-account',
      ]) {
        // A TYPE import (the request status union) carries no table handle.
        const valueImport = new RegExp(`^import (?!type )[^;]*schema/finance/${ledger}'`, 'm')
        expect(f.text, `${f.path} → ${ledger}`).not.toMatch(valueImport)
      }
    }
  })
})
