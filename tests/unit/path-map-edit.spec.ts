import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyEdit, editCommandSchema, slugifyTitle, type EditCommand } from '@/lib/path-map/edit'
import { parsePathMap } from '@/lib/path-map/parse'
import type { PathMap } from '@/lib/path-map/schema'
import { getTaskAt } from '@/lib/path-map/tasks'

/**
 * «Карта пути» v2, task D (#539) — the mutation model behind editing the map in
 * the UI. Every command is applied to the YAML TEXT through the `yaml`
 * Document API, so the file's header comment block, inline comments, quoting,
 * flow-style task rows and key order survive; the result is re-validated with
 * the module's own parser.
 */

const repoRoot = join(import.meta.dirname, '..', '..')
const FIXTURE = readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8')
  .split('\r\n')
  .join('\n')

function apply(command: EditCommand, text = FIXTURE) {
  const result = applyEdit(text, command)
  if (!result.ok) throw new Error(`edit refused: ${result.errors.join('; ')}`)
  return result
}

function mapOf(text: string): PathMap {
  const parsed = parsePathMap(text)
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  return parsed.map
}

function nodeIds(map: PathMap, trackId: string): string[] {
  return map.tracks.find((t) => t.id === trackId)!.nodes.map((n) => n.id)
}

function headerOf(text: string): string {
  return text.slice(0, text.indexOf('title: Doctor.School'))
}

describe('applyEdit — YAML preservation', () => {
  it('keeps the header comment block, inline comments and untouched lines byte-for-byte', () => {
    const { text } = apply({
      op: 'node.update',
      nodeId: 'podcast-pilot',
      fields: {
        title: 'Пилотный выпуск с экспертом',
        confidence: 'hypothesis',
        because: 'врачи придут за знакомым экспертом',
        opens: 'beacon',
      },
    })
    expect(headerOf(text)).toBe(headerOf(FIXTURE))
    expect(text).toContain('# Намеренный разрыв: станции experts-sell-courses на карте нет.')
    expect(text).toContain(
      '# Нет because — станция стоит на обочине, пока не ясно, что она открывает выше.',
    )
    // The flow-style task rows of other obstacles are untouched.
    expect(text).toContain('- { title: Купить петличные микрофоны, done: 2026-10-24 }')
    // Only the edited title line changed.
    const before = FIXTURE.split('\n')
    const after = text.split('\n')
    expect(after).toHaveLength(before.length)
    const changed = after.filter((line, i) => line !== before[i])
    expect(changed).toEqual(['        title: Пилотный выпуск с экспертом'])
  })

  it('keeps the quoting style of a value it rewrites', () => {
    const { text } = apply({
      op: 'node.update',
      nodeId: 'first-lesson',
      fields: {
        title: 'Готов первый урок',
        confidence: 'known',
        because: 'врачам будет что учить',
        opens: 'beacon',
      },
    })
    expect(text).toContain("        because: 'врачам будет что учить'")
  })

  it('writes keys of a new node in the canonical order', () => {
    const { text, map } = apply({
      op: 'node.add',
      trackId: 'reach',
      index: 1,
      type: 'station',
      fields: {
        title: 'Первые 100 врачей',
        confidence: 'hypothesis',
        because: 'появится аудитория',
        opens: 'beacon',
      },
    })
    expect(nodeIds(map, 'reach')).toEqual(['podcast-pilot', 'pervye-100-vrachey', 'reach-fog'])
    const block = text.slice(text.indexOf('- id: pervye-100-vrachey'))
    const keys = block
      .split('\n')
      .slice(0, 6)
      .map((l) => l.trim().replace(/^- /, '').split(':')[0])
    expect(keys).toEqual(['id', 'type', 'title', 'confidence', 'because', 'opens'])
  })

  it('preserves CRLF line endings of the input', () => {
    const crlf = FIXTURE.split('\n').join('\r\n')
    const result = applyEdit(crlf, { op: 'beacon.update', title: 'Новый маяк', why: 'зачем' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text.includes('\r\n')).toBe(true)
      expect(result.text.replace(/\r\n/g, '').includes('\n')).toBe(false)
    }
  })
})

