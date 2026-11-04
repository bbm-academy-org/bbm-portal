import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PATH_MAP_FILE, parsePathMap } from '@/lib/path-map'
import { taskProgress } from '@/lib/path-map/tasks'
import { PathMapView } from '@/modules/path-map/view/PathMapView'

/**
 * «Карта пути» v2 (#536) — the tasks inside an obstacle, over the example map
 * fixture: the done/total counter on the barrier, the barrier arm lifting with
 * progress, and the «Что внутри» side panel with the task tree.
 *
 * The fixture's «Довести студию до готовности» carries 7 leaf tasks, 4 done.
 *
 * Written with `React.createElement`: the vitest include glob is `*.spec.ts`.
 */

const el = React.createElement
const repoRoot = join(import.meta.dirname, '..', '..')
const shipped = parsePathMap(
  readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8'),
)

afterEach(cleanup)

function renderShipped() {
  return render(el(PathMapView, { result: shipped, file: PATH_MAP_FILE }))
}

/** The barrier on the map itself (the navigator lives in a `<nav>`). */
function barrier(title: RegExp) {
  const found = screen.getAllByRole('button', { name: title }).filter((b) => !b.closest('nav'))
  expect(found).toHaveLength(1)
  return found[0]
}

/**
 * The barrier's card: an `<article>` that keeps its `<h3>`; the disclosure
 * button is stretched over it (#537 review — no heading inside a button).
 */
function card(title: RegExp) {
  const found = barrier(title).closest('article')
  expect(found).not.toBeNull()
  return found as HTMLElement
}

const panel = () => screen.queryByRole('complementary', { name: 'Что внутри' })

