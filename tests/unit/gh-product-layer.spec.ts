import { describe, expect, it } from 'vitest'

import {
  WAIVER_FORM,
  productLayerError,
  productLayerPaths,
  productLayerStatus,
  stripNonEvidence,
  waiverRecord,
} from '../../tools/gh/lib/product-layer.mjs'

/**
 * An epic parent must either name its product layer (`docs/product/**`) or carry
 * an explicit, recorded waiver (#321). The predicate is pure, so both callers —
 * `pnpm issue:create` (fail-closed at filing time) and `pnpm backlog:triage`
 * (a flag row for the existing corpus) — share one source of truth.
 * Canon: `.claude/skills/task-canon/SKILL.md` §1 (epic).
 */

describe('stripNonEvidence', () => {
  it('drops fenced blocks — a quoted example is never evidence', () => {
    const text = 'intro\n```\ndocs/product/finance/brief.md\n```\ntail'
    expect(stripNonEvidence(text)).not.toContain('docs/product/finance/brief.md')
    expect(stripNonEvidence(text)).toContain('intro')
  })

  it('drops tilde fences too', () => {
    expect(stripNonEvidence('~~~\nproduct-layer: waived — X, 2026-08-25\n~~~')).not.toContain(
      'waived',
    )
  })

  it('drops HTML comments — the template instructions are not a record', () => {
    expect(stripNonEvidence('<!-- product-layer: waived — Anton, 2026-08-25 -->')).not.toContain(
      'waived',
    )
  })
})

describe('productLayerPaths', () => {
  it('finds a brief path', () => {
    expect(productLayerPaths('see docs/product/finance/brief.md for the framing')).toEqual([
      'docs/product/finance/brief.md',
    ])
  })

  it('finds a per-feature PRD path', () => {
    expect(productLayerPaths('- [`docs/product/portal-workspace/311-product.md`](x)')).toEqual([
      'docs/product/portal-workspace/311-product.md',
    ])
  })

  it('accepts the epic folder itself, with or without a trailing slash', () => {
    expect(productLayerPaths('docs/product/finance/')).toEqual(['docs/product/finance/'])
    expect(productLayerPaths('docs/product/finance')).toEqual(['docs/product/finance'])
  })

  it('does NOT accept the bare docs/product/ root', () => {
    expect(productLayerPaths('the product layer lives in docs/product/')).toEqual([])
  })

  it('does NOT accept the glob — describing the rule is not naming an artifact', () => {
    expect(productLayerPaths('its body must name a docs/product/** file')).toEqual([])
  })

  it('deduplicates and preserves first-occurrence order', () => {
    const body =
      'docs/product/finance/brief.md and docs/product/finance/f1.md, docs/product/finance/brief.md'
    expect(productLayerPaths(body)).toEqual([
      'docs/product/finance/brief.md',
      'docs/product/finance/f1.md',
    ])
  })

  it('ignores a path that only appears inside a fenced example', () => {
    expect(productLayerPaths('```\ndocs/product/finance/brief.md\n```')).toEqual([])
  })
})

describe('waiverRecord', () => {
  it('reads the canonical form with its tail', () => {
    const rec = waiverRecord('product-layer: waived — Anton, 2026-08-25')
    expect(rec?.tail).toBe('Anton, 2026-08-25')
    expect(rec?.line).toBe('product-layer: waived — Anton, 2026-08-25')
    expect(rec?.complete).toBe(true)
  })

  it('accepts a list item and an ASCII dash', () => {
    expect(waiverRecord('- product-layer: waived - Anton, 2026-08-25')?.complete).toBe(true)
  })

  it('is case-insensitive on the marker', () => {
    expect(waiverRecord('Product-Layer: WAIVED — Anton, 2026-08-25')?.complete).toBe(true)
  })

  it('records a bare marker but does NOT call it complete — the tail is part of the record', () => {
    const rec = waiverRecord('product-layer: waived')
    expect(rec).not.toBeNull()
    expect(rec?.complete).toBe(false)
  })

  it('treats an unfilled placeholder tail as incomplete', () => {
    expect(waiverRecord('product-layer: waived — <owner, date>')?.complete).toBe(false)
    expect(waiverRecord('product-layer: waived — TBD')?.complete).toBe(false)
  })

  it('returns null when no marker is present', () => {
    expect(waiverRecord('## Context\n\nnothing here')).toBeNull()
  })

  it('ignores the marker inside a fenced example', () => {
    expect(waiverRecord('```\nproduct-layer: waived — Anton, 2026-08-25\n```')).toBeNull()
  })
})

describe('productLayerStatus', () => {
  it('passes on a named product-layer path', () => {
    const s = productLayerStatus('links docs/product/finance/brief.md')
    expect(s.ok).toBe(true)
    expect(s.kind).toBe('path')
    expect(s.paths).toEqual(['docs/product/finance/brief.md'])
  })

  it('passes on a complete waiver and carries the line for printing', () => {
    const s = productLayerStatus('product-layer: waived — Anton, 2026-08-25')
    expect(s.ok).toBe(true)
    expect(s.kind).toBe('waiver')
    expect(s.waiver?.tail).toBe('Anton, 2026-08-25')
  })

  it('fails when neither is present', () => {
    const s = productLayerStatus('## Context\n\nsome technical framing')
    expect(s.ok).toBe(false)
    expect(s.kind).toBe('missing')
  })

  it('fails a tail-less waiver as its own kind, not as «missing»', () => {
    const s = productLayerStatus('product-layer: waived')
    expect(s.ok).toBe(false)
    expect(s.kind).toBe('waiver-incomplete')
  })

  it('prefers the path when both are present', () => {
    const s = productLayerStatus(
      'docs/product/finance/brief.md\nproduct-layer: waived — A, 2026-08-25',
    )
    expect(s.kind).toBe('path')
  })
})

describe('productLayerError', () => {
  it('is null when the body clears the gate', () => {
    expect(productLayerError('docs/product/finance/brief.md')).toBeNull()
  })

  it('names BOTH cures and the exact waiver form', () => {
    const msg = productLayerError('nothing') ?? ''
    expect(msg).toContain('do-product-discovery')
    expect(msg).toContain('docs/product/')
    expect(msg).toContain(WAIVER_FORM)
  })

  it('tells a tail-less waiver what its tail must carry', () => {
    const msg = productLayerError('product-layer: waived') ?? ''
    expect(msg).toMatch(/tail/i)
    expect(msg).toContain(WAIVER_FORM)
  })
})