describe('applyEdit — nodes', () => {
  it('adds a station with a generated, unique id', () => {
    const first = apply({
      op: 'node.add',
      trackId: 'content',
      index: 0,
      type: 'fog',
      fields: { title: 'Курс или серия отдельных уроков?' },
    })
    expect(nodeIds(first.map, 'content')[0]).toBe('kurs-ili-seriya-otdelnyh-urokov')
    const second = apply(
      {
        op: 'node.add',
        trackId: 'content',
        index: 0,
        type: 'fog',
        fields: { title: 'Курс или серия отдельных уроков?' },
      },
      first.text,
    )
    expect(nodeIds(second.map, 'content')[0]).toBe('kurs-ili-seriya-otdelnyh-urokov-2')
    expect(second.summary).toBe('добавить туман «Курс или серия отдельных уроков?»')
  })

  it('refuses a station without «потому что»', () => {
    const result = applyEdit(FIXTURE, {
      op: 'node.add',
      trackId: 'reach',
      index: 0,
      type: 'station',
      fields: { title: 'Станция', confidence: 'known', because: '  ' },
    })
    expect(result).toEqual({
      ok: false,
      errors: ['станции нужно «потому что»: чем она приближает маяк'],
    })
  })

  it('updates an obstacle and drops the optional fields left empty', () => {
    const { map, summary } = apply({
      op: 'node.update',
      nodeId: 'experts-catalog',
      fields: { title: 'Каталог экспертов v2' },
    })
    const node = map.tracks[2].nodes[1]
    expect(node).toMatchObject({
      id: 'experts-catalog',
      type: 'obstacle',
      title: 'Каталог экспертов v2',
    })
    expect(node).not.toHaveProperty('owner')
    expect(node).not.toHaveProperty('opens')
    // Tasks are not the form's business: they survive a field update.
    expect(node.type === 'obstacle' && node.tasks).toHaveLength(3)
    expect(summary).toBe('изменить шлагбаум «Каталог экспертов v2»')
  })

  it('removes a node', () => {
    const { map, summary } = apply({ op: 'node.remove', nodeId: 'reach-fog' })
    expect(nodeIds(map, 'reach')).toEqual(['podcast-pilot'])
    expect(summary).toBe('удалить туман «Какой канал приведёт первых врачей?»')
  })

  it('moves a node within a track and across tracks, keeping its comment', () => {
    const up = apply({ op: 'node.move', nodeId: 'two-surfaces', trackId: 'platform', index: 0 })
    expect(nodeIds(up.map, 'platform')[0]).toBe('two-surfaces')
    expect(up.text).toContain('# Намеренный разрыв')

    const across = apply({ op: 'node.move', nodeId: 'mobile-app', trackId: 'pharma', index: 2 })
    expect(nodeIds(across.map, 'platform')).not.toContain('mobile-app')
    expect(nodeIds(across.map, 'pharma')).toEqual([
      'first-pharma-pilot',
      'pharma-fog',
      'mobile-app',
    ])
    expect(across.text).toContain('# Нет because')
  })

  it('marks a barrier removed with a date and undoes it', () => {
    const removed = apply({ op: 'barrier.remove', nodeId: 'experts-catalog', date: '2026-11-04' })
    const node = removed.map.tracks[2].nodes[1]
    expect(node.type === 'obstacle' && node.done).toBe('2026-11-04')
    expect(removed.text).toContain('        done: 2026-11-04\n        tasks:')
    expect(removed.summary).toBe('снять шлагбаум «Каталог экспертов»')

    const back = apply({ op: 'barrier.restore', nodeId: 'experts-catalog' }, removed.text)
    expect(back.text).toBe(FIXTURE)
  })

  it('refuses an unknown node or a barrier command on a station', () => {
    expect(applyEdit(FIXTURE, { op: 'node.remove', nodeId: 'nope' })).toEqual({
      ok: false,
      errors: ['блока «nope» на карте нет — возможно, его уже удалили; перечитайте карту'],
    })
    const wrong = applyEdit(FIXTURE, {
      op: 'barrier.remove',
      nodeId: 'first-lesson',
      date: '2026-11-04',
    })
    expect(wrong.ok).toBe(false)
  })

  it("rejects a result the schema refuses, with the parser's Russian error", () => {
    const result = applyEdit(FIXTURE, {
      op: 'barrier.remove',
      nodeId: 'experts-catalog',
      date: '2026-02-30',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/такой даты нет в календаре/)
  })
})

describe('applyEdit — tracks', () => {
  it('adds a track at the end with a generated id', () => {
    const { map, summary } = apply({ op: 'track.add', title: 'Юридика', status: 'roadside' })
    expect(map.tracks.at(-1)).toMatchObject({
      id: 'yuridika',
      title: 'Юридика',
      status: 'roadside',
      nodes: [],
    })
    expect(summary).toBe('добавить трек «Юридика»')
  })

  it('renames a track and sets / drops its short label', () => {
    const renamed = apply({
      op: 'track.update',
      trackId: 'reach',
      title: 'Охват',
      short: undefined,
    })
    expect(renamed.map.tracks[1].title).toBe('Охват')
    expect(renamed.map.tracks[1].short).toBeUndefined()
    expect(renamed.summary).toBe('изменить трек «Охват»')
    const labelled = apply({
      op: 'track.update',
      trackId: 'pharma',
      title: 'Фарма',
      short: 'Фарма',
    })
    expect(labelled.text).toContain('    title: Фарма\n    short: Фарма\n    status: roadside')
  })

  it('refuses to bring a track into a full focus without a swap, and swaps when asked', () => {
    const refused = applyEdit(FIXTURE, { op: 'track.status', trackId: 'pharma', status: 'focus' })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.errors[0]).toMatch(/Фокус полон/)

    const swapped = apply({
      op: 'track.status',
      trackId: 'pharma',
      status: 'focus',
      swapWith: 'reach',
    })
    const status = Object.fromEntries(swapped.map.tracks.map((t) => [t.id, t.status]))
    expect(status).toEqual({
      content: 'focus',
      reach: 'roadside',
      platform: 'focus',
      pharma: 'focus',
    })
    expect(swapped.summary).toBe('вывести трек «Фарма-партнёры» в фокус вместо «Охват и подкасты»')
  })

  it('sends a track to the roadside', () => {
    const { map } = apply({ op: 'track.status', trackId: 'content', status: 'roadside' })
    expect(map.tracks[0].status).toBe('roadside')
  })

  it('removes an empty track, and a non-empty one only when forced', () => {
    const refused = applyEdit(FIXTURE, { op: 'track.remove', trackId: 'pharma' })
    expect(refused.ok).toBe(false)
    const forced = apply({ op: 'track.remove', trackId: 'pharma', force: true })
    expect(forced.map.tracks.map((t) => t.id)).toEqual(['content', 'reach', 'platform'])
  })
})

