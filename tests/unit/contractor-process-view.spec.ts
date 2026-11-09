import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { parseContractorProcess } from '@/lib/contractor-process'
import { ContractorProcessView } from '@/modules/contractor-process/view/ContractorProcessView'

/**
 * The «Как работаем с исполнителями» view (#545) over the public example: what
 * a member can do with the map — open a step (its «Сейчас», «Автоматизация»,
 * «Вопросы» and «lane · stage» line), open a lane («О роли» or «Вопросов к этой
 * дорожке нет.»), open a subprocess step, close with ✕ or Esc, switch the
 * automation view and the zoom. jsdom has no canvas, so the view's
 * average-width fallback measures the text — the geometry itself is pinned in
 * `contractor-process-layout.spec.ts`.
 *
 * Written with `React.createElement`: the vitest include glob is `*.spec.ts`.
 */

const repoRoot = join(import.meta.dirname, '..', '..')
const parsed = parseContractorProcess(
  readFileSync(join(repoRoot, 'content/finance/contractor-process.example.json'), 'utf8'),
)
if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
const example = parsed.process

afterEach(cleanup)

async function mount() {
  const utils = render(React.createElement(ContractorProcessView, { process: example }))
  await act(async () => {})
  return utils
}

const panel = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-cp-panel]')!
const step = (container: HTMLElement, id: string) =>
  container.querySelector<SVGGElement>(`[data-step-id="${id}"]`)!
const lane = (container: HTMLElement, id: string) =>
  container.querySelector<SVGGElement>(`[data-lane-id="${id}"]`)!

describe('contractor-process view', () => {
  it('draws every step of both diagrams, the stages and the lanes as buttons', async () => {
    const { container } = await mount()
    for (const s of [...example.steps, ...example.subprocess!.steps]) {
      const g = step(container, s.id)
      expect(g).not.toBeNull()
      expect(g.getAttribute('role')).toBe('button')
      expect(g.getAttribute('tabindex')).toBe('0')
    }
    expect(container.querySelectorAll('.cp-stageh')).toHaveLength(example.stages.length)
    expect(container.querySelectorAll('[data-lane-id]')).toHaveLength(
      example.lanes.length + example.subprocess!.lanes.length,
    )
    expect(container.querySelectorAll('path.cp-edge.alt')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: example.subprocess!.title })).toBeTruthy()
  })

  it('opens a step: title, «lane · stage», «Сейчас», «Автоматизация», «Вопросы»', async () => {
    const { container } = await mount()
    fireEvent.click(step(container, 'e2'))
    const p = within(panel(container))
    expect(p.getByRole('heading', { level: 2, name: 'Подтверждает условия' })).toBeTruthy()
    expect(p.getByText('Исполнитель · 1. Постановка задачи')).toBeTruthy()
    expect(p.getByText('Сейчас')).toBeTruthy()
    expect(p.getByText('Автоматизация')).toBeTruthy()
    expect(p.getByText('Как фиксируем подтверждение условий?')).toBeTruthy()
    expect(step(container, 'e2').classList.contains('sel')).toBe(true)
    expect(step(container, 'e2').getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.cp-stage')!.classList.contains('with-panel')).toBe(true)
  })

  it('opens a lane by keyboard: «О роли» and its questions, or the no-questions hint', async () => {
    const { container } = await mount()
    fireEvent.keyDown(lane(container, 'l2'), { key: 'Enter' })
    let p = within(panel(container))
    expect(p.getByRole('heading', { level: 2, name: 'Исполнитель' })).toBeTruthy()
    expect(p.getByText('О роли')).toBeTruthy()
    expect(p.getByText(example.lanes[1].q[0])).toBeTruthy()

    fireEvent.keyDown(lane(container, 'l1'), { key: ' ' })
    p = within(panel(container))
    expect(p.getByRole('heading', { level: 2, name: 'Заказчик' })).toBeTruthy()
    expect(p.getByText('Вопросов к этой дорожке нет.')).toBeTruthy()
  })

  it('names the subprocess in a subprocess step’s meta line', async () => {
    const { container } = await mount()
    fireEvent.click(step(container, 'p2'))
    expect(
      within(panel(container)).getByText(`Исполнитель · ${example.subprocess!.title}`),
    ).toBeTruthy()
  })

  it('closes with ✕ and with Esc, and gives focus back to what opened it', async () => {
    const { container } = await mount()
    const e1 = step(container, 'e1')
    fireEvent.click(e1)
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }))
    expect(container.querySelector('.cp-stage')!.classList.contains('with-panel')).toBe(false)
    expect(document.activeElement).toBe(e1)

    fireEvent.click(step(container, 'e3'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(container.querySelector('.cp-stage')!.classList.contains('with-panel')).toBe(false)
    expect(step(container, 'e3').classList.contains('sel')).toBe(false)
  })

  it('«Показать автоматизацию» switches the automation view on and off', async () => {
    const { container } = await mount()
    const toggle = screen.getByRole('button', { name: 'Показать автоматизацию' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('.cp-view')!.classList.contains('cp-autoview')).toBe(true)
    // What the automation view dims is decided by class: only steps without `auto`.
    expect(step(container, 'e1').classList.contains('has-auto')).toBe(false)
    expect(step(container, 'e4').classList.contains('has-auto')).toBe(true)
    fireEvent.click(toggle)
    expect(container.querySelector('.cp-view')!.classList.contains('cp-autoview')).toBe(false)
  })

  it('switches between «Уместить по ширине» (the desktop default) and «100%»', async () => {
    const { container } = await mount()
    const fit = screen.getByRole('button', { name: 'Уместить по ширине' })
    const full = screen.getByRole('button', { name: '100%' })
    expect(fit.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(full)
    expect(full.getAttribute('aria-pressed')).toBe('true')
    const svg = container.querySelector<SVGSVGElement>('svg[aria-label="Схема процесса"]')!
    const [, , w, h] = svg.getAttribute('viewBox')!.split(' ')
    expect(svg.style.width).toBe(`${w}px`)
    expect(svg.style.height).toBe(`${h}px`)
    fireEvent.click(fit)
    expect(svg.style.height).toBe('auto')
  })
})
