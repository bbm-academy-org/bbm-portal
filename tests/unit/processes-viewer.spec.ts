import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { assembleModel, type Idef0Model } from '@/lib/processes'

/**
 * The IDEF0 viewer PORTED from bbm-kb (#553, spec 553 EARS-609..614). The
 * viewer is a browser module that measures text on a canvas when it loads;
 * jsdom has no canvas, so a deterministic measure (7 px per character) stands
 * in — the layout rules under test do not depend on the exact width. The
 * model is the invented example committed in `content/processes/example/`.
 */

const EXAMPLE = join(import.meta.dirname, '..', '..', 'content', 'processes', 'example')
const read = (file: string) => readFileSync(join(EXAMPLE, file), 'utf8')

function exampleModel(): Idef0Model {
  const result = assembleModel({
    index: read('model/index.yaml'),
    diagrams: {
      'A-0.yaml': read('model/A-0.yaml'),
      'A0.yaml': read('model/A0.yaml'),
      'A2.yaml': read('model/A2.yaml'),
    },
    registry: read('registry-ru.md'),
    process: read('process-to-be-ru.md'),
  })
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result.model
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the ported viewer is untyped JS */
let viewer: any
const el = React.createElement

beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => ({
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  })) as any
  viewer = await import('@/modules/processes/idef0/viewer.mjs')
})

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
})
afterEach(cleanup)

const diagram = (model: Idef0Model, id: string) => model.diagrams.find((d) => d.id === id)!

describe('levels and the URL hash (spec 553 EARS-609)', () => {
  it('EARS-609: the hash names the level; absent or malformed falls back to the root', () => {
    window.location.hash = '#A2'
    expect(viewer.readHash('A-0')).toBe('A2')
    window.location.hash = ''
    expect(viewer.readHash('A-0')).toBe('A-0')
    window.location.hash = '#%E0'
    expect(viewer.readHash('A-0')).toBe('A-0')
  })

  it('EARS-609: the viewer opens the level in the hash, the root for an unknown one, and writes what it opens', () => {
    const model = exampleModel()
    window.location.hash = '#A0'
    render(el(viewer.default, { model }))
    const crumbs = screen.getByRole('navigation', { name: 'Уровни модели' })
    expect(crumbs.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('A0')
    cleanup()

    window.location.hash = '#A99'
    render(el(viewer.default, { model }))
    expect(
      screen
        .getByRole('navigation', { name: 'Уровни модели' })
        .querySelector('[aria-current="page"]')
        ?.textContent?.trim(),
    ).toBe('A-0')
  })
})

describe('the layout rules (spec 553 EARS-610)', () => {
  it('EARS-610: boxes stand on the staircase — each next box right of and below the previous', () => {
    const layout = viewer.layoutDiagram(diagram(exampleModel(), 'A0'))
    const boxes = layout.nodes.filter((n: any) => n.type === 'box')
    expect(boxes.map((b: any) => b.id)).toEqual(['A1', 'A2', 'A3'])
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i].position.x).toBeGreaterThan(boxes[i - 1].position.x)
      expect(boxes[i].position.y).toBeGreaterThan(boxes[i - 1].position.y)
    }
  })

  it('EARS-610: every arrow is routed orthogonally', () => {
    const layout = viewer.layoutDiagram(diagram(exampleModel(), 'A0'))
    expect(layout.edges.length).toBeGreaterThan(0)
    for (const edge of layout.edges) {
      const points = edge.data.points as { x: number; y: number }[]
      for (let i = 1; i < points.length; i += 1) {
        const horizontal = points[i].y === points[i - 1].y
        const vertical = points[i].x === points[i - 1].x
        expect(horizontal || vertical, `${edge.id} segment ${i}`).toBe(true)
      }
    }
  })

  it('EARS-610: ICOM sides — an input enters from the west, a control from the north', () => {
    const layout = viewer.layoutDiagram(diagram(exampleModel(), 'A0'))
    const a1 = layout.nodes.find((n: any) => n.id === 'A1')
    const input = layout.edges.find((e: any) => e.data.arrow.id === 'I1')
    const control = layout.edges.find((e: any) => e.data.arrow.id === 'C1' && e.data.to === 'A1')
    const lastIn = input.data.points.at(-1)
    const lastC = control.data.points.at(-1)
    expect(lastIn.x).toBe(a1.position.x)
    expect(lastC.y).toBe(a1.position.y)
  })

  it('EARS-610: the boundary codes are drawn on the frame', () => {
    const layout = viewer.layoutDiagram(diagram(exampleModel(), 'A0'))
    const frame = layout.nodes.find((n: any) => n.type === 'frame')
    // A code is drawn at every branch that crosses the frame (C1 and M1 fork).
    expect([...new Set(frame.data.codes.map((c: any) => c.code))].sort()).toEqual([
      'C1',
      'I1',
      'M1',
      'O1',
    ])
  })

  it('EARS-610: a diagram it cannot lay out reports why instead of drawing', () => {
    const broken = {
      ...diagram(exampleModel(), 'A0'),
      arrows: [
        { id: 'x', label: 'x', from: { box: 'A9', side: 'O' }, to: { box: 'A1', side: 'I' } },
      ],
    }
    expect(() => viewer.layoutDiagram(broken)).toThrow(/неизвестный блок A9/)
  })
})