describe('applyEdit — tasks', () => {
  const obstacle = (map: PathMap) => {
    const node = map.tracks[0].nodes[1]
    if (node.type !== 'obstacle') throw new Error('not an obstacle')
    return node
  }

  it('adds a task and a subtask in the sibling style', () => {
    const top = apply({
      op: 'task.add',
      nodeId: 'studio',
      parent: [],
      fields: { title: 'Сдать студию' },
    })
    expect(obstacle(top.map).tasks?.at(-1)).toEqual({ title: 'Сдать студию' })
    // Siblings at the top level are block maps, so the new one is too.
    expect(top.text).toContain('          - title: Сдать студию\n')

    const sub = apply({
      op: 'task.add',
      nodeId: 'studio',
      parent: [2],
      fields: { title: 'Найти монтажёра', owner: 'ЕВ' },
    })
    expect(getTaskAt(obstacle(sub.map).tasks, [2, 0])).toEqual({
      title: 'Найти монтажёра',
      owner: 'ЕВ',
    })
    expect(sub.summary).toBe('добавить задачу «Найти монтажёра» в «Довести студию до готовности»')
  })

  it('updates a task, keeping its children', () => {
    const { map } = apply({
      op: 'task.update',
      nodeId: 'studio',
      path: [0],
      fields: { title: 'Свет, звук и камера', owner: 'МК', link: 'https://plane.example/1' },
    })
    const task = getTaskAt(obstacle(map).tasks, [0])
    expect(task).toMatchObject({
      title: 'Свет, звук и камера',
      owner: 'МК',
      link: 'https://plane.example/1',
    })
    expect(task?.tasks).toHaveLength(3)
  })

  it('toggles a leaf task done with a date and back', () => {
    const done = apply({ op: 'task.toggle', nodeId: 'studio', path: [0, 2], date: '2026-11-04' })
    expect(getTaskAt(obstacle(done.map).tasks, [0, 2])?.done).toBe('2026-11-04')
    const open = apply(
      { op: 'task.toggle', nodeId: 'studio', path: [0, 2], date: '2026-11-04' },
      done.text,
    )
    expect(open.text).toBe(FIXTURE)
  })

  it('removes and reorders tasks', () => {
    const removed = apply({ op: 'task.remove', nodeId: 'studio', path: [1, 1, 0] })
    expect(getTaskAt(obstacle(removed.map).tasks, [1, 1])?.tasks).toHaveLength(1)

    const moved = apply({ op: 'task.move', nodeId: 'studio', path: [2], delta: -1 })
    expect(obstacle(moved.map).tasks?.map((t) => t.title)).toEqual([
      'Свет и звук',
      'Монтажёр на поток',
      'Площадка',
    ])
    const edge = applyEdit(FIXTURE, { op: 'task.move', nodeId: 'studio', path: [0], delta: -1 })
    expect(edge.ok).toBe(false)
  })

  it('refuses a task path that leads nowhere and a subtree deeper than the cap', () => {
    expect(applyEdit(FIXTURE, { op: 'task.remove', nodeId: 'studio', path: [9] }).ok).toBe(false)
    let text = FIXTURE
    let parent: number[] = [1, 1, 0]
    // depth 3 → 4 → 5 fine, 6 refused by the parser's depth cap.
    for (const title of ['d4', 'd5']) {
      text = apply({ op: 'task.add', nodeId: 'studio', parent, fields: { title } }, text).text
      parent = [...parent, 0]
    }
    const tooDeep = applyEdit(text, {
      op: 'task.add',
      nodeId: 'studio',
      parent,
      fields: { title: 'd6' },
    })
    expect(tooDeep.ok).toBe(false)
    if (!tooDeep.ok) expect(tooDeep.errors.join()).toMatch(/не глубже 5 уровней/)
  })
})

