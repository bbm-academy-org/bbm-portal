import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseContractorProcess, type ContractorProcess } from '@/lib/contractor-process'
import {
  layoutProcess,
  routeIsClear,
  wrapText,
  type DiagramLayout,
  type MeasureText,
} from '@/modules/contractor-process/layout'

/**
 * The geometry of «Как работаем с исполнителями» (#545): a pure port of the
 * approved visual's renderer (`design-source/finance/contractor-process.visual.html`).
 *
 * `measure` is a deterministic stand-in for the canvas `measureText` the view
 * passes: width = characters × font size × 0.6. The coordinates pinned in
 * «matches the visual» were produced by running the VENDORED renderer's own
 * script in Node with a fake DOM and this very stub — so they are the
 * visual's numbers, not this module's restated.
 */

const repoRoot = join(import.meta.dirname, '..', '..')

const measure: MeasureText = (text, font) => {
  const px = Number(/(\d+)px/.exec(font)?.[1] ?? 14)
  return text.length * px * 0.6
}

function load(relative: string): ContractorProcess {
  const parsed = parseContractorProcess(readFileSync(join(repoRoot, relative), 'utf8'))
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
  return parsed.process
}

const example = load('content/finance/contractor-process.example.json')
const fullShape = load('tests/fixtures/contractor-process/full-shape.json')

function overlaps(d: DiagramLayout): string[] {
  const out: string[] = []
  for (let i = 0; i < d.steps.length; i++)
    for (let j = i + 1; j < d.steps.length; j++) {
      const a = d.steps[i]
      const b = d.steps[j]
      if (
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
      )
        out.push(`${a.step.id} × ${b.step.id}`)
    }
  return out
}

describe('contractor-process layout — matches the visual', () => {
  const { main, sub, nodeHeight } = layoutProcess(example, measure)
  const at = (d: DiagramLayout, id: string) => d.steps.find((s) => s.step.id === id)!

  it('sizes the diagrams as the visual does (viewBox 0 0 1096 426 and 0 0 880 384)', () => {
    expect([main.width, main.height]).toEqual([1096, 426])
    expect([sub?.width, sub?.height]).toEqual([880, 384])
    // The box grows to the longest title, at least four lines: 4 × 17 + 24.
    expect(nodeHeight).toBe(92)
  })

  it('places steps on the same coordinates as the visual', () => {
    expect(at(main, 'e1')).toMatchObject({
      cx: 228,
      cy: 110,
      x: 163,
      y: 64,
      width: 130,
      height: 92,
    })
    expect(at(main, 'd1')).toMatchObject({
      cx: 696,
      cy: 110,
      x: 626,
      y: 56,
      width: 140,
      height: 108,
    })
    expect(at(main, 'e4')).toMatchObject({ cx: 852, cy: 358, x: 787, y: 312 })
    expect(at(sub!, 'p3')).toMatchObject({ cx: 750, cy: 316, x: 685, y: 270 })
    expect(at(sub!, 'p3').lines).toEqual(['Обновляет', 'условия', 'оплаты'])
  })

  it('routes the forward edges and places their labels as the visual does', () => {
    const route = (d: DiagramLayout, from: string, to: string) =>
      d.edges.find((e) => e.edge.from === from && e.edge.to === to)!
    expect(route(main, 'e1', 'e2').points).toEqual([
      [293, 110],
      [306, 110],
      [306, 234],
      [319, 234],
    ])
    expect(route(main, 'e2', 'e3').points).toEqual([
      [449, 234],
      [475, 234],
    ])
    const yes = route(main, 'd1', 'e4')
    expect(yes.points).toEqual([
      [766, 110],
      [774, 110],
      [774, 358],
      [787, 358],
    ])
    expect(yes.label).toEqual({ x: 780, y: 225, width: 25, height: 18 })
    expect(route(sub!, 'p2', 'p3').label).toEqual({ x: 678, y: 245, width: 90, height: 18 })
  })
})