describe('the panel (spec 553 EARS-611)', () => {
  it('renders the ported htm markup without React DOM-property warnings (class → className)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const model = exampleModel()
    const { container } = render(
      el(viewer.Details, {
        diagram: diagram(model, 'A0'),
        focus: { type: 'box', id: 'A2' },
        knowledge: model.knowledge,
        knowledgeError: null,
        hasChild: (id: string) => id === 'A2',
        onOpen: () => {},
        onTrace: () => {},
      }),
    )
    const warned = errors.mock.calls.some((args) =>
      String(args[0]).includes('Invalid DOM property'),
    )
    errors.mockRestore()
    expect(warned).toBe(false)
    expect(container.querySelector('.xp-name')).toBeTruthy()
  })

  it('EARS-611: a box shows its arrows by ICOM side, its roles and its registry functions with the TO-BE step', () => {
    const model = exampleModel()
    render(
      el(viewer.Details, {
        diagram: diagram(model, 'A0'),
        focus: { type: 'box', id: 'A2' },
        knowledge: model.knowledge,
        knowledgeError: null,
        hasChild: (id: string) => id === 'A2',
        onOpen: () => {},
        onTrace: () => {},
      }),
    )
    for (const title of ['Входы', 'Управление', 'Выходы', 'Механизмы']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    }
    expect(screen.getByText(/Тесто/)).toBeTruthy()
    expect(screen.getByText('Выпечь хлеб', { selector: '.xp-name' })).toBeTruthy()
    expect(screen.getByText(/Выпечь хлеб в разогретой печи/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Открыть декомпозицию A2' })).toBeTruthy()
  })

  it('EARS-611: an arrow shows its registry objects with their definitions', () => {
    const model = exampleModel()
    render(
      el(viewer.Details, {
        diagram: diagram(model, 'A0'),
        focus: { type: 'arrow', id: 'a1' },
        knowledge: model.knowledge,
        knowledgeError: null,
        hasChild: () => false,
      }),
    )
    expect(screen.getByRole('heading', { name: 'Объекты реестра (1)' })).toBeTruthy()
    expect(screen.getByText('Замешанная заготовка')).toBeTruthy()
  })

  it('EARS-611: the arrows of a box are listed with their other end', () => {
    const rows = viewer.icomOfBox(diagram(exampleModel(), 'A0'), 'A2')
    expect(rows.I.map((r: any) => [r.arrow.id, r.other])).toEqual([['a1', 'A1']])
    expect(rows.O.map((r: any) => [r.arrow.id, r.other])).toEqual([['a2', 'A3']])
    expect(rows.C.map((r: any) => r.arrow.id).sort()).toEqual(['C1', 'a3'])
  })

  it('EARS-615: without the registry the panel says the explanations are unavailable', () => {
    const model = exampleModel()
    render(
      el(viewer.Details, {
        diagram: diagram(model, 'A0'),
        focus: null,
        knowledge: null,
        knowledgeError: 'registry-ru.md (404)',
        hasChild: () => false,
      }),
    )
    expect(screen.getByText(/Пояснения недоступны: registry-ru.md \(404\)/)).toBeTruthy()
  })
})

describe('drill-down and the breadcrumb (spec 553 EARS-612)', () => {
  it('EARS-612: the breadcrumb is the chain from A-0 and opens any level of it', () => {
    const model = exampleModel()
    window.location.hash = '#A2'
    render(el(viewer.default, { model }))
    const crumbs = screen.getByRole('navigation', { name: 'Уровни модели' })
    const buttons = Array.from(crumbs.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(buttons).toEqual(['A-0', 'A0', 'A2'])
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'A0' }))
    })
    expect(window.location.hash).toBe('#A0')
    expect(crumbs.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('A0')
  })

  it('EARS-612: the chain helper walks parents up to the root', () => {
    const model = exampleModel()
    const byId = new Map(model.diagrams.map((d) => [d.id, d]))
    expect(viewer.chainOf(byId, byId.get('A2')).map((d: any) => d.id)).toEqual(['A-0', 'A0', 'A2'])
  })

  it('EARS-612: double-clicking a box with a decomposition opens it', () => {
    const model = exampleModel()
    window.location.hash = '#A0'
    const { container } = render(el(viewer.default, { model }))
    const box = Array.from(container.querySelectorAll('.box')).find((b) =>
      b.textContent?.includes('Выпечь хлеб'),
    )
    expect(box, 'the A2 box is rendered').toBeTruthy()
    expect(box!.querySelector('.drill')).toBeTruthy()
    act(() => {
      fireEvent.doubleClick(box!)
    })
    expect(window.location.hash).toBe('#A2')
  })
})