describe('applyEdit — beacon and refusals', () => {
  it('updates the beacon', () => {
    const { map, summary } = apply({ op: 'beacon.update', title: 'Маяк', why: undefined })
    expect(map.beacon).toEqual({ title: 'Маяк' })
    expect(summary).toBe('изменить маяк «Маяк»')
  })

  it('refuses to edit a file that is already invalid', () => {
    const result = applyEdit('title: [', { op: 'beacon.update', title: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatch(/^Файл карты сейчас с ошибками/)
  })
})

describe('editCommandSchema', () => {
  it('accepts a known command and rejects junk', () => {
    expect(editCommandSchema.safeParse({ op: 'node.remove', nodeId: 'studio' }).success).toBe(true)
    expect(editCommandSchema.safeParse({ op: 'drop.table' }).success).toBe(false)
    expect(
      editCommandSchema.safeParse({ op: 'task.toggle', nodeId: 'studio', path: [0], date: 'today' })
        .success,
    ).toBe(false)
  })
})

describe('slugifyTitle', () => {
  it('transliterates Russian and falls back for symbols-only titles', () => {
    expect(slugifyTitle('Готов первый урок')).toBe('gotov-pervyy-urok')
    expect(slugifyTitle('Ёж и щука — 2026!')).toBe('yozh-i-schuka-2026')
    expect(slugifyTitle('???')).toBe('node')
  })
})
