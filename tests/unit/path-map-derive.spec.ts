// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { buildMapView, checkPath, parsePathMap, type PathMap } from '@/lib/path-map'

/**
 * The map's derived logic (#530), pure over a parsed map: the path check, the
 * «Мы здесь» boundary, the roadside, the fog collapse, the «разбей станцию»
 * hint. Fixtures are YAML so they read like the file a person edits.
 */

function mapOf(yaml: string): PathMap {
  const result = parsePathMap(yaml)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.map
}

const HEAD = `
title: Тест
beacon:
  title: Маяк
`

describe('checkPath — following `opens` up to the beacon', () => {
  const map = mapOf(`${HEAD}
tracks:
  - id: a
    title: А
    nodes:
      - { id: o1, type: obstacle, title: Препятствие, owner: ДС, opens: s1 }
      - { id: s1, type: station, title: Станция 1, because: потому что, opens: s2 }
      - { id: s2, type: station, title: Станция 2, because: потому что, confidence: hypothesis, opens: beacon }
      - { id: lost, type: station, title: Обрыв, because: потому что, opens: missing-id }
      - { id: nob, type: station, title: Без потому что, opens: beacon }
      - { id: o2, type: obstacle, title: Ведёт к станции без потому что, opens: nob }
      - { id: f1, type: fog, title: Туман? }
      - { id: loop1, type: station, title: Петля 1, because: x, opens: loop2 }
      - { id: loop2, type: station, title: Петля 2, because: x, opens: loop1 }
      - { id: dead, type: obstacle, title: Никуда }
      - { id: cross, type: obstacle, title: Через трек, opens: b1 }
  - id: b
    title: Б
    nodes:
      - { id: b1, type: station, title: Станция Б, because: x, opens: beacon }
`)

  it('a chain that reaches the beacon lists every link from the start upward', () => {
    const result = checkPath(map, 'o1')
    expect(result.reached).toBe(true)
    expect(result.chain.map((n) => n.id)).toEqual(['o1', 's1', 's2'])
    expect(result.break).toBeNull()
  })

  it('reports the weakest confidence along a reached chain («по грунтовке»)', () => {
    expect(checkPath(map, 'o1').confidence).toBe('hypothesis')
    expect(checkPath(map, 'b1').confidence).toBe('known')
  })

  it('an unknown `opens` target is a break at the node that names it', () => {
    const result = checkPath(map, 'lost')
    expect(result.reached).toBe(false)
    expect(result.chain.map((n) => n.id)).toEqual(['lost'])
    expect(result.break).toEqual({ kind: 'unknown-target', at: 'lost', target: 'missing-id' })
  })

  it('a station without «потому что» breaks the chain at that station', () => {
    const result = checkPath(map, 'o2')
    expect(result.reached).toBe(false)
    expect(result.chain.map((n) => n.id)).toEqual(['o2', 'nob'])
    expect(result.break).toEqual({ kind: 'missing-because', at: 'nob' })
  })

  it('a cycle is a break, not an endless loop', () => {
    const result = checkPath(map, 'loop1')
    expect(result.reached).toBe(false)
    expect(result.break).toEqual({ kind: 'cycle', at: 'loop2', target: 'loop1' })
  })

  it('a node with no `opens` is a break; a fog card is its own kind of break', () => {
    expect(checkPath(map, 'dead').break).toEqual({ kind: 'no-opens', at: 'dead' })
    expect(checkPath(map, 'f1').break).toEqual({ kind: 'fog', at: 'f1' })
  })

  it('a chain may cross into another track', () => {
    const result = checkPath(map, 'cross')
    expect(result.reached).toBe(true)
    expect(result.chain.map((n) => [n.id, n.trackId])).toEqual([
      ['cross', 'a'],
      ['b1', 'b'],
    ])
  })

  it('an unknown start id is reported, not thrown', () => {
    const result = checkPath(map, 'nope')
    expect(result.reached).toBe(false)
    expect(result.chain).toEqual([])
    expect(result.break).toEqual({ kind: 'unknown-target', at: null, target: 'nope' })
  })
})

