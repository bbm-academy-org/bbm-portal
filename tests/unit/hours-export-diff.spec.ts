import { describe, expect, it } from 'vitest'

import {
  compareExports,
  diffJson,
  serializeExport,
  verdictLines,
} from '../../tools/platform/hours-export-diff'

/**
 * The semantic diff behind the cutover verdict (spec 124 EARS-27).
 *
 * Unit tier because the diff is pure: it takes the pre-import export and the
 * post-import export and answers «identical, or these paths». The clause itself
 * is exercised end-to-end against the database in
 * `tests/int/platform/hours-import.int.spec.ts`; here the shapes that must not
 * silently pass — a changed digit deep in an unrounded snapshot, a reordered
 * array, a missing key, a null where a number was — are pinned one by one.
 */
describe('serializeExport', () => {
  it('serializes the way the owner export does — two-space JSON, key order kept', () => {
    expect(serializeExport({ b: 1, a: [2] })).toBe('{\n  "b": 1,\n  "a": [\n    2\n  ]\n}')
  })
})

describe('diffJson', () => {
  it('reports nothing for two structurally identical documents', () => {
    const doc = { participants: [{ email: 'a@b.c', fork_min: null }], periods: [] }
    expect(diffJson(doc, structuredClone(doc))).toEqual([])
  })

  it('names the JSON path of a changed leaf, with both values', () => {
    const diff = diffJson(
      { assessments: [{ hourly_rate: 1163.0465116279069 }] },
      { assessments: [{ hourly_rate: 1163.05 }] },
    )
    expect(diff).toHaveLength(1)
    expect(diff[0].path).toBe('assessments[0].hourly_rate')
    // `1163.0465116279069` and `1163.046511627907` are the SAME double; the
    // renderer prints the shortest round-trip form, which is the form the export
    // carries too.
    expect(diff[0].source).toBe('1163.046511627907')
    expect(diff[0].core).toBe('1163.05')
  })

  it('does not confuse a null snapshot with a zero one', () => {
    expect(diffJson({ monthly_rate: null }, { monthly_rate: 0 })).toEqual([
      { path: 'monthly_rate', source: 'null', core: '0' },
    ])
  })

  it('reports a reordered array element-wise — order is a correctness property (EARS-21)', () => {
    const diff = diffJson({ periods: ['june', 'july'] }, { periods: ['july', 'june'] })
    expect(diff.map((entry) => entry.path)).toEqual(['periods[0]', 'periods[1]'])
  })

  it('reports a length difference as the extra index, not as a whole-array mismatch', () => {
    const diff = diffJson({ messages: [1] }, { messages: [1, 2] })
    expect(diff).toEqual([{ path: 'messages[1]', source: '<missing>', core: '2' }])
  })

  it('reports a missing key on either side', () => {
    expect(diffJson({ role: 'Дизайнер' }, {})).toEqual([
      { path: 'role', source: '"Дизайнер"', core: '<missing>' },
    ])
    expect(diffJson({}, { role: null })).toEqual([
      { path: 'role', source: '<missing>', core: 'null' },
    ])
  })

  it('reports the root when the two sides are different kinds of value', () => {
    expect(diffJson([], {}).map((entry) => entry.path)).toEqual(['<root>'])
  })
})

describe('compareExports', () => {
  it('is identical for the same document — byte-identical serialization included', () => {
    const doc = { participants: [], periods: [], assessments: [], publications: [] }
    const comparison = compareExports(doc, structuredClone(doc))
    expect(comparison).toMatchObject({ identical: true, byteIdentical: true, paths: [] })
    expect(verdictLines(comparison)).toEqual(['VERDICT: identical'])
  })

  it('drops an undefined-valued key on both sides, exactly as JSON.stringify does', () => {
    expect(compareExports({ role: undefined }, {}).identical).toBe(true)
  })

  it('reports differing paths and a non-identical verdict', () => {
    const comparison = compareExports(
      { periods: [{ label: 'Июнь' }] },
      { periods: [{ label: 'Июль' }] },
    )
    expect(comparison.identical).toBe(false)
    expect(comparison.paths.map((entry) => entry.path)).toEqual(['periods[0].label'])
    expect(verdictLines(comparison)[0]).toBe('VERDICT: differs — 1 path(s)')
    expect(verdictLines(comparison)[1]).toContain('periods[0].label')
  })

  it('catches a key-order-only difference too — the export is a byte contract (EARS-11)', () => {
    const comparison = compareExports(
      { email: 'a@b.c', name: 'Вася' },
      { name: 'Вася', email: 'a@b.c' },
    )
    expect(comparison.byteIdentical).toBe(false)
    expect(comparison.identical).toBe(false)
    expect(comparison.paths).toHaveLength(1)
    expect(comparison.paths[0].path).toBe('<serialization>')
  })
})
