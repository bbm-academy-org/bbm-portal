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

describe('the shipped map file', () => {
  it('lives at the documented path', () => {
    expect(PATH_MAP_FILE).toBe('content/path-map/doctor-school.yaml')
  })

  it('parses and passes validation', () => {
    const result = parsePathMap(readFileSync(join(repoRoot, PATH_MAP_FILE), 'utf8'))
    expect(result.ok ? [] : result.errors).toEqual([])
  })

  it('is what loadPathMap reads from the repo root', () => {
    const loaded = loadPathMap(repoRoot)
    expect(loaded.ok).toBe(true)
    expect(loaded.file).toBe(PATH_MAP_FILE)
  })

  it('carries the seeded example: 3 focus tracks, 1 roadside track, the deliberate break', () => {
    const loaded = loadPathMap(repoRoot)
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'))
    const { map } = loaded
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
    const text = readFileSync(join(repoRoot, PATH_MAP_FILE), 'utf8')
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
