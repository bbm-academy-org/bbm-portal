import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PATH_MAP_FILE, parsePathMap } from '@/lib/path-map'
import type { PathMapEditOutcome } from '@/lib/path-map/save'
import type { PathMapEditing } from '@/modules/path-map/view/editing'
import { PathMapView } from '@/modules/path-map/view/PathMapView'

/**
 * «Карта пути» v2, task D (#539) — the edit mode in the view: the «Править»
 * toggle (and its disabled state off the live map), the board with «+» insert
 * points, the station form's required «потому что», the save loop (refresh +
 * «Сохранено») and the stale-map message that keeps the form input.
 *
 * The Server Action is a stub passed as `editing.save`; `next/navigation`'s
 * router is mocked. Written with `React.createElement` (the include glob is `*.spec.ts`).
 */

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const el = React.createElement
const repoRoot = join(import.meta.dirname, '..', '..')
const shipped = parsePathMap(
  readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8'),
)

type Save = PathMapEditing['save']

function renderEditable(save: Save, overrides: Partial<PathMapEditing> = {}) {
  const editing: PathMapEditing = { enabled: true, sha: 'sha-1', save, ...overrides }
  return render(el(PathMapView, { result: shipped, file: PATH_MAP_FILE, editing }))
}

function enterEdit() {
  fireEvent.click(screen.getByRole('button', { name: 'Править' }))
}

beforeEach(() => refresh.mockReset())
afterEach(cleanup)

