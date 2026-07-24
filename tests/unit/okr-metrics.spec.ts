import { describe, expect, it } from 'vitest'
import { parseMetrics } from '@/lib/okr/metrics'

describe('parseMetrics (metrics.yaml, FR-3)', () => {
  it('parses kr_id → {current, target, unit, as_of}', () => {
    const parsed = parseMetrics(
      ['kr3-1:', '  current: 0', '  target: 10', '  unit: экспертов', '  as_of: 2026-07-24'].join('\n'),
    )
    expect(parsed['kr3-1']).toEqual({ current: 0, target: 10, unit: 'экспертов', asOf: '2026-07-24' })
  })

  it('accepts null current/target (metric not connected / target not set)', () => {
    const parsed = parseMetrics(['kr2-1:', '  current: null', '  target: 500', '  unit: MAU'].join('\n'))
    expect(parsed['kr2-1'].current).toBeNull()
    expect(parsed['kr2-1'].target).toBe(500)
  })

  it('empty file → no metrics, every KR runs in execution mode', () => {
    expect(parseMetrics('')).toEqual({})
    expect(parseMetrics('# только комментарий\n')).toEqual({})
  })

  it('rejects non-numeric values and non-mapping entries loudly', () => {
    expect(() => parseMetrics('kr1-1: 5\n')).toThrow(/must be a mapping/)
    expect(() => parseMetrics(['kr1-1:', '  current: сто'].join('\n'))).toThrow(/must be a number/)
    expect(() => parseMetrics('- a\n- b\n')).toThrow(/expected a mapping/)
  })
})