describe('the header switches (spec 553 EARS-613)', () => {
  it('EARS-613: the tooltip and animation switches are remembered per browser', () => {
    const model = exampleModel()
    render(el(viewer.default, { model }))
    const tooltip = screen.getByRole('checkbox', {
      name: 'Подсказка при наведении',
    }) as HTMLInputElement
    const animation = screen.getByRole('checkbox', { name: 'Анимация стрелок' }) as HTMLInputElement
    expect(tooltip.checked).toBe(true)
    act(() => {
      fireEvent.click(tooltip)
      fireEvent.click(animation)
    })
    expect(window.localStorage.getItem('idef0-viewer:hover-card')).toBe('0')
    expect(viewer.initialHoverCard()).toBe(false)
    expect(viewer.initialAnimate()).toBe(!animation.checked ? false : true)
  })

  it('EARS-613: animation is off by default for a reader who asked for reduced motion', () => {
    const spy = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation(
        (query: string) => ({ matches: query.includes('reduce') }) as MediaQueryList,
      )
    expect(viewer.initialAnimate()).toBe(false)
    spy.mockRestore()
    expect(viewer.initialAnimate()).toBe(true)
  })
})

describe('highlighting (spec 553 EARS-614)', () => {
  it('EARS-614: a focused box lights its own arrows and keeps the boxes they reach', () => {
    const layout = viewer.layoutDiagram(diagram(exampleModel(), 'A0'))
    const focus = { type: 'box', id: 'A3' }
    const lit = viewer.litEdgesOf(layout, focus)
    const litArrows = new Set(
      layout.edges.filter((e: any) => lit.has(e.id)).map((e: any) => e.data.arrow.id),
    )
    expect([...litArrows].sort()).toEqual(['M1', 'O1', 'a2', 'a3'])
    // Only M1's branch into A3 lights, not its branches into A1 and A2.
    const m1 = layout.edges.filter((e: any) => e.data.arrow.id === 'M1')
    expect(m1.filter((e: any) => lit.has(e.id)).map((e: any) => e.data.to)).toEqual(['A3'])
    const kept = viewer.keptBoxesOf(layout, focus, lit)
    expect([...kept].sort()).toEqual(['A2', 'A3'])
  })

  it('EARS-614: a focused arrow keeps its end boxes', () => {
    const layout = viewer.layoutDiagram(diagram(exampleModel(), 'A0'))
    const kept = viewer.keptBoxesOf(layout, { type: 'arrow', id: 'a1' }, null)
    expect([...kept].sort()).toEqual(['A1', 'A2'])
  })

  it('EARS-614: an arrow row hovered in the panel traces only its branch into the panel box', () => {
    const layout = viewer.layoutDiagram(diagram(exampleModel(), 'A0'))
    const traced = viewer.tracedEdgesOf(layout, 'C1', 'A2')
    const edges = layout.edges.filter((e: any) => traced.has(e.id))
    expect(edges.map((e: any) => e.data.to)).toEqual(['A2'])
    expect(viewer.tracedEdgesOf(layout, null, 'A2')).toBeNull()
  })
})
