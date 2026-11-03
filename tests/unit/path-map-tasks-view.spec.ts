import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

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

const panel = () => screen.queryByRole('complementary', { name: 'Что внутри' })

describe('barrier counter and arm', () => {
  it('the studio barrier shows «4/7» and its arm lifted by 57%', () => {
    renderShipped()
    const studio = barrier(/Довести студию до готовности/)
    expect(studio.textContent).toContain('4/7')
    const arm = studio.querySelector('.pm-stripes')
    expect(arm?.getAttribute('data-lift')).toBe('57')
    expect((arm as HTMLElement).style.getPropertyValue('--pm-lift')).toBe(String(4 / 7))
  })

  it('the counter has a readable name for screen readers', () => {
    renderShipped()
    expect(barrier(/Довести студию/).textContent).toMatch(/выполнено 4 из 7/)
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
    const card = barrier(/Без задач/)
    expect(card.textContent).not.toMatch(/\d+\/\d+/)
    expect(card.querySelector('.pm-stripes')?.hasAttribute('data-lift')).toBe(false)
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