describe('contractor-process layout — invariants', () => {
  for (const [name, process] of [
    ['the public example', example],
    ['the full-shape fixture', fullShape],
  ] as const) {
    describe(name, () => {
      const layout = layoutProcess(process, measure)
      const diagrams = [layout.main, ...(layout.sub ? [layout.sub] : [])]

      it('lets no two steps overlap', () => {
        for (const d of diagrams) expect(overlaps(d)).toEqual([])
      })

      it('gives every edge an orthogonal route that crosses no other step', () => {
        for (const d of diagrams) {
          expect(d.edges).toHaveLength(d.edges.length)
          for (const e of d.edges) {
            expect(e.points.length).toBeGreaterThanOrEqual(2)
            for (let i = 0; i < e.points.length - 1; i++) {
              const [p, q] = [e.points[i], e.points[i + 1]]
              expect(p[0] === q[0] || p[1] === q[1]).toBe(true)
            }
            const a = d.steps.find((s) => s.step.id === e.edge.from)!
            const b = d.steps.find((s) => s.step.id === e.edge.to)!
            expect(routeIsClear(e.points, a, b, d.steps), `${e.edge.from}→${e.edge.to}`).toBe(true)
          }
        }
      })

      it('routes an edge back to an earlier column (the visual has no route for it)', () => {
        const back = layout.main.edges.find((e) => {
          const a = layout.main.steps.find((s) => s.step.id === e.edge.from)!
          const b = layout.main.steps.find((s) => s.step.id === e.edge.to)!
          return b.step.col < a.step.col
        })
        expect(back).toBeDefined()
        expect(back!.points.length).toBeGreaterThanOrEqual(2)
      })

      it('keeps every step inside its own lane and the diagram', () => {
        for (const d of diagrams)
          for (const s of d.steps) {
            const lane = d.lanes[s.laneIndex]
            expect(s.y).toBeGreaterThanOrEqual(lane.y)
            expect(s.y + s.height).toBeLessThanOrEqual(lane.y + lane.height)
            expect(s.x + s.width).toBeLessThanOrEqual(d.width)
          }
      })

      it('is deterministic', () => {
        expect(layoutProcess(process, measure)).toEqual(layout)
      })
    })
  }

  it('lays the subprocess out separately: its own grid, no stage header', () => {
    const { main, sub } = layoutProcess(example, measure)
    expect(sub).not.toBeNull()
    expect(sub!.stages).toEqual([])
    expect(sub!.top).toBe(6)
    expect(sub!.columnWidth).toBe(240)
    expect(main.top).toBe(48)
    expect(sub!.steps.map((s) => s.step.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('draws no subprocess when the data has none', () => {
    const { subprocess: _omit, ...rest } = example
    expect(layoutProcess(rest, measure).sub).toBeNull()
  })

  it('marks open steps and lanes with a chip and automatable steps with a tag', () => {
    const { main } = layoutProcess(example, measure)
    const e3 = main.steps.find((s) => s.step.id === 'e3')!
    expect(e3.chip).toBeDefined()
    expect(e3.autoTag).toBeUndefined()
    const e2 = main.steps.find((s) => s.step.id === 'e2')!
    expect(e2.autoTag).toBeDefined()
    expect(main.lanes.find((l) => l.lane.id === 'l2')!.chip).toBeDefined()
    expect(main.stages.map((s) => s.separator)).toEqual([false, true, true])
  })
})

describe('wrapText', () => {
  it('wraps greedily and never splits a word', () => {
    expect(wrapText('Обновляет условия оплаты', 110, '14px x', measure)).toEqual([
      'Обновляет',
      'условия',
      'оплаты',
    ])
  })

  it('cuts to maxLines with an ellipsis', () => {
    expect(wrapText('один два три четыре', 30, '10px x', measure, 2)).toEqual(['один', '…'])
  })
})
