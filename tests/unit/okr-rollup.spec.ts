import { describe, expect, it } from 'vitest'
import { avg, executionPct, expectedShare, health, inGracePeriod, metricPct } from '@/lib/okr/rollup'

const PERIOD = { start: '2026-07-01', end: '2026-09-01' }
// Period is 62 days; grace (14 days) ends 2026-07-15.
const AFTER_GRACE = new Date('2026-08-01T00:00:00Z') // elapsed 31/62 = 50%

describe('avg (§3 p.3–4: unweighted mean, undefined values stay out)', () => {
  it('averages defined values only', () => {
    expect(avg([50, null, 100])).toBe(75)
  })
  it('returns null when nothing is defined — not 0 (FR-4)', () => {
    expect(avg([null, null])).toBeNull()
    expect(avg([])).toBeNull()
  })
})

describe('executionPct (§3 p.1: flat closed/total)', () => {
  it('computes closed / all tasks', () => {
    expect(executionPct({ done: 3, total: 12 })).toBe(25)
  })
  it('empty module → null («не определено»), not 0', () => {
    expect(executionPct(null)).toBeNull()
    expect(executionPct({ done: 0, total: 0 })).toBeNull()
  })
})

describe('metricPct (§3 p.2: min(current/target, 1))', () => {
  it('computes and caps at 100%', () => {
    expect(metricPct({ current: 5, target: 10 })).toBe(50)
    expect(metricPct({ current: 15, target: 10 })).toBe(100)
  })
  it('not live (no current or no target) → null → execution mode', () => {
    expect(metricPct(null)).toBeNull()
    expect(metricPct({ current: null, target: 500 })).toBeNull()
    expect(metricPct({ current: 3, target: null })).toBeNull()
    expect(metricPct({ current: 3, target: 0 })).toBeNull()
  })
})

describe('expectedShare (§3 p.5: linear share of the period)', () => {
  it('is 0 before the period and 1 after', () => {
    expect(expectedShare(PERIOD, new Date('2026-06-01'))).toBe(0)
    expect(expectedShare(PERIOD, new Date('2026-10-01'))).toBe(1)
  })
  it('is linear inside the period', () => {
    expect(expectedShare(PERIOD, AFTER_GRACE)).toBeCloseTo(0.5, 2)
  })
})

describe('health (70% rule + OQ-6 grace period)', () => {
  it('null pct is always undef', () => {
    expect(health(null, PERIOD, AFTER_GRACE)).toBe('undef')
  })
  it('applies the 70/40 thresholds vs linear expectation', () => {
    // expected = 50%; on: ≥35, risk: ≥20, behind: <20
    expect(health(40, PERIOD, AFTER_GRACE)).toBe('on')
    expect(health(25, PERIOD, AFTER_GRACE)).toBe('risk')
    expect(health(10, PERIOD, AFTER_GRACE)).toBe('behind')
  })
  it('does not judge during the grace period (OQ-6 proposal)', () => {
    const inGrace = new Date('2026-07-05T00:00:00Z')
    expect(inGracePeriod(PERIOD, inGrace)).toBe(true)
    expect(health(0, PERIOD, inGrace)).toBe('on')
    // …but honest emptiness still wins over the grace period
    expect(health(null, PERIOD, inGrace)).toBe('undef')
  })
  it('judges normally right after the grace period', () => {
    const justAfter = new Date('2026-07-16T00:00:00Z')
    expect(inGracePeriod(PERIOD, justAfter)).toBe(false)
    expect(health(0, PERIOD, justAfter)).toBe('behind')
  })
})
