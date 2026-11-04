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
 * «Карта пути» v2, task D (#539) — editing IN PLACE on the map (#541 rework):
 * «Править» keeps the road layout (beacon, roads, «Мы здесь», passed path) and
 * overlays it with «+» slots on the road, a mini-picker «станция / шлагбаум /
 * туман», a pulsing placeholder card where the new block will stand, clickable
 * cards, a «⋯» menu on each track label and the editable «Обочина» panel. Forms
 * open in the right panel (the AddStation artboard). The barrier's task tree
 * keeps each row to a checkbox and a title; everything else is in a row «⋯».
 *
 * The Server Action is a stub passed as `editing.save`; `next/navigation`'s
 * router is mocked. Written with `React.createElement` (the include glob is `*.spec.ts`).
 *
 * #541 v2: the editor is the `@/ui` kit — forms in a Sheet, a combobox target
 * picker, DropdownMenu menus, AlertDialog confirmations. Radix opens a menu on
 * `pointerdown` (jsdom has no pointer events), so a test opens it the way a
 * keyboard user does — ArrowDown on the trigger — and a portaled dialog is
 * found on `screen`, not inside the form.
 */

// Radix's menu captures pointers; jsdom implements none of it.
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}

/** Open a kit DropdownMenu the way a keyboard user does. */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
}

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const el = React.createElement
const repoRoot = join(import.meta.dirname, '..', '..')
const shipped = parsePathMap(
  readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8'),
)

/** The example map with one focus track sent to the roadside — what a refresh brings. */
function movedToRoadside(yaml: string, trackId: string): string {
  const at = yaml.indexOf(`- id: ${trackId}`)
  const status = yaml.indexOf('status: focus', at)
  return `${yaml.slice(0, status)}status: roadside${yaml.slice(status + 'status: focus'.length)}`
}

type Save = PathMapEditing['save']

const okSave = () =>
  vi.fn<Save>(async () => ({ status: 'ok', sha: 'sha-2', commit: 'c', summary: 's' }))

function renderEditable(save: Save, overrides: Partial<PathMapEditing> = {}) {
  const editing: PathMapEditing = { enabled: true, sha: 'sha-1', save, ...overrides }
  return render(el(PathMapView, { result: shipped, file: PATH_MAP_FILE, editing }))
}

function enterEdit() {
  fireEvent.click(screen.getByRole('button', { name: 'Править' }))
}

const road = (title: string) => screen.getByRole('group', { name: `Трек «${title}»` })

function openSlotPicker(track: string, n: number) {
  openMenu(within(road(track)).getAllByRole('button', { name: /^Добавить блок/ })[n])
  return screen.getByRole('menu', { name: /^Что поставить/ })
}

beforeEach(() => refresh.mockReset())
afterEach(cleanup)