describe('buildMapView — the track layout', () => {
  const map = mapOf(`${HEAD}
limits: { focus_tracks: 2, visible_stations: 2, obstacles_per_station: 2 }
tracks:
  - id: a
    title: А
    nodes:
      - { id: done1, type: obstacle, title: Сделано раньше, opens: s1, done: 2026-10-14 }
      - { id: done2, type: obstacle, title: Сделано позже, opens: s1, done: 2026-10-21 }
      - { id: o1, type: obstacle, title: Открытое 1, opens: s1 }
      - { id: o2, type: obstacle, title: Открытое 2, opens: s1 }
      - { id: o3, type: obstacle, title: Открытое 3, opens: s1 }
      - { id: s1, type: station, title: Станция 1, because: x, opens: s2 }
      - { id: nob, type: station, title: Без потому что, opens: beacon }
      - { id: s2, type: station, title: Станция 2, because: x, opens: s3 }
      - { id: s3, type: station, title: Станция 3, because: x, opens: s4 }
      - { id: s4, type: station, title: Станция 4, because: x, opens: beacon }
      - { id: f1, type: fog, title: Туман наверху }
  - id: b
    title: Б
    nodes: []
  - id: c
    title: В
    status: roadside
    nodes:
      - { id: c1, type: station, title: На обочине, because: x, opens: beacon }
      - { id: cf, type: fog, title: Дальше туман }
`)
  const view = buildMapView(map)
  const a = view.focus.find((t) => t.id === 'a')!

  it('done obstacles go below «Мы здесь», bottom→top, with their dates', () => {
    expect(a.passed.map((p) => [p.node.id, p.node.done])).toEqual([
      ['done1', '2026-10-14'],
      ['done2', '2026-10-21'],
    ])
    expect(a.upcoming.some((item) => item.kind === 'node' && item.node.id === 'done1')).toBe(false)
  })

  it('a station without «потому что» leaves the road for the roadside panel', () => {
    const onRoad = a.upcoming.flatMap((item) => (item.kind === 'node' ? [item.node.id] : []))
    expect(onRoad).not.toContain('nob')
    expect(view.roadsideStations.map((r) => [r.node.id, r.trackTitle])).toEqual([['nob', 'А']])
  })

  it('beyond `visible_stations` upcoming stations the rest of the track collapses into fog', () => {
    const onRoad = a.upcoming.flatMap((item) => (item.kind === 'node' ? [item.node.id] : []))
    expect(onRoad).toEqual(['o1', 'o2', 'o3', 's1', 's2'])
    const collapsed = a.upcoming.at(-1)
    expect(collapsed?.kind).toBe('collapsed')
    if (collapsed?.kind !== 'collapsed') return
    expect(collapsed.nodes.map((n) => n.id)).toEqual(['s3', 's4', 'f1'])
  })

  it('too many open obstacles on one station gives the «разбей станцию» hint', () => {
    const s1 = a.upcoming.find((item) => item.kind === 'node' && item.node.id === 's1')
    expect(s1).toMatchObject({ kind: 'node', openObstacles: 3, overloaded: true })
    const s2 = a.upcoming.find((item) => item.kind === 'node' && item.node.id === 's2')
    expect(s2).toMatchObject({ openObstacles: 0, overloaded: false })
  })

  it('roadside tracks go to the roadside panel with a one-line summary', () => {
    expect(view.focus.map((t) => t.id)).toEqual(['a', 'b'])
    expect(view.roadsideTracks).toEqual([
      expect.objectContaining({ id: 'c', title: 'В', summary: '1 станция · дальше туман' }),
    ])
  })

  it('counts focus tracks against the limit', () => {
    expect(view.focusCount).toBe(2)
    expect(view.focusLimit).toBe(2)
    expect(view.focusOverflow).toBe(false)
  })

  it('checks every focus track from its lowest open node; an empty track has no road', () => {
    const checks = Object.fromEntries(view.trackChecks.map((c) => [c.trackId, c.result]))
    expect(checks.a?.chain[0]?.id).toBe('o1')
    expect(checks.b).toBeNull()
  })
})

describe('buildMapView — overflow and the empty map', () => {
  it('flags «фокус переполнен» when more tracks are in focus than the limit allows', () => {
    const map = mapOf(`${HEAD}
limits: { focus_tracks: 1 }
tracks:
  - { id: a, title: А, nodes: [] }
  - { id: b, title: Б, nodes: [] }
`)
    const view = buildMapView(map)
    expect(view.focusOverflow).toBe(true)
  })

  it('an empty track list is the empty state', () => {
    const view = buildMapView(mapOf(`${HEAD}\ntracks: []\n`))
    expect(view.empty).toBe(true)
  })

  it('a station with confidence «unknown» stays on the road but is drawn as fog', () => {
    const view = buildMapView(
      mapOf(`${HEAD}
tracks:
  - id: a
    title: А
    nodes:
      - { id: s1, type: station, title: Неизвестно, because: x, confidence: unknown, opens: beacon }
`),
    )
    expect(view.focus[0].upcoming[0]).toMatchObject({
      kind: 'node',
      node: { id: 's1' },
      look: 'fog',
    })
  })
})
