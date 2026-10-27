import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { PATH_MAP_FILE, parsePathMap } from '@/lib/path-map'
import { PathMapView } from '@/modules/path-map/view/PathMapView'

/**
 * The `/p/path` view (#530), rendered over the example map fixture — the clauses
 * here are what a member sees on that map: the beacon, the three focus
 * tracks, «Мы здесь» with the passed path, the roadside, and the «Проверить
 * путь» mode finding the deliberate break.
 *
 * Written with `React.createElement`: the vitest include glob is `*.spec.ts`.
 */

const el = React.createElement
const repoRoot = join(import.meta.dirname, '..', '..')
// The design's example map, NOT the real content file: the clauses below pin
// example content (the deliberate `experts-sell-courses` break and friends).
const shipped = parsePathMap(
  readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8'),
)

afterEach(cleanup)

function renderShipped() {
  return render(el(PathMapView, { result: shipped, file: PATH_MAP_FILE }))
}

describe('PathMapView — map mode', () => {
  it('draws the beacon, the focus tracks, «Мы здесь» and the passed path', () => {
    renderShipped()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/врачи учатся бесплатно/)
    for (const title of ['Контент уроков', 'Охват и подкасты', 'Своя платформа']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('Мы здесь')).toBeTruthy()
    expect(screen.getByText('Сценарий первого урока')).toBeTruthy()
    expect(screen.getByText('21 окт')).toBeTruthy()
  })

  it('puts the roadside track and the station without «потому что» in the Обочина panel', () => {
    renderShipped()
    const roadside = screen.getByRole('complementary', { name: 'Обочина' })
    expect(within(roadside).getByText('Фарма-партнёры')).toBeTruthy()
    expect(within(roadside).getByText('Мобильное приложение для врачей')).toBeTruthy()
  })

  it('ships no edit, share, invite or meeting controls', () => {
    renderShipped()
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    for (const banned of ['Поделиться', 'Пригласить', 'Режим встречи', 'Снять', '+ Трек']) {
      expect(labels.some((l) => l.includes(banned))).toBe(false)
    }
  })

  it('offers one tab per focus track for the narrow layout', () => {
    renderShipped()
    const tabs = screen.getByRole('group', { name: 'Треки в фокусе' })
    expect(within(tabs).getAllByRole('button')).toHaveLength(3)
  })
})

