import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { PATH_MAP_FILE, parsePathMap } from '@/lib/path-map'
import { PathMapView } from '@/modules/path-map/view/PathMapView'

/**
 * The `/p/path` view (#530), rendered over the SHIPPED map file — the clauses
 * here are what a member sees on the seeded map: the beacon, the three focus
 * tracks, «Мы здесь» with the passed path, the roadside, and the «Проверить
 * путь» mode finding the deliberate break.
 *
 * Written with `React.createElement`: the vitest include glob is `*.spec.ts`.
 */

const el = React.createElement
const repoRoot = join(import.meta.dirname, '..', '..')
const shipped = parsePathMap(readFileSync(join(repoRoot, PATH_MAP_FILE), 'utf8'))

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
