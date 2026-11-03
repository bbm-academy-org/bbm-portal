// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PATH_MAP_FILE, loadPathMap, parsePathMap } from '@/lib/path-map'

/**
 * The path map's data door (#530): ONE YAML file in the repo, validated by a
 * zod schema at render time. These tests pin the contract the file's own header
 * comment and `content/path-map/README.md` promise to a person or an agent
 * editing it: what is an error (the page refuses to draw), what is only a
 * warning (the page draws and says so), and what is neither — an unknown
 * `opens` target is a «разрыв» the map SHOWS, not a schema error.
 */

const repoRoot = join(import.meta.dirname, '..', '..')
/** The design's example map, decoupled from the real content file (#530). */
const EXAMPLE_FILE = 'tests/fixtures/path-map/example.yaml'

const MINIMAL = `
title: Тест
beacon:
  title: Маяк
tracks:
  - id: a
    title: Трек А
    nodes:
      - id: s1
        type: station
        title: Станция
        because: потому что
        opens: beacon
`

describe('parsePathMap — schema', () => {
  it('accepts a minimal map and fills the limit defaults', () => {
    const result = parsePathMap(MINIMAL)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.map.limits).toEqual({
      focus_tracks: 3,
      visible_stations: 2,
      obstacles_per_station: 3,
    })
    expect(result.map.tracks[0].status).toBe('focus')
    expect(result.map.tracks[0].nodes[0]).toMatchObject({ type: 'station', confidence: 'known' })
    expect(result.warnings).toEqual([])
  })

  it('keeps an ISO date as a string (YAML core schema, no timestamp coercion)', () => {
    const result = parsePathMap(`${MINIMAL}
      - id: o1
        type: obstacle
        title: Препятствие
        opens: s1
        done: 2026-10-21
`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.map.tracks[0].nodes[1]).toMatchObject({ done: '2026-10-21' })
  })

  it('reports a YAML syntax error as an error, with the line', () => {
    const result = parsePathMap('title: [unclosed\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toMatch(/YAML/)
  })

  it('reports an unknown node type with the path to the field', () => {
    const result = parsePathMap(MINIMAL.replace('type: station', 'type: castle'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toContain('tracks[0].nodes[0]')
  })

  it('rejects a misspelt field instead of silently ignoring it', () => {
    const result = parsePathMap(MINIMAL.replace('because:', 'becuase:'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toMatch(/becuase/)
  })

  it('rejects a malformed date', () => {
    const result = parsePathMap(`${MINIMAL}
      - id: o1
        type: obstacle
        title: Препятствие
        done: 21.10.2026
`)
    expect(result.ok).toBe(false)
  })

  it('rejects duplicate node ids, naming the id', () => {
    const result = parsePathMap(`${MINIMAL}
      - id: s1
        type: fog
        title: Повтор
`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toMatch(/s1/)
  })

  it('rejects duplicate track ids', () => {
    const result = parsePathMap(`${MINIMAL}
  - id: a
    title: Ещё А
    nodes: []
`)
    expect(result.ok).toBe(false)
  })

  it('rejects the reserved id «beacon» on a node', () => {
    const result = parsePathMap(MINIMAL.replace('id: s1', 'id: beacon'))
    expect(result.ok).toBe(false)
  })

  it('does NOT treat an unknown `opens` target as an error — it is a break the map shows', () => {
    const result = parsePathMap(MINIMAL.replace('opens: beacon', 'opens: nowhere'))
    expect(result.ok).toBe(true)
  })

  it('more focus tracks than the limit is a warning («фокус переполнен»), not an error', () => {
    const tracks = ['b', 'c', 'd']
      .map((id) => `  - id: ${id}\n    title: Трек ${id}\n    nodes: []\n`)
      .join('')
    const result = parsePathMap(`${MINIMAL}${tracks}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.join('\n')).toMatch(/фокус переполнен/)
  })

  it('accepts an empty track list (the empty state)', () => {
    const result = parsePathMap('title: Пусто\nbeacon:\n  title: Маяк\ntracks: []\n')
    expect(result.ok).toBe(true)
  })
})

describe('the real map file', () => {
  it('lives at the documented path', () => {
    expect(PATH_MAP_FILE).toBe('content/path-map/doctor-school.yaml')
  })

  // The ONE check against the real content: whatever the map says, the file
  // must parse and validate. Everything content-specific runs on the fixture.
  it('is what loadPathMap reads from the repo root, and it parses with no errors', () => {
    const loaded = loadPathMap(repoRoot)
    expect(loaded.ok ? [] : loaded.errors).toEqual([])
    expect(loaded.file).toBe(PATH_MAP_FILE)
  })
})

describe('the example map (test fixture)', () => {
  const text = readFileSync(join(repoRoot, EXAMPLE_FILE), 'utf8')
  const parsed = parsePathMap(text)

  it('parses and passes validation', () => {
    expect(parsed.ok ? [] : parsed.errors).toEqual([])
  })

  it('carries the seeded example: 3 focus tracks, 1 roadside track, the deliberate break', () => {
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    const { map } = parsed
    expect(map.tracks.filter((t) => t.status === 'focus').map((t) => t.title)).toEqual([
      'Контент уроков',
      'Охват и подкасты',
      'Своя платформа',
    ])
    expect(map.tracks.filter((t) => t.status === 'roadside').map((t) => t.title)).toEqual([
      'Фарма-партнёры',
    ])
    const nodes = map.tracks.flatMap((t) => t.nodes)
    const twoSurfaces = nodes.find((n) => n.title === 'Две поверхности платформы в проде')
    expect(twoSurfaces?.opens).toBe('experts-sell-courses')
    expect(nodes.some((n) => n.id === 'experts-sell-courses')).toBe(false)
  })

  it('opens with a Russian format comment so it can be edited without the docs', () => {
    const header = text.split('\n').filter((line) => line.startsWith('#'))
    expect(header.length).toBeGreaterThanOrEqual(10)
    expect(header.join('\n')).toMatch(/opens/)
  })
})

describe('loadPathMap — a broken file', () => {
  it('returns the errors instead of throwing when the file is missing', () => {
    const loaded = loadPathMap(join(repoRoot, 'does-not-exist'))
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.errors.join('\n')).toMatch(/не найден|не прочитан/)
  })
})

describe('parsePathMap — friendliness to a hand or agent edit (review of PR #531)', () => {
  const errorsOf = (source: string): string => {
    const result = parsePathMap(source)
    expect(result.ok).toBe(false)
    return result.ok ? '' : result.errors.join('\n')
  }

  it('rejects an impossible calendar date with a Russian message', () => {
    const errors = errorsOf(`${MINIMAL}
      - id: o1
        type: obstacle
        title: Препятствие
        opens: s1
        done: 2026-13-45
`)
    expect(errors).toMatch(/tracks\[0\]\.nodes\[1\]\.done/)
    expect(errors).toMatch(/такой даты нет/)
  })

  it('rejects 30 February too — the date must exist in the calendar', () => {
    expect(errorsOf(MINIMAL.replace('title: Тест', 'title: Тест\nstarted: 2026-02-30'))).toMatch(
      /такой даты нет/,
    )
  })

  it('an empty file is a Russian error, not «expected object, received null»', () => {
    for (const source of ['', '# только комментарий\n']) {
      const errors = errorsOf(source)
      expect(errors).toMatch(/файл пуст/)
      expect(errors).not.toMatch(/expected|received/i)
    }
  })

  it('a bare `nodes:` (YAML null) reads as an empty track, not an English type error', () => {
    const result = parsePathMap(
      'title: Т\nbeacon:\n  title: М\ntracks:\n  - id: a\n    title: А\n    nodes:\n',
    )
    expect(result.ok ? [] : result.errors).toEqual([])
    if (!result.ok) return
    expect(result.map.tracks[0].nodes).toEqual([])
  })

  it('a bare `tracks:` reads as the empty map', () => {
    const result = parsePathMap('title: Т\nbeacon:\n  title: М\ntracks:\n')
    expect(result.ok ? [] : result.errors).toEqual([])
  })

  it('a wrong value type is reported in Russian', () => {
    const errors = errorsOf('title: Т\nbeacon:\n  title: М\ntracks: просто текст\n')
    expect(errors).toMatch(/^tracks: /m)
    expect(errors).not.toMatch(/expected|received|Invalid/i)
  })

  it('a missing required field is reported in Russian', () => {
    const errors = errorsOf('title: Т\ntracks: []\n')
    expect(errors).toMatch(/beacon/)
    expect(errors).not.toMatch(/expected|received|Invalid/i)
  })

  it('accepts a numeric title by reading it as text', () => {
    const result = parsePathMap(MINIMAL.replace('title: Станция', 'title: 2026'))
    expect(result.ok ? [] : result.errors).toEqual([])
    if (!result.ok) return
    expect(result.map.tracks[0].nodes[0].title).toBe('2026')
  })

  it('pluralises the focus overflow warning («5 треков»)', () => {
    const tracks = ['b', 'c', 'd', 'e']
      .map((id) => `  - id: ${id}\n    title: Трек ${id}\n    nodes: []\n`)
      .join('')
    const result = parsePathMap(`${MINIMAL}${tracks}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.join('\n')).toContain('в фокусе 5 треков')
  })
})

describe('parsePathMap — the track `short` label (mobile tabs)', () => {
  it('accepts an optional `short` on a track', () => {
    const result = parsePathMap(MINIMAL.replace('title: Трек А', 'title: Трек А\n    short: А'))
    expect(result.ok ? [] : result.errors).toEqual([])
    if (!result.ok) return
    expect(result.map.tracks[0].short).toBe('А')
  })

  it('the example map gives every focus track a short label', () => {
    const parsed = parsePathMap(readFileSync(join(repoRoot, EXAMPLE_FILE), 'utf8'))
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    expect(parsed.map.tracks.filter((t) => t.status === 'focus').map((t) => t.short)).toEqual([
      'Контент',
      'Охват',
      'Платформа',
    ])
  })

  it('the example file header documents `short` and fog with `opens`', () => {
    const text = readFileSync(join(repoRoot, EXAMPLE_FILE), 'utf8')
    const header = text.split('\n').filter((line) => line.startsWith('#'))
    expect(header.join('\n')).toMatch(/short/)
    expect(header.join('\n')).toMatch(/через туман/)
  })
})

describe('parsePathMap — tasks inside an obstacle (#536)', () => {
  const withTasks = (tasks: string) => `${MINIMAL}
      - id: o1
        type: obstacle
        title: Препятствие
        opens: s1
        tasks:
${tasks}`

  const errorsOf = (source: string) => {
    const result = parsePathMap(source)
    expect(result.ok).toBe(false)
    return result.ok ? '' : result.errors.join('\n')
  }

  it('accepts nested tasks with done as true/false or a date, an owner and a link', () => {
    const result = parsePathMap(
      withTasks(`          - title: Свет и звук
            owner: ДС
            tasks:
              - { title: Микрофоны, done: 2026-10-24 }
              - { title: Свет, done: true, link: 'https://github.com/bbm-academy-org/bbm-portal/issues/536' }
              - { title: Тест, done: false }
          - title: Монтажёр
`),
    )
    expect(result.ok ? [] : result.errors).toEqual([])
    if (!result.ok) return
    const obstacle = result.map.tracks[0].nodes[1]
    if (obstacle.type !== 'obstacle') throw new Error('expected an obstacle')
    expect(obstacle.tasks?.[0]).toMatchObject({ title: 'Свет и звук', owner: 'ДС' })
    expect(obstacle.tasks?.[0].tasks?.map((t) => t.done)).toEqual(['2026-10-24', true, false])
    expect(obstacle.tasks?.[0].tasks?.[1].link).toBe(
      'https://github.com/bbm-academy-org/bbm-portal/issues/536',
    )
  })

  it('rejects a misspelt task field, naming the path', () => {
    const errors = errorsOf(withTasks(`          - { title: Задача, onwer: ДС }\n`))
    expect(errors).toContain('tracks[0].nodes[1].tasks[0]')
    expect(errors).toMatch(/неизвестное поле «onwer»/)
  })

  it('rejects a task without a title', () => {
    expect(errorsOf(withTasks(`          - { done: true }\n`))).toMatch(
      /tasks\[0\]\.title: обязательное поле не заполнено/,
    )
  })

  it('rejects a done that is neither yes/no nor a real date, in Russian', () => {
    const errors = errorsOf(withTasks(`          - { title: Задача, done: 2026-02-30 }\n`))
    expect(errors).toMatch(/tasks\[0\]\.done: .*true.*ГГГГ-ММ-ДД/)
  })

  it('rejects a link that is not an http(s) URL', () => {
    const errors = errorsOf(withTasks(`          - { title: Задача, link: 'plane DSO-1' }\n`))
    expect(errors).toMatch(/tasks\[0\]\.link: ссылка/)
  })

  it('accepts five levels of nesting and rejects the sixth, in Russian', () => {
    const nest = (levels: number): string => {
      let yaml = ''
      for (let i = 0; i < levels; i++) {
        const pad = ' '.repeat(10 + i * 4)
        yaml += `${pad}- title: Уровень ${i + 1}\n`
        if (i < levels - 1) yaml += `${pad}  tasks:\n`
      }
      return yaml
    }
    expect(parsePathMap(withTasks(nest(5))).ok).toBe(true)
    expect(errorsOf(withTasks(nest(6)))).toMatch(/tracks\[0\]\.nodes\[1\]: .*не глубже 5 уровней/)
  })

  it('tasks are an obstacle field only — a station with tasks is an error', () => {
    const errors = errorsOf(
      MINIMAL.replace('opens: beacon', 'opens: beacon\n        tasks: [ { title: Задача } ]'),
    )
    expect(errors).toMatch(/неизвестное поле «tasks»/)
  })

  it('the example map gives the open studio obstacle a two-level task tree', () => {
    const parsed = parsePathMap(readFileSync(join(repoRoot, EXAMPLE_FILE), 'utf8'))
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    const studio = parsed.map.tracks[0].nodes.find((n) => n.id === 'studio')
    if (studio?.type !== 'obstacle') throw new Error('studio is not an obstacle')
    expect(studio.tasks?.some((t) => (t.tasks?.length ?? 0) > 0)).toBe(true)
  })

  it('the content file header documents `tasks`', () => {
    const text = readFileSync(join(repoRoot, 'content/path-map/doctor-school.yaml'), 'utf8')
    const header = text.split('\n').filter((line) => line.startsWith('#'))
    expect(header.join('\n')).toMatch(/tasks/)
    expect(header.join('\n')).toMatch(/link/)
  })
})