describe('PathMapView — «Проверить путь»', () => {
  it('toggles the mode with a pressed-state button', () => {
    renderShipped()
    const toggle = screen.getByRole('button', { name: /Проверить путь/ })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('selecting «Каталог экспертов» shows its chain and the break at the unknown id', () => {
    renderShipped()
    fireEvent.click(screen.getByRole('button', { name: /Проверить путь/ }))
    fireEvent.click(screen.getByRole('button', { name: /Каталог экспертов/ }))
    const panel = screen.getByRole('complementary', { name: 'Проверка пути' })
    expect(within(panel).getByText(/разрыв/i)).toBeTruthy()
    expect(panel.textContent).toContain('experts-sell-courses')
    expect(panel.textContent).toContain('Две поверхности платформы в проде')
  })

  it('selecting a node whose road reaches the beacon says so', () => {
    renderShipped()
    fireEvent.click(screen.getByRole('button', { name: /Проверить путь/ }))
    fireEvent.click(screen.getByRole('button', { name: /Довести студию до готовности/ }))
    const panel = screen.getByRole('complementary', { name: 'Проверка пути' })
    expect(panel.textContent).toMatch(/доходит до маяка/)
  })

  it('summarises every focus road: Контент доходит, Охват по грунтовке, Платформа обрывается', () => {
    renderShipped()
    fireEvent.click(screen.getByRole('button', { name: /Проверить путь/ }))
    const panel = screen.getByRole('complementary', { name: 'Проверка пути' })
    const text = panel.textContent ?? ''
    expect(text).toMatch(/Контент уроков\s*доходит/)
    expect(text).toMatch(/Охват и подкасты\s*доходит, по грунтовке/)
    expect(text).toMatch(/Своя платформа\s*разрыв/)
  })
})

describe('PathMapView — states', () => {
  it('an invalid file renders a clear error naming the file and the problem', () => {
    const broken = parsePathMap(
      'title: Тест\nbeacon: { title: М }\ntracks:\n  - { id: a, title: А, nodes: [ { id: x, type: castle, title: X } ] }\n',
    )
    render(el(PathMapView, { result: broken, file: PATH_MAP_FILE }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(PATH_MAP_FILE)
    expect(alert.textContent).toContain('tracks[0].nodes[0]')
  })

  it('an empty track list shows the beacon and the empty-state hint with the file path', () => {
    const empty = parsePathMap('title: Пусто\nbeacon: { title: Маяк пустой карты }\ntracks: []\n')
    render(el(PathMapView, { result: empty, file: PATH_MAP_FILE }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Маяк пустой карты')
    expect(screen.getByText(/Карта пуста — добавьте трек в файл/).textContent).toContain(
      PATH_MAP_FILE,
    )
  })
})

function renderYaml(yaml: string) {
  const result = parsePathMap(yaml)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return render(el(PathMapView, { result, file: PATH_MAP_FILE }))
}

function enterCheck() {
  fireEvent.click(screen.getByRole('button', { name: /Проверить путь/ }))
}

const mapBreakCards = () => within(screen.getByRole('main')).queryAllByText(/Разрыв · дороги нет/)

const HEAD = 'title: Тест\nbeacon:\n  title: Маяк\n'

describe('PathMapView — review of PR #531', () => {
  it('selecting «Две поверхности платформы в проде» (the issue AC) shows the break in the panel and on the map', () => {
    renderShipped()
    enterCheck()
    fireEvent.click(screen.getByRole('button', { name: /Две поверхности платформы в проде/ }))
    const panel = screen.getByRole('complementary', { name: 'Проверка пути' })
    expect(panel.textContent).toMatch(/обрывается/)
    expect(panel.textContent).toContain('experts-sell-courses')
    expect(mapBreakCards()).toHaveLength(1)
  })

  it('a road through a fog card reads «доходит через туман», never plain «доходит»', () => {
    renderYaml(`${HEAD}tracks:
  - id: a
    title: Трек А
    nodes:
      - { id: s0, type: station, title: Перед туманом, because: x, opens: fo }
      - { id: fo, type: fog, title: Вопрос с ответом наперёд, opens: beacon }
`)
    enterCheck()
    const panel = screen.getByRole('complementary', { name: 'Проверка пути' })
    expect(panel.textContent).toMatch(/Трек А\s*доходит через туман/)
    fireEvent.click(screen.getByRole('button', { name: /Перед туманом/ }))
    expect(panel.textContent).toMatch(/доходит до маяка, через туман/)
  })

  const COLLAPSED = `${HEAD}limits: { visible_stations: 1 }
tracks:
  - id: a
    title: Трек А
    nodes:
      - { id: s1, type: station, title: Ближняя станция, because: x, opens: s2 }
      - { id: s2, type: station, title: Дальняя станция, because: x, opens: nowhere }
      - { id: s3, type: station, title: Совсем дальняя, because: x, opens: beacon }
`

  it('nodes collapsed into «Дальше туман» are clickable in check mode', () => {
    renderYaml(COLLAPSED)
    expect(screen.queryByRole('button', { name: /Совсем дальняя/ })).toBeNull()
    enterCheck()
    fireEvent.click(screen.getByRole('button', { name: /Совсем дальняя/ }))
    const panel = screen.getByRole('complementary', { name: 'Проверка пути' })
    expect(panel.textContent).toMatch(/«Совсем дальняя» → маяк/)
    expect(panel.textContent).toMatch(/доходит до маяка/)
  })

  it('a break on a collapsed node is drawn on the map too', () => {
    renderYaml(COLLAPSED)
    enterCheck()
    fireEvent.click(screen.getByRole('button', { name: /Ближняя станция/ }))
    expect(screen.getByRole('complementary', { name: 'Проверка пути' }).textContent).toContain(
      'nowhere',
    )
    expect(mapBreakCards()).toHaveLength(1)
  })

  it('a break on a removed (done) obstacle is drawn on the map too', () => {
    renderYaml(`${HEAD}tracks:
  - id: a
    title: Трек А
    nodes:
      - { id: gone, type: obstacle, title: Снятый в никуда, opens: nowhere, done: 2026-10-15 }
      - { id: s1, type: station, title: Станция, because: x, opens: beacon }
`)
    enterCheck()
    fireEvent.click(screen.getByRole('button', { name: /Снятый в никуда/ }))
    expect(mapBreakCards()).toHaveLength(1)
  })

  it('the mode toggle is a labelled group of two buttons, not a navigation landmark', () => {
    renderShipped()
    const group = screen.getByRole('group', { name: 'Режим карты' })
    expect(within(group).getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('the narrow-layout tabs use each track’s short label', () => {
    renderShipped()
    const tabs = screen.getByRole('group', { name: 'Треки в фокусе' })
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Контент', 'Охват', 'Платформа'])
  })

  it('respects prefers-reduced-motion when scrolling the panel into view', () => {
    const original = window.matchMedia
    const scroll = vi.fn()
    const originalScroll = Element.prototype.scrollIntoView
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia
    Element.prototype.scrollIntoView = scroll
    try {
      renderShipped()
      enterCheck()
      fireEvent.click(screen.getByRole('button', { name: /Довести студию до готовности/ }))
      expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
    } finally {
      window.matchMedia = original
      Element.prototype.scrollIntoView = originalScroll
    }
  })

  it('renders every error even when two read the same (unique list keys)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        el(PathMapView, {
          result: { ok: false, errors: ['tracks: одинаковая', 'tracks: одинаковая'] },
          file: PATH_MAP_FILE,
        }),
      )
      expect(within(screen.getByRole('alert')).getAllByRole('listitem')).toHaveLength(2)
      const keyWarnings = spy.mock.calls.filter((call) => String(call[0]).includes('same key'))
      expect(keyWarnings).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })
})
