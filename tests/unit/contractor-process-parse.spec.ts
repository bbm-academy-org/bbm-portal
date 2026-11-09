// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CONTRACTOR_PROCESS_EXAMPLE_FILE,
  parseContractorProcess,
  type ContractorProcess,
} from '@/lib/contractor-process'

/**
 * The data door of «Как работаем с исполнителями» (#545): one JSON file —
 * `processes/contractors.json` in the private `path-maps` repo, or the public
 * example committed here — validated before anything is drawn. The tests pin
 * what a person editing that file is told: every violation is its own Russian
 * message that names the field by its path.
 */

const repoRoot = join(import.meta.dirname, '..', '..')
const exampleText = readFileSync(join(repoRoot, CONTRACTOR_PROCESS_EXAMPLE_FILE), 'utf8')
/** Invented values in the full shape of the real process data — every optional field used. */
const fullShapeText = readFileSync(
  join(repoRoot, 'tests/fixtures/contractor-process/full-shape.json'),
  'utf8',
)

type Json = Record<string, unknown> & {
  lanes: Record<string, unknown>[]
  stages: Record<string, unknown>[]
  steps: Record<string, unknown>[]
  edges: Record<string, unknown>[]
  subprocess: {
    lanes: Record<string, unknown>[]
    steps: Record<string, unknown>[]
    edges: Record<string, unknown>[]
  } & Record<string, unknown>
}

/** The full-shape fixture with one change applied — the errors of THAT change. */
function errorsAfter(change: (data: Json) => void): string[] {
  const data = JSON.parse(fullShapeText) as Json
  change(data)
  const result = parseContractorProcess(JSON.stringify(data))
  if (result.ok) throw new Error('expected the changed data to be rejected')
  return result.errors
}

function parsed(text: string): ContractorProcess {
  const result = parseContractorProcess(text)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.process
}

describe('parseContractorProcess — valid data', () => {
  it('accepts the public example committed in the repo', () => {
    const process = parsed(exampleText)
    expect(process.lanes.map((l) => l.id)).toEqual(['l1', 'l2', 'l3'])
    expect(process.stages).toHaveLength(3)
    expect(process.steps.find((s) => s.id === 'd1')?.kind).toBe('decision')
    expect(process.subprocess?.steps).toHaveLength(3)
  })

  it('accepts the full real shape: open lanes and steps, about, label + alt, subprocess', () => {
    const process = parsed(fullShapeText)
    expect(process.lanes[1]).toMatchObject({ open: true, about: expect.any(String) })
    expect(process.lanes[1].q).toHaveLength(2)
    expect(process.steps.find((s) => s.id === 'e3')?.open).toBe(true)
    expect(process.steps.find((s) => s.id === 'e2')?.auto).toBe('Карточка создаётся из формы')
    expect(process.edges.find((e) => e.alt)).toEqual({
      from: 'd1',
      to: 'e1',
      label: 'нет — вернуть автору',
      alt: true,
    })
    expect(process.subprocess?.title).toBe('Пополнение склада')
  })

  it('reads an absent `q` as no questions and an absent `auto` as no automation', () => {
    const data = JSON.parse(fullShapeText) as Json
    delete data.steps[0].q
    delete data.steps[0].auto
    const process = parsed(JSON.stringify(data))
    expect(process.steps[0].q).toEqual([])
    expect(process.steps[0].auto).toBe('')
    // The subprocess lanes in the fixture carry no `q` at all.
    expect(process.subprocess?.lanes[0].q).toEqual([])
  })

  it('a subprocess is optional', () => {
    const data = JSON.parse(fullShapeText) as Partial<Json>
    delete data.subprocess
    expect(parsed(JSON.stringify(data)).subprocess).toBeUndefined()
  })

  it('subprocess ids live in their own namespace: they may repeat main-diagram ids', () => {
    const data = JSON.parse(fullShapeText) as Json
    data.subprocess.lanes[0].id = 'l1'
    data.subprocess.steps[0].lane = 'l1'
    data.subprocess.steps[2].lane = 'l1'
    expect(parsed(JSON.stringify(data)).subprocess?.lanes[0].id).toBe('l1')
  })
})

describe('parseContractorProcess — the file itself', () => {
  it('invalid JSON is a Russian error, not a throw', () => {
    const result = parseContractorProcess('{ "lanes": [')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatch(/^JSON: файл не читается как JSON/)
  })

  it('an empty file says what it must hold', () => {
    const result = parseContractorProcess('   ')
    if (result.ok) throw new Error('an empty file must be rejected')
    expect(result.errors).toEqual([expect.stringMatching(/файл пуст/)])
  })
})