describe('«Править» toggle', () => {
  it('switches the map body to the edit board and back', () => {
    renderEditable(vi.fn())
    const toggle = screen.getByRole('button', { name: 'Править' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('complementary', { name: 'Правка карты' })).toBeNull()

    enterEdit()
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('complementary', { name: 'Правка карты' })).toBeTruthy()
    // Every track — the roadside one too — is a column of the board.
    for (const title of [
      'Контент уроков',
      'Охват и подкасты',
      'Своя платформа',
      'Фарма-партнёры',
    ]) {
      expect(screen.getByRole('region', { name: `Трек «${title}»` })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: '+ Трек' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Карта' }))
    expect(screen.queryByRole('complementary', { name: 'Правка карты' })).toBeNull()
  })

  it('is disabled with the reason off the live map', () => {
    renderEditable(vi.fn(), {
      enabled: false,
      sha: null,
      reason: 'редактирование доступно только для живой карты',
    })
    const toggle = screen.getByRole('button', { name: 'Править' })
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
    const described = document.getElementById(toggle.getAttribute('aria-describedby') ?? '')
    expect(described?.textContent).toBe('редактирование доступно только для живой карты')
  })

  it('is absent from a read-only render', () => {
    render(el(PathMapView, { result: shipped, file: PATH_MAP_FILE }))
    expect(screen.queryByRole('button', { name: 'Править' })).toBeNull()
  })
})

describe('the board', () => {
  it('puts a «+» insert point between nodes and at both ends of a road', () => {
    renderEditable(vi.fn())
    enterEdit()
    const reach = screen.getByRole('region', { name: 'Трек «Охват и подкасты»' })
    const inserts = within(reach).getAllByRole('button', { name: /^Добавить блок/ })
    // Two nodes → three insert points.
    expect(inserts).toHaveLength(3)
    expect(inserts[1].getAttribute('aria-label')).toBe(
      'Добавить блок между «Пилотный выпуск подкаста с экспертом» и «Какой канал приведёт первых врачей?»',
    )
  })
})

describe('station form', () => {
  it('refuses to save a new station without «потому что» and does not call the server', async () => {
    const save = vi.fn<Save>()
    renderEditable(save)
    enterEdit()
    const reach = screen.getByRole('region', { name: 'Трек «Охват и подкасты»' })
    fireEvent.click(within(reach).getAllByRole('button', { name: /^Добавить блок/ })[0])

    const form = screen.getByRole('form', { name: 'Новый блок' })
    fireEvent.change(within(form).getByLabelText(/^Название/), {
      target: { value: 'Первые 100 врачей' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Поставить на дорогу' }))

    const because = within(form).getByLabelText(/^Потому что/)
    expect(because.getAttribute('aria-invalid')).toBe('true')
    expect(within(form).getByText(/Без «потому что» станция не встанет на дорогу/)).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })

  it('saves a valid station with the base sha, refreshes and says «Сохранено»', async () => {
    const save = vi.fn<Save>(async () => ({
      status: 'ok',
      sha: 'sha-2',
      commit: 'c',
      summary: 's',
    }))
    renderEditable(save)
    enterEdit()
    const reach = screen.getByRole('region', { name: 'Трек «Охват и подкасты»' })
    fireEvent.click(within(reach).getAllByRole('button', { name: /^Добавить блок/ })[0])
    const form = screen.getByRole('form', { name: 'Новый блок' })
    fireEvent.change(within(form).getByLabelText(/^Название/), {
      target: { value: 'Первые 100 врачей' },
    })
    fireEvent.change(within(form).getByLabelText(/^Потому что/), {
      target: { value: 'появится аудитория' },
    })
    fireEvent.click(within(form).getByLabelText(/Гипотеза/))
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Поставить на дорогу' }))
    })

    expect(save).toHaveBeenCalledWith({
      baseSha: 'sha-1',
      command: {
        op: 'node.add',
        trackId: 'reach',
        // The topmost insert point of a two-node road.
        index: 2,
        type: 'station',
        fields: {
          title: 'Первые 100 врачей',
          owner: undefined,
          opens: 'beacon',
          because: 'появится аудитория',
          confidence: 'hypothesis',
        },
      },
    })
    expect(refresh).toHaveBeenCalled()
    expect(document.querySelector('.pm-ed-toast')?.textContent).toBe('Сохранено')
    expect(screen.queryByRole('form', { name: 'Новый блок' })).toBeNull()
  })
})

describe('barrier form', () => {
  it('shows the task tree editor and toggles a task with today’s date', async () => {
    const save = vi.fn<Save>(async () => ({
      status: 'ok',
      sha: 'sha-2',
      commit: 'c',
      summary: 's',
    }))
    renderEditable(save)
    enterEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Править: шлагбаум «Каталог экспертов»' }))
    const tree = screen.getByRole('region', { name: 'Задачи шлагбаума' })
    const box = within(tree).getByRole('checkbox', { name: 'Выполнено: Анкета эксперта' })
    expect(box.getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      fireEvent.click(box)
    })
    const call = save.mock.calls[0][0]
    expect(call.command).toMatchObject({ op: 'task.toggle', nodeId: 'experts-catalog', path: [1] })
    expect((call.command as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('stale map', () => {
  it('shows «карта обновилась — перечитайте» with a reload button and keeps the form input', async () => {
    const save = vi.fn<Save>(async (): Promise<PathMapEditOutcome> => ({ status: 'stale' }))
    renderEditable(save)
    enterEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Править маяк' }))
    const form = screen.getByRole('form', { name: 'Маяк' })
    fireEvent.change(within(form).getByLabelText(/^Маяк/), { target: { value: 'Новый маяк' } })
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }))
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Карта обновилась — перечитайте.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Перечитать карту' }))
    expect(refresh).toHaveBeenCalled()
    expect(
      within(screen.getByRole('form', { name: 'Маяк' })).getByLabelText(/^Маяк/),
    ).toHaveProperty('value', 'Новый маяк')
  })
})

describe('closing a dirty form', () => {
  it('asks before discarding on Esc, and keeps the form on «Вернуться»', async () => {
    renderEditable(vi.fn())
    enterEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Править маяк' }))
    const input = within(screen.getByRole('form', { name: 'Маяк' })).getByLabelText(/^Маяк/)
    fireEvent.change(input, { target: { value: 'черновик' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    const ask = await screen.findByRole('alertdialog', { name: 'Несохранённые изменения' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Вернуться к форме' }))
    expect(screen.getByRole('form', { name: 'Маяк' })).toBeTruthy()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Закрыть без сохранения',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Маяк' })).toBeNull())
  })
})
