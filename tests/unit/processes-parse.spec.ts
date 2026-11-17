// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { assembleModel, parseKnowledge } from '@/lib/processes'

/**
 * Turning the model files into what the viewer draws (#553) — the bbm-kb
 * viewer's `index.tsx` read, done per request: the model (index + diagrams) is
 * required, the explanations (registry + TO-BE document) are optional, exactly
 * as in bbm-kb, so a broken registry never takes the diagrams down.
 */

const EXAMPLE = join(import.meta.dirname, '..', '..', 'content', 'processes', 'example')
const read = (file: string) => readFileSync(join(EXAMPLE, file), 'utf8')

const files = () => ({
  index: read('model/index.yaml'),
  diagrams: {
    'A-0.yaml': read('model/A-0.yaml'),
    'A0.yaml': read('model/A0.yaml'),
    'A2.yaml': read('model/A2.yaml'),
  } as Record<string, string>,
  registry: read('registry-ru.md') as string | null,
  process: read('process-to-be-ru.md') as string | null,
})

describe('assembling the model (spec 553 EARS-603, EARS-615)', () => {
  it('EARS-603: every diagram carries its index id and parent, in index order', () => {
    const result = assembleModel(files())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.index.root).toBe('A-0')
    expect(result.model.diagrams.map((d) => [d.id, d.parent])).toEqual([
      ['A-0', null],
      ['A0', 'A-0'],
      ['A2', 'A0'],
    ])
    expect(result.model.knowledgeError).toBeNull()
  })

  it('EARS-615: a registry that is missing leaves the diagrams intact and says why', () => {
    const result = assembleModel({
      ...files(),
      registry: null,
      registryError: 'registry-ru.md: 404',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.knowledge).toBeNull()
    expect(result.model.knowledgeError).toContain('registry-ru.md')
    expect(result.model.diagrams).toHaveLength(3)
  })

  it('EARS-615: a registry the parser throws on leaves the diagrams intact', () => {
    const result = assembleModel({ ...files(), process: 42 as unknown as string })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.knowledge).toBeNull()
    expect(result.model.knowledgeError).toBeTruthy()
  })

  it('EARS-607: an index with no root or no diagram list is an invalid model', () => {
    const result = assembleModel({ ...files(), index: 'diagrams: []' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toContain('index.yaml')
  })

  it('EARS-607: a diagram file that does not parse is named in the error', () => {
    const f = files()
    f.diagrams['A2.yaml'] = 'boxes: [unclosed'
    const result = assembleModel(f)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toContain('A2.yaml')
  })

  it('EARS-607: a root that is not one of the diagrams is an invalid model', () => {
    const result = assembleModel({
      ...files(),
      index: read('model/index.yaml').replace('root: A-0', 'root: A9'),
    })
    expect(result.ok).toBe(false)
  })
})

describe('the registry explanations (spec 553 EARS-611) — bbm-kb registry.mjs, ported', () => {
  it('EARS-611: objects carry name, type, definition and status; functions their cluster', () => {
    const k = parseKnowledge(read('registry-ru.md'), read('process-to-be-ru.md'))
    expect(k.objects.get('O-005')).toMatchObject({
      name: 'Тесто',
      type: 'продукт',
      definition: 'Замешанная заготовка',
    })
    expect(k.objects.get('O-007')?.status).toBe('объединён')
    expect(k.functions.get('F-001')).toMatchObject({ name: 'Замесить тесто', cluster: 'К1' })
    expect(k.clusters.get('К2')).toBe('Продажа')
  })

  it('EARS-611: functions map to the TO-BE step they became; out-of-scope items carry the reason', () => {
    const k = parseKnowledge(read('registry-ru.md'), read('process-to-be-ru.md'))
    expect(k.steps.get('F-002')).toEqual([{ block: 1, text: 'Выпечь хлеб в разогретой печи.' }])
    expect(k.blocks.get(2)).toBe('Продать')
    expect(k.outOfScope.get('O-007')?.reason).toBe('объединены с отзывами')
  })
})