describe('parseContractorProcess — schema errors name the field', () => {
  it('a missing required field', () => {
    expect(
      errorsAfter((d) => {
        delete d.steps[2].title
      }),
    ).toEqual(['steps[2].title: обязательное поле не заполнено'])
  })

  it('a value of the wrong type', () => {
    expect(
      errorsAfter((d) => {
        d.steps[1].col = '1'
      }),
    ).toEqual(['steps[1].col: ожидается число, а в файле — текст'])
  })

  it('a column that is not a whole non-negative number', () => {
    expect(
      errorsAfter((d) => {
        d.steps[1].col = 1.5
      }),
    ).toEqual([expect.stringMatching(/^steps\[1\]\.col: .*целое число/)])
  })

  it('an unknown (misspelt) key', () => {
    expect(
      errorsAfter((d) => {
        d.lanes[0].abuot = 'опечатка'
      }),
    ).toEqual(['lanes[0]: неизвестное поле «abuot»'])
  })

  it('a step kind other than decision', () => {
    expect(
      errorsAfter((d) => {
        d.steps[0].kind = 'gateway'
      }),
    ).toEqual([expect.stringMatching(/^steps\[0\]\.kind: .*decision/)])
  })

  it('a blank title', () => {
    expect(
      errorsAfter((d) => {
        d.subprocess.lanes[1].title = '  '
      }),
    ).toEqual(['subprocess.lanes[1].title: пустое название'])
  })

  it('an id with spaces or Cyrillic', () => {
    expect(
      errorsAfter((d) => {
        d.lanes[4].id = 'касса 1'
      }),
    ).toEqual([expect.stringMatching(/^lanes\[4\]\.id: id — только латиница/)])
  })
})

describe('parseContractorProcess — referential integrity', () => {
  it('a repeated lane id', () => {
    expect(
      errorsAfter((d) => {
        d.lanes[3].id = 'l2'
      }),
    ).toEqual([
      'lanes[3].id: id «l2» уже занят (lanes[1])',
      'steps[3].lane: дорожки «l4» нет в lanes',
    ])
  })

  it('a repeated step id', () => {
    expect(
      errorsAfter((d) => {
        d.steps[4].id = 'e3'
        d.edges = d.edges.filter((e) => e.from !== 'e4' && e.to !== 'e4')
      }),
    ).toEqual(['steps[4].id: id «e3» уже занят (steps[3])'])
  })

  it('a repeated id inside the subprocess is checked there', () => {
    expect(
      errorsAfter((d) => {
        d.subprocess.steps[2].id = 'p1'
        d.subprocess.edges = [{ from: 'p1', to: 'p2' }]
      }),
    ).toEqual(['subprocess.steps[2].id: id «p1» уже занят (subprocess.steps[0])'])
  })

  it('a step on a lane that does not exist', () => {
    expect(
      errorsAfter((d) => {
        d.steps[2].lane = 'l9'
      }),
    ).toEqual(['steps[2].lane: дорожки «l9» нет в lanes'])
  })

  it('a subprocess step may not sit on a main-diagram lane', () => {
    expect(
      errorsAfter((d) => {
        d.subprocess.steps[1].lane = 'l5'
      }),
    ).toEqual(['subprocess.steps[1].lane: дорожки «l5» нет в subprocess.lanes'])
  })

  it('an edge from or to a step that does not exist', () => {
    expect(
      errorsAfter((d) => {
        d.edges[3].to = 'e99'
        d.edges[4].from = 'x'
      }),
    ).toEqual(['edges[3].to: шага «e99» нет в steps', 'edges[4].from: шага «x» нет в steps'])
  })

  it('an edge may not cross from the main diagram into the subprocess', () => {
    expect(
      errorsAfter((d) => {
        d.edges[7].to = 'p1'
        d.subprocess.edges[0].from = 'e1'
      }),
    ).toEqual([
      'edges[7].to: шага «p1» нет в steps',
      'subprocess.edges[0].from: шага «e1» нет в subprocess.steps',
    ])
  })

  it('an edge from a step to itself', () => {
    expect(
      errorsAfter((d) => {
        d.edges[1].to = 'd1'
      }),
    ).toEqual(['edges[1]: связь ведёт из шага «d1» в него же'])
  })

  it('two steps in the same cell (lane × column)', () => {
    expect(
      errorsAfter((d) => {
        d.steps[4].lane = 'l4'
      }),
    ).toEqual(['steps[4]: шаг «e4» стоит в той же клетке (l4, колонка 3), что и «e3» (steps[3])'])
  })

  it('a main-diagram step whose column is in no stage', () => {
    expect(
      errorsAfter((d) => {
        d.steps[6].col = 8
      }),
    ).toEqual(['steps[6].col: колонка 8 не входит ни в один этап (stages)'])
  })

  it('subprocess steps have no stages, so any column is fine there', () => {
    const data = JSON.parse(fullShapeText) as Json
    data.subprocess.steps[2].col = 40
    expect(parsed(JSON.stringify(data)).subprocess?.steps[2].col).toBe(40)
  })

  it('a stage whose span runs backwards', () => {
    expect(
      errorsAfter((d) => {
        d.stages[3].c0 = 8
      }),
    ).toEqual([
      'stages[3]: начало этапа c0 = 8 больше конца c1 = 7',
      'steps[6].col: колонка 7 не входит ни в один этап (stages)',
    ])
  })

  it('stages that overlap', () => {
    expect(
      errorsAfter((d) => {
        d.stages[1].c0 = 2
      }),
    ).toEqual(['stages[1]: колонки 2–4 пересекаются с этапом stages[0] (0–2)'])
  })

  it('reports every violation at once, not only the first', () => {
    const errors = errorsAfter((d) => {
      d.steps[0].lane = 'nope'
      d.edges[0].to = 'nope'
      d.subprocess.steps[0].lane = 'nope'
    })
    expect(errors).toHaveLength(3)
  })
})