describe('«Править» toggle', () => {
  it('keeps the road map and overlays it with edit affordances', () => {
    renderEditable(vi.fn())
    const toggle = screen.getByRole('button', { name: 'Править' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryAllByRole('button', { name: /^Добавить блок/ })).toHaveLength(0)

    enterEdit()
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    // The same road layout: beacon, focus roads, «Мы здесь», passed path.
    expect(screen.getByRole('region', { name: 'Маяк' })).toBeTruthy()
    expect(screen.getByText('Мы здесь')).toBeTruthy()
    expect(document.querySelectorAll('.pm-grid')).toHaveLength(2)
    for (const title of ['Контент уроков', 'Охват и подкасты', 'Своя платформа']) {
      expect(road(title)).toBeTruthy()
    }
    // The roadside track is edited from the Обочина panel, not as a column.
    expect(screen.queryByRole('group', { name: 'Трек «Фарма-партнёры»' })).toBeNull()
    const roadside = screen.getByRole('complementary', { name: 'Обочина' })
    expect(within(roadside).getByRole('button', { name: '+ Трек' })).toBeTruthy()
    // No separate column board any more.
    expect(document.querySelector('.pm-ed-grid')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Карта' }))
    expect(screen.queryAllByRole('button', { name: /^Добавить блок/ })).toHaveLength(0)
  })

  it('shows every node of a focus road in edit mode — nothing folds into fog', () => {
    const folded = parsePathMap(
      readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8').replace(
        'visible_stations: 2',
        'visible_stations: 1',
      ),
    )
    const editing: PathMapEditing = { enabled: true, sha: 'sha-1', save: vi.fn() }
    render(el(PathMapView, { result: folded, file: PATH_MAP_FILE, editing }))
    expect(document.querySelector('.pm-collapsed')).not.toBeNull()
    enterEdit()
    expect(document.querySelector('.pm-collapsed')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Править: туман «Курс или серия отдельных уроков?»' }),
    ).toBeTruthy()
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

describe('«+» slots on the road', () => {
  it('sit at the top of a road, between its blocks and just above «Мы здесь»', () => {
    renderEditable(vi.fn())
    enterEdit()
    const slots = within(road('Охват и подкасты')).getAllByRole('button', {
      name: /^Добавить блок/,
    })
    // Two blocks on the road → top, between, bottom.
    expect(slots.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Добавить блок выше «Какой канал приведёт первых врачей?» в треке «Охват и подкасты»',
      'Добавить блок между «Пилотный выпуск подкаста с экспертом» и «Какой канал приведёт первых врачей?»',
      'Добавить блок ниже «Пилотный выпуск подкаста с экспертом» в треке «Охват и подкасты»',
    ])
  })

  it('open a mini-picker; the choice opens the form and a placeholder card on the road', () => {
    renderEditable(vi.fn())
    enterEdit()
    const picker = openSlotPicker('Охват и подкасты', 0)
    expect(
      within(picker)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Станция', 'Шлагбаум', 'Туман'])
    fireEvent.click(within(picker).getByRole('menuitem', { name: 'Станция' }))

    const form = screen.getByRole('form', { name: 'Новая станция' })
    // The head names what is being edited, the track under it (#541 form rework).
    expect(within(form).getByRole('heading', { name: 'Новая станция' })).toBeTruthy()
    expect(within(form).getByText('Трек «Охват и подкасты»')).toBeTruthy()
    const placeholder = within(road('Охват и подкасты')).getByRole('status', {
      name: 'Здесь встанет новый блок',
    })
    expect(placeholder.textContent).toContain('Новая станция · гипотеза')
    fireEvent.change(within(form).getByLabelText('Что должно стать правдой?'), {
      target: { value: 'Первые 100 врачей' },
    })
    expect(placeholder.textContent).toContain('Первые 100 врачей')
  })
})

describe('station form (the AddStation artboard)', () => {
  function newStation() {
    const picker = openSlotPicker('Охват и подкасты', 0)
    fireEvent.click(within(picker).getByRole('menuitem', { name: 'Станция' }))
    return screen.getByRole('form', { name: 'Новая станция' })
  }

  it('refuses to save without «потому что» and does not call the server', () => {
    const save = vi.fn<Save>()
    renderEditable(save)
    enterEdit()
    const form = newStation()
    fireEvent.change(within(form).getByLabelText('Что должно стать правдой?'), {
      target: { value: 'Первые 100 врачей' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Поставить на дорогу' }))
    const because = within(form).getByLabelText('Потому что')
    expect(because.getAttribute('aria-invalid')).toBe('true')
    expect(within(form).getByText(/Без «потому что» станция не встанет на дорогу/)).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })

  it('saves with the base sha, the chosen target and confidence; refreshes and says «Сохранено»', async () => {
    const save = okSave()
    renderEditable(save)
    enterEdit()
    const form = newStation()
    fireEvent.change(within(form).getByLabelText('Что должно стать правдой?'), {
      target: { value: 'Первые 100 врачей' },
    })
    // «Что это открывает выше?»: one combobox; the beacon is the target above the top slot.
    const target = within(form).getByRole('combobox', { name: 'Что это открывает выше?' })
    expect(target.textContent).toBe('Маяк')
    fireEvent.change(within(form).getByLabelText('Потому что'), {
      target: { value: 'появится аудитория' },
    })
    const confidence = within(form).getByRole('group', { name: 'Насколько уверены?' })
    fireEvent.click(within(confidence).getByRole('button', { name: /Знаем/ }))
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Поставить на дорогу' }))
    })

    expect(save).toHaveBeenCalledWith({
      baseSha: 'sha-1',
      command: {
        op: 'node.add',
        trackId: 'reach',
        index: 2,
        type: 'station',
        fields: {
          title: 'Первые 100 врачей',
          owner: undefined,
          opens: 'beacon',
          because: 'появится аудитория',
          confidence: 'known',
        },
      },
    })
    expect(refresh).toHaveBeenCalled()
    expect(document.querySelector('.pm-ed-toast')?.textContent).toBe('Сохранено')
    expect(screen.queryByRole('form', { name: 'Новая станция' })).toBeNull()
  })

  it('groups the fields, keeps one footer, and puts moving and deleting last (#541 form rework)', () => {
    renderEditable(vi.fn())
    enterEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Править: станция «Готов первый урок»' }))
    const form = screen.getByRole('form', { name: 'Станция: Готов первый урок' })
    expect(within(form).getByRole('heading', { name: 'Станция' })).toBeTruthy()
    const why = within(form).getByRole('group', { name: 'Зачем она нужна' })
    expect(within(why).getByRole('combobox', { name: 'Что это открывает выше?' })).toBeTruthy()
    expect(within(why).getByLabelText('Потому что')).toBeTruthy()
    expect(within(form).getByRole('group', { name: 'Насколько уверены?' })).toBeTruthy()

    // «Переместить» is collapsed; the delete action comes after the one footer.
    const more = within(form).getByRole('button', { name: 'Переместить' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    const submit = within(form).getByRole('button', { name: 'Сохранить' })
    const remove = within(form).getByRole('button', { name: 'Удалить станцию' })
    expect(submit.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(remove.closest('.pm-ed-danger')).toBeTruthy()
  })

  it('opens the form of any card clicked on the map', () => {
    renderEditable(vi.fn())
    enterEdit()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Править: станция «Пилотный выпуск подкаста с экспертом»',
      }),
    )
    const form = screen.getByRole('form', { name: 'Станция: Пилотный выпуск подкаста с экспертом' })
    expect(within(form).getByLabelText('Что должно стать правдой?')).toHaveProperty(
      'value',
      'Пилотный выпуск подкаста с экспертом',
    )
  })
})

describe('barrier form — task tree', () => {
  function openBarrier() {
    fireEvent.click(screen.getByRole('button', { name: 'Править: шлагбаум «Каталог экспертов»' }))
    return screen.getByRole('region', { name: 'Задачи шлагбаума' })
  }

  it('keeps each row to a checkbox and a title; no tool-button rows', () => {
    renderEditable(vi.fn())
    enterEdit()
    const tree = openBarrier()
    for (const name of ['Изменить', '+ подзадача', 'Удалить', '↑', '↓']) {
      expect(within(tree).queryByRole('button', { name })).toBeNull()
    }
    expect(
      within(tree).getByRole('button', { name: 'Действия с задачей «Анкета эксперта»' }),
    ).toBeTruthy()
    expect(within(tree).getByRole('button', { name: '+ Задача' })).toBeTruthy()
  })

  it('toggles a task with today’s date', async () => {
    const save = okSave()
    renderEditable(save)
    enterEdit()
    const tree = openBarrier()
    const box = within(tree).getByRole('checkbox', { name: 'Выполнено: Анкета эксперта' })
    expect(box.getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      fireEvent.click(box)
    })
    const call = save.mock.calls[0][0]
    expect(call.command).toMatchObject({
      op: 'task.toggle',
      nodeId: 'experts-catalog',
      path: [1],
      expectTitle: 'Анкета эксперта',
    })
    expect((call.command as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('moves, edits and deletes through the row «⋯» menu', async () => {
    const save = okSave()
    renderEditable(save)
    enterEdit()
    const tree = openBarrier()
    openMenu(within(tree).getByRole('button', { name: 'Действия с задачей «Анкета эксперта»' }))
    const menu = screen.getByRole('menu', { name: 'Действия с задачей «Анкета эксперта»' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Изменить…', 'Добавить подзадачу', 'Выше', 'Ниже', 'Удалить…'])
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Выше' }))
    })
    expect(save.mock.calls[0][0].command).toEqual({
      op: 'task.move',
      nodeId: 'experts-catalog',
      path: [1],
      expectTitle: 'Анкета эксперта',
      delta: -1,
    })

    openMenu(within(tree).getByRole('button', { name: 'Действия с задачей «Анкета эксперта»' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить…' }))
    const fields = within(tree).getByRole('group', { name: 'Сохранить задачу' })
    expect(within(fields).getByLabelText('Задача')).toHaveProperty('value', 'Анкета эксперта')
  })
})

describe('task rows stay on their task (#541 re-review)', () => {
  const YAML = readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8')
  const withoutFirst = parsePathMap(
    YAML.replace(/ {10}- \{ title: Список первых 10 экспертов, done: 2026-10-28 \}\r?\n/, ''),
  )

  function openBarrier() {
    fireEvent.click(screen.getByRole('button', { name: 'Править: шлагбаум «Каталог экспертов»' }))
    return screen.getByRole('region', { name: 'Задачи шлагбаума' })
  }
  function rowMenu(tree: HTMLElement, title: string, item: string) {
    openMenu(within(tree).getByRole('button', { name: `Действия с задачей «${title}»` }))
    fireEvent.click(screen.getByRole('menuitem', { name: item }))
  }

  it('closes an open row draft when another row is deleted, and the save names its task', async () => {
    const save = okSave()
    const editing: PathMapEditing = { enabled: true, sha: 'sha-1', save }
    const view = render(el(PathMapView, { result: shipped, file: PATH_MAP_FILE, editing }))
    enterEdit()
    const tree = openBarrier()
    rowMenu(tree, 'Шаблон карточки эксперта', 'Изменить…')
    expect(within(tree).getByRole('group', { name: 'Сохранить задачу' })).toBeTruthy()

    rowMenu(tree, 'Список первых 10 экспертов', 'Удалить…')
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }),
      )
    })
    expect(save.mock.calls[0][0].command).toEqual({
      op: 'task.remove',
      nodeId: 'experts-catalog',
      path: [0],
      expectTitle: 'Список первых 10 экспертов',
    })
    expect(withoutFirst.ok).toBe(true)
    view.rerender(
      el(PathMapView, {
        result: withoutFirst,
        file: PATH_MAP_FILE,
        editing: { ...editing, sha: 'sha-2' },
      }),
    )
    // The draft of «Шаблон…» (was row 2) is closed, not left on whatever row 2 is now.
    expect(within(tree).queryByRole('group', { name: 'Сохранить задачу' })).toBeNull()

    rowMenu(tree, 'Шаблон карточки эксперта', 'Изменить…')
    const fields = within(tree).getByRole('group', { name: 'Сохранить задачу' })
    expect(within(fields).getByLabelText('Задача')).toHaveProperty(
      'value',
      'Шаблон карточки эксперта',
    )
    await act(async () => {
      fireEvent.click(within(fields).getByRole('button', { name: 'Сохранить задачу' }))
    })
    expect(save.mock.calls[1][0].command).toMatchObject({
      op: 'task.update',
      path: [1],
      expectTitle: 'Шаблон карточки эксперта',
    })
  })

  it('closes an open row draft when another row is moved', async () => {
    const save = okSave()
    renderEditable(save)
    enterEdit()
    const tree = openBarrier()
    rowMenu(tree, 'Шаблон карточки эксперта', 'Изменить…')
    openMenu(within(tree).getByRole('button', { name: 'Действия с задачей «Анкета эксперта»' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Выше' }))
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(within(tree).queryByRole('group', { name: 'Сохранить задачу' })).toBeNull()
  })

  it('names the parent on a new subtask', async () => {
    const save = okSave()
    renderEditable(save)
    enterEdit()
    const tree = openBarrier()
    rowMenu(tree, 'Анкета эксперта', 'Добавить подзадачу')
    const fields = within(tree).getByRole('group', { name: 'Добавить подзадачу' })
    fireEvent.change(within(fields).getByLabelText('Задача'), { target: { value: 'Вопросы' } })
    await act(async () => {
      fireEvent.click(within(fields).getByRole('button', { name: 'Добавить подзадачу' }))
    })
    expect(save.mock.calls[0][0].command).toMatchObject({
      op: 'task.add',
      parent: [1],
      parentTitle: 'Анкета эксперта',
    })
  })

  it('Esc in a row form cancels that row only; the barrier form stays', () => {
    renderEditable(vi.fn())
    enterEdit()
    const tree = openBarrier()
    rowMenu(tree, 'Анкета эксперта', 'Изменить…')
    const input = within(tree).getByLabelText('Задача')
    fireEvent.change(input, { target: { value: 'Анкета эксперта v2' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(within(tree).queryByRole('group', { name: 'Сохранить задачу' })).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('form', { name: 'Шлагбаум: Каталог экспертов' })).toBeTruthy()
  })

  it('counts typed task text as unsaved; Esc on the confirm returns to the form', async () => {
    renderEditable(vi.fn())
    enterEdit()
    const tree = openBarrier()
    fireEvent.click(within(tree).getByRole('button', { name: '+ Задача' }))
    fireEvent.change(within(tree).getByLabelText('Задача'), { target: { value: 'черновик' } })
    fireEvent.click(screen.getByRole('button', { name: 'Править маяк' }))
    await screen.findByRole('alertdialog', { name: 'Закрыть без сохранения?' })
    // Esc while the confirm is open means «Вернуться к форме».
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('form', { name: 'Шлагбаум: Каталог экспертов' })).toBeTruthy()
    expect(within(tree).getByLabelText('Задача')).toHaveProperty('value', 'черновик')
    // The pending switch is dropped, not replaced by «close»: a second Esc asks again.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })

  it('ties the link error to the field', () => {
    renderEditable(vi.fn())
    enterEdit()
    const tree = openBarrier()
    fireEvent.click(within(tree).getByRole('button', { name: '+ Задача' }))
    const fields = within(tree).getByRole('group', { name: 'Добавить задачу' })
    fireEvent.change(within(fields).getByLabelText('Задача'), { target: { value: 'x' } })
    const link = within(fields).getByLabelText('Ссылка')
    fireEvent.change(link, { target: { value: 'plane/1' } })
    fireEvent.click(within(fields).getByRole('button', { name: 'Добавить задачу' }))
    expect(link.getAttribute('aria-invalid')).toBe('true')
    const described = document.getElementById(link.getAttribute('aria-describedby') ?? '')
    expect(described?.textContent).toBe('Ссылка должна начинаться с http:// или https://')
  })
})

describe('focus after a menu choice (#541 re-review)', () => {
  it('moves to the first field when a type is chosen in a «+» slot', () => {
    renderEditable(vi.fn())
    enterEdit()
    const picker = openSlotPicker('Охват и подкасты', 0)
    fireEvent.click(within(picker).getByRole('menuitem', { name: 'Шлагбаум' }))
    const form = screen.getByRole('form', { name: 'Новый шлагбаум' })
    expect(document.activeElement).toBe(within(form).getByLabelText('Что мешает проехать?'))
  })

  it('follows a track that moved to the roadside to its new «⋯»', async () => {
    const save = okSave()
    const editing: PathMapEditing = { enabled: true, sha: 'sha-1', save }
    const view = render(el(PathMapView, { result: shipped, file: PATH_MAP_FILE, editing }))
    enterEdit()
    openMenu(
      within(road('Охват и подкасты')).getByRole('button', {
        name: 'Трек «Охват и подкасты»: действия',
      }),
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Убрать на обочину' }))
    })
    const yaml = readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8')
    const moved = parsePathMap(movedToRoadside(yaml, 'reach'))
    expect(moved.ok).toBe(true)
    view.rerender(
      el(PathMapView, {
        result: moved,
        file: PATH_MAP_FILE,
        editing: { ...editing, sha: 'sha-2' },
      }),
    )
    const roadside = screen.getByRole('complementary', { name: 'Обочина' })
    expect(document.activeElement).toBe(
      within(roadside).getByRole('button', { name: 'Трек «Охват и подкасты»: действия' }),
    )
  })
})

describe('track «⋯» menu', () => {
  it('sends a focus track to the roadside', async () => {
    const save = okSave()
    renderEditable(save)
    enterEdit()
    openMenu(
      within(road('Охват и подкасты')).getByRole('button', {
        name: 'Трек «Охват и подкасты»: действия',
      }),
    )
    const menu = screen.getByRole('menu', { name: 'Трек «Охват и подкасты»: действия' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Переименовать…', 'Убрать на обочину', 'Удалить трек…'])
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Убрать на обочину' }))
    })
    expect(save.mock.calls[0][0].command).toEqual({
      op: 'track.status',
      trackId: 'reach',
      status: 'roadside',
    })
  })

  it('brings a roadside track into a full focus through the swap dialog (focus trapped, returned)', async () => {
    renderEditable(vi.fn())
    enterEdit()
    const roadside = screen.getByRole('complementary', { name: 'Обочина' })
    const trigger = within(roadside).getByRole('button', {
      name: 'Трек «Фарма-партнёры»: действия',
    })
    openMenu(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Вывести в фокус…' }))

    const dialog = screen.getByRole('dialog', { name: 'Вывести трек в фокус' })
    const first = within(dialog).getAllByRole('radio')[0]
    const last = within(dialog).getByRole('button', { name: 'Отмена' })
    expect(document.activeElement).toBe(first)
    // Tab from the last enabled control wraps to the first; Shift+Tab from the first wraps back.
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Вывести трек в фокус' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('moves through the swap dialog radios with the arrow keys (#541 re-review)', () => {
    renderEditable(vi.fn())
    enterEdit()
    const roadside = screen.getByRole('complementary', { name: 'Обочина' })
    openMenu(within(roadside).getByRole('button', { name: 'Трек «Фарма-партнёры»: действия' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Вывести в фокус…' }))
    const dialog = screen.getByRole('dialog', { name: 'Вывести трек в фокус' })
    const radios = within(dialog).getAllByRole('radio')
    expect(radios.length).toBeGreaterThan(1)
    // One tab stop for the group.
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(
      radios.map((_, i) => (i === 0 ? '0' : '-1')),
    )
    fireEvent.keyDown(radios[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(radios[1])
    expect(radios[1].getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(radios[1], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(radios[0])
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(radios[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(radios[radios.length - 1])
  })
})

describe('deleting a block other blocks lead to', () => {
  it('warns, and repoints them by default — or leaves the break when unticked', async () => {
    const save = okSave()
    renderEditable(save)
    enterEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Править: станция «Готов первый урок»' }))
    const form = screen.getByRole('form', { name: 'Станция: Готов первый урок' })
    fireEvent.click(within(form).getByRole('button', { name: 'Удалить станцию' }))

    const confirm = screen.getByRole('alertdialog')
    expect(confirm.textContent).toContain(
      'На этот блок ссылаются 2 блока — их связь станет разрывом',
    )
    expect(confirm.textContent).toContain('Сценарий первого урока')
    const repoint = within(confirm).getByRole('checkbox', {
      name: 'Перенаправить их на «маяк»',
    })
    expect(repoint.getAttribute('aria-checked')).toBe('true')
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }))
    })
    expect(save.mock.calls[0][0].command).toEqual({
      op: 'node.remove',
      nodeId: 'first-lesson',
      inbound: 'repoint',
    })
  })

  it('sends `inbound: break` when the member keeps the break', async () => {
    const save = okSave()
    renderEditable(save)
    enterEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Править: станция «Готов первый урок»' }))
    const form = screen.getByRole('form', { name: 'Станция: Готов первый урок' })
    fireEvent.click(within(form).getByRole('button', { name: 'Удалить станцию' }))
    const confirm = screen.getByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('checkbox'))
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }))
    })
    expect(save.mock.calls[0][0].command).toMatchObject({ inbound: 'break' })
  })
})

describe('stale map', () => {
  it('shows «карта обновилась — перечитайте» with a reload button and keeps the form input', async () => {
    const save = vi.fn<Save>(async (): Promise<PathMapEditOutcome> => ({ status: 'stale' }))
    renderEditable(save)
    enterEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Править маяк' }))
    const form = screen.getByRole('form', { name: 'Маяк' })
    fireEvent.change(within(form).getByLabelText('Куда идём'), { target: { value: 'Новый маяк' } })
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }))
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Карта обновилась — перечитайте.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Перечитать карту' }))
    expect(refresh).toHaveBeenCalled()
    expect(
      within(screen.getByRole('form', { name: 'Маяк' })).getByLabelText('Куда идём'),
    ).toHaveProperty('value', 'Новый маяк')
  })
})

describe('closing a dirty form', () => {
  it('asks before discarding on Esc, and keeps the form on «Вернуться»', async () => {
    renderEditable(vi.fn())
    enterEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Править маяк' }))
    const input = within(screen.getByRole('form', { name: 'Маяк' })).getByLabelText('Куда идём')
    fireEvent.change(input, { target: { value: 'черновик' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    const ask = await screen.findByRole('alertdialog', { name: 'Закрыть без сохранения?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Вернуться к форме' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('form', { name: 'Маяк' })).toBeTruthy()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Закрыть' }),
    )
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Маяк' })).toBeNull())
  })
})