/** `window.matchMedia` answering `true` for the queries listed. */
function stubMedia(matching: string[]) {
  const original = window.matchMedia
  window.matchMedia = ((q: string) => ({
    matches: matching.includes(q),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}

describe('barrier counter and arm', () => {
  it('the studio barrier shows «4/7» and its arm lifted by 57%', () => {
    renderShipped()
    const studio = card(/Довести студию до готовности/)
    expect(studio.textContent).toContain('4/7')
    const arm = studio.querySelector('.pm-stripes')
    expect(arm?.getAttribute('data-lift')).toBe('57')
    expect((arm as HTMLElement).style.getPropertyValue('--pm-lift')).toBe(String(4 / 7))
  })

  it('the counter has a readable name for screen readers', () => {
    renderShipped()
    expect(card(/Довести студию/).textContent).toMatch(/выполнено 4 из 7/)
  })

  it('an obstacle without tasks has no counter and a flat arm', () => {
    const map = parsePathMap(`title: Т
beacon: { title: Маяк }
tracks:
  - id: a
    title: А
    nodes:
      - { id: o1, type: obstacle, title: Без задач, opens: s1 }
      - { id: s1, type: station, title: Станция, because: да, opens: beacon }
`)
    render(el(PathMapView, { result: map, file: PATH_MAP_FILE }))
    const found = card(/Без задач/)
    expect(found.textContent).not.toMatch(/\d+\/\d+/)
    expect(found.querySelector('.pm-stripes')?.hasAttribute('data-lift')).toBe(false)
  })

  it('the counter agrees with the pure progress of the fixture', () => {
    if (!shipped.ok) throw new Error('fixture invalid')
    const studio = shipped.map.tracks[0].nodes.find((n) => n.id === 'studio')
    if (studio?.type !== 'obstacle') throw new Error('studio is not an obstacle')
    expect(taskProgress(studio.tasks)).toMatchObject({ done: 4, total: 7 })
  })
})

describe('«Что внутри» panel', () => {
  it('is closed at first: the Обочина panel is on the right', () => {
    renderShipped()
    expect(panel()).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Обочина' })).toBeTruthy()
  })

  it('clicking a barrier opens the panel with title, owner, what it opens and progress', () => {
    renderShipped()
    const studio = barrier(/Довести студию/)
    expect(studio.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(studio)
    expect(studio.getAttribute('aria-expanded')).toBe('true')
    const p = panel()!
    expect(within(p).getByRole('heading', { name: 'Довести студию до готовности' })).toBeTruthy()
    expect(p.textContent).toContain('ДС')
    expect(p.textContent).toContain('«Готов первый урок»')
    expect(p.textContent).toMatch(/4 из 7/)
    expect(screen.queryByRole('complementary', { name: 'Обочина' })).toBeNull()
  })

  it('shows the task tree: first level expanded, deeper levels collapsed', () => {
    renderShipped()
    fireEvent.click(barrier(/Довести студию/))
    const p = panel()!
    // Level 1 and its children are visible…
    expect(within(p).getByText('Свет и звук')).toBeTruthy()
    expect(within(p).getByText('Купить петличные микрофоны')).toBeTruthy()
    // …the third level is behind its own toggle.
    expect(within(p).queryByText('Забронировать зал')).toBeNull()
    const toggle = within(p).getByRole('button', { name: /Расписание записи/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(within(p).getByText('Забронировать зал')).toBeTruthy()
  })

  it('marks done state, owner chips and opens links in a new tab', () => {
    renderShipped()
    fireEvent.click(barrier(/Довести студию/))
    const p = panel()!
    const done = within(p).getByText('Купить петличные микрофоны').closest('li')!
    expect(done.getAttribute('data-done')).toBe('true')
    expect(done.textContent).toMatch(/выполнено/)
    const open = within(p).getByText('Монтажёр на поток').closest('li')!
    expect(open.hasAttribute('data-done')).toBe(false)
    expect(open.textContent).toContain('ЕВ')
    const link = within(p).getAllByRole('link')[0]
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
  })

  it('the close button and Esc close the panel', () => {
    renderShipped()
    fireEvent.click(barrier(/Довести студию/))
    fireEvent.click(within(panel()!).getByRole('button', { name: 'Закрыть' }))
    expect(panel()).toBeNull()

    fireEvent.click(barrier(/Довести студию/))
    expect(panel()).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(panel()).toBeNull()
  })

  it('clicking the open barrier again closes the panel', () => {
    renderShipped()
    const studio = barrier(/Довести студию/)
    fireEvent.click(studio)
    fireEvent.click(studio)
    expect(panel()).toBeNull()
  })

  it('an obstacle without tasks opens the panel with an empty-state line', () => {
    const map = parsePathMap(`title: Т
beacon: { title: Маяк }
tracks:
  - id: a
    title: А
    nodes:
      - { id: o1, type: obstacle, title: Без задач, opens: beacon }
`)
    render(el(PathMapView, { result: map, file: PATH_MAP_FILE }))
    fireEvent.click(barrier(/Без задач/))
    expect(panel()?.textContent).toMatch(/Задач пока нет/)
  })

  it('check mode is unchanged: a barrier click checks the path, not the panel', () => {
    renderShipped()
    fireEvent.click(screen.getByRole('button', { name: /Проверить путь/ }))
    fireEvent.click(barrier(/Довести студию/))
    expect(panel()).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Проверка пути' }).textContent).toMatch(
      /Довести студию до готовности/,
    )
  })

  it('switching to check mode closes an open panel', () => {
    renderShipped()
    fireEvent.click(barrier(/Довести студию/))
    fireEvent.click(screen.getByRole('button', { name: /Проверить путь/ }))
    expect(panel()).toBeNull()
  })
})

describe('right panels stay in view (#536, orchestrator note on #535)', () => {
  // jsdom has no layout: the clause pins the structure the sticky CSS hangs on —
  // every right panel wraps its content in `.pm-aside-inner`.
  const inner = (name: string) =>
    screen.getByRole('complementary', { name }).querySelector(':scope > .pm-aside-inner')

  it('Обочина, «Что внутри» and «Проверка пути» each have a sticky content wrapper', () => {
    renderShipped()
    expect(inner('Обочина')).not.toBeNull()
    fireEvent.click(barrier(/Довести студию/))
    expect(inner('Что внутри')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Проверить путь/ }))
    expect(inner('Проверка пути')).not.toBeNull()
  })
})

describe('barrier semantics on the map (#537 review, MAJOR 1)', () => {
  it('no heading sits inside a button: barrier titles stay h3 headings', () => {
    renderShipped()
    expect(document.querySelectorAll('button h1, button h2, button h3, button h4')).toHaveLength(0)
    expect(
      screen.getByRole('heading', { level: 3, name: 'Довести студию до готовности' }),
    ).toBeTruthy()
  })

  it('a button holds phrasing content only — no headings, articles or nested controls', () => {
    renderShipped()
    for (const button of Array.from(document.querySelectorAll('button'))) {
      expect(button.querySelector('h1,h2,h3,h4,h5,h6,article,div,p,ul,button,a')).toBeNull()
    }
  })

  it('the disclosure button has a short name and sits inside the barrier card', () => {
    renderShipped()
    const button = barrier(/Довести студию/)
    expect(button.getAttribute('aria-label')).toBe('Что внутри: Довести студию до готовности')
    expect(card(/Довести студию/).contains(button)).toBe(true)
  })
})

describe('«Что внутри» focus and the way back (#537 review, MAJOR 2 + minor 6)', () => {
  it('opening moves focus into the panel; × hands it back to the barrier', () => {
    renderShipped()
    const studio = barrier(/Довести студию/)
    fireEvent.click(studio)
    expect(document.activeElement).toBe(panel())
    fireEvent.click(within(panel()!).getByRole('button', { name: 'Закрыть' }))
    expect(document.activeElement).toBe(studio)
  })

  it('Esc hands focus back to the barrier', () => {
    renderShipped()
    const studio = barrier(/Довести студию/)
    fireEvent.click(studio)
    fireEvent.keyDown(panel()!, { key: 'Escape' })
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(studio)
  })

  it('≤1140px closing scrolls the barrier back into view, honouring reduced motion', () => {
    const restore = stubMedia(['(max-width: 1140px)', '(prefers-reduced-motion: reduce)'])
    const scroll = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scroll
    try {
      renderShipped()
      const studio = barrier(/Довести студию/)
      fireEvent.click(studio)
      scroll.mockClear()
      fireEvent.click(within(panel()!).getByRole('button', { name: 'Закрыть' }))
      expect(scroll).toHaveBeenCalledTimes(1)
      expect(scroll.mock.contexts[0]).toBe(studio)
      expect(scroll.mock.calls[0][0]).toMatchObject({ behavior: 'auto', block: 'center' })
      expect(document.activeElement).toBe(studio)

      fireEvent.click(studio)
      scroll.mockClear()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(scroll.mock.contexts[0]).toBe(studio)
    } finally {
      HTMLElement.prototype.scrollIntoView = original
      restore()
    }
  })

  it('≤1140px with motion allowed the way back is smooth', () => {
    const restore = stubMedia(['(max-width: 1140px)'])
    const scroll = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scroll
    try {
      renderShipped()
      fireEvent.click(barrier(/Довести студию/))
      scroll.mockClear()
      fireEvent.click(within(panel()!).getByRole('button', { name: 'Закрыть' }))
      expect(scroll.mock.calls[0][0]).toMatchObject({ behavior: 'smooth', block: 'center' })
    } finally {
      HTMLElement.prototype.scrollIntoView = original
      restore()
    }
  })

  it('on the wide layout closing does not scroll the page', () => {
    const restore = stubMedia([])
    const scroll = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scroll
    try {
      renderShipped()
      fireEvent.click(barrier(/Довести студию/))
      fireEvent.click(within(panel()!).getByRole('button', { name: 'Закрыть' }))
      expect(scroll).not.toHaveBeenCalled()
    } finally {
      HTMLElement.prototype.scrollIntoView = original
      restore()
    }
  })
})

describe('Esc is not global (#537 review, minor 7)', () => {
  it('an Esc another handler already took does not close the panel', () => {
    renderShipped()
    fireEvent.click(barrier(/Довести студию/))
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    event.preventDefault()
    document.dispatchEvent(event)
    expect(panel()).not.toBeNull()
  })

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    [
      'contenteditable',
      () => {
        const div = document.createElement('div')
        div.setAttribute('contenteditable', 'true')
        return div
      },
    ],
  ])('an Esc typed in an %s does not close the panel', (_kind, make) => {
    renderShipped()
    fireEvent.click(barrier(/Довести студию/))
    const field = make()
    document.body.append(field)
    try {
      fireEvent.keyDown(field, { key: 'Escape' })
      expect(panel()).not.toBeNull()
    } finally {
      field.remove()
    }
  })
})

describe('the panel reads the live map (#537 review, minor 3)', () => {
  const OBSTACLE = (tasks: string) =>
    `      - id: o1\n        type: obstacle\n        title: Шлагбаум\n        opens: s1\n        tasks:\n${tasks}`
  const mapWith = (tasks: string | null) =>
    parsePathMap(`title: Т
beacon: { title: Маяк }
tracks:
  - id: a
    title: А
    nodes:
${tasks === null ? '' : OBSTACLE(tasks)}      - { id: s1, type: station, title: Станция, because: да, opens: beacon }
`)

  it('a new view updates the open panel and drops it when the obstacle is gone', () => {
    const first = mapWith(`          - { title: Раз }\n          - { title: Два }\n`)
    const { rerender } = render(el(PathMapView, { result: first, file: PATH_MAP_FILE }))
    fireEvent.click(barrier(/Шлагбаум/))
    expect(panel()?.textContent).toMatch(/0 из 2/)

    const next = mapWith(`          - { title: Раз, done: true }\n          - { title: Два }\n`)
    rerender(el(PathMapView, { result: next, file: PATH_MAP_FILE }))
    expect(panel()?.textContent).toMatch(/1 из 2/)

    rerender(el(PathMapView, { result: mapWith(null), file: PATH_MAP_FILE }))
    expect(panel()).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Обочина' })).toBeTruthy()

    // The id coming back does not reopen a panel the reader closed by losing it.
    rerender(el(PathMapView, { result: next, file: PATH_MAP_FILE }))
    expect(panel()).toBeNull()
  })

  it('task rows are keyed by position: renaming a task keeps its row expanded', () => {
    const tree = (name: string) =>
      mapWith(
        `          - title: Верх\n            tasks:\n              - title: ${name}\n                tasks:\n                  - { title: Лист }\n`,
      )
    const { rerender } = render(el(PathMapView, { result: tree('Середина'), file: PATH_MAP_FILE }))
    fireEvent.click(barrier(/Шлагбаум/))
    fireEvent.click(within(panel()!).getByRole('button', { name: /Середина/ }))
    expect(within(panel()!).getByText('Лист')).toBeTruthy()

    rerender(el(PathMapView, { result: tree('Середина, новая'), file: PATH_MAP_FILE }))
    expect(within(panel()!).getByText('Лист')).toBeTruthy()
  })
})

describe("a removed obstacle's tasks read as done (#537 review, minor 5)", () => {
  it('the panel of a passed barrier shows every task done', () => {
    const map = parsePathMap(`title: Т
beacon: { title: Маяк }
tracks:
  - id: a
    title: А
    nodes:
      - id: gone
        type: obstacle
        title: Снятый шлагбаум
        done: 2026-10-21
        opens: s1
        tasks:
          - { title: Сделано, done: true }
          - { title: Не отмечено }
      - { id: s1, type: station, title: Станция, because: да, opens: beacon }
`)
    render(el(PathMapView, { result: map, file: PATH_MAP_FILE }))
    fireEvent.click(barrier(/Снятый шлагбаум/))
    const p = panel()!
    expect(p.textContent).toMatch(/2 из 2/)
    expect(within(p).getByText('Не отмечено').closest('li')?.getAttribute('data-done')).toBe('true')
  })
})

describe('a scrolling panel is keyboard-reachable (#537 review, nit)', () => {
  const inner = (name: string) =>
    screen.getByRole('complementary', { name }).querySelector(':scope > .pm-aside-inner')

  it('without overflow the content wrapper is not a tab stop', () => {
    renderShipped()
    expect(inner('Обочина')?.hasAttribute('tabindex')).toBe(false)
  })

  it('when it overflows, it becomes a labelled tab stop', () => {
    const sh = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
    const ch = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 900,
    })
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true,
      get: () => 400,
    })
    try {
      renderShipped()
      const wrapper = inner('Обочина')!
      expect(wrapper.getAttribute('tabindex')).toBe('0')
      expect(wrapper.getAttribute('aria-label')).toMatch(/Обочина/)
      fireEvent.click(barrier(/Довести студию/))
      expect(inner('Что внутри')?.getAttribute('tabindex')).toBe('0')
    } finally {
      if (sh) Object.defineProperty(Element.prototype, 'scrollHeight', sh)
      if (ch) Object.defineProperty(Element.prototype, 'clientHeight', ch)
    }
  })
})
