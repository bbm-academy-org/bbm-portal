import { describe, expect, it } from 'vitest'

import {
  classify,
  detectClaimState,
  evaluateRationale,
  findMegaBlockers,
  findEpicChecklistDrift,
  findMirrorDrift,
  formatAge,
  formatReport,
  isPlaceholder,
  mentionsIssue,
  missingFields,
  sourceLineText,
  parseDependenciesSection,
  parseProseBlockers,
  parseRefsWithRationale,
} from '../../tools/gh/backlog-triage.mjs'

/**
 * `pnpm backlog:triage` derives readiness from the NATIVE graph, not a label.
 * Parsing and classification are pure functions, so the suite needs no network.
 * Canon: `.claude/skills/task-canon/SKILL.md` §2, §3, §4.
 * Russian input fixtures remain intentionally: existing task bodies in that
 * language are still valid input even though the agent-facing CLI is English.
 */

describe('missingFields', () => {
  const clean = {
    issueType: { name: 'Task' },
    labels: [{ name: 'channel:owner' }],
    body: '**Source:** баг-репорт в Mattermost 2026-08-04',
    milestone: { title: 'Platform consolidation' },
    assignees: [{ login: 'sidorovanthon' }],
  }

  it('stays quiet on a fully populated issue', () => {
    expect(missingFields(clean)).toEqual([])
  })

  it('requires the native Type instead of a kind label', () => {
    expect(missingFields({ ...clean, issueType: null })).toContain('missing Type')
    expect(missingFields({ ...clean, issueType: { name: 'Epic' } })).toContainEqual(
      expect.stringMatching(/unknown Type/),
    )
  })

  it('catches retired kind:* labels', () => {
    const res = missingFields({
      ...clean,
      labels: [{ name: 'channel:owner' }, { name: 'kind:feat' }],
    })
    expect(res).toContainEqual(expect.stringMatching(/retired kind/))
  })

  it('catches default GitHub labels and points them to migration 7.2', () => {
    const res = missingFields({
      ...clean,
      labels: [{ name: 'channel:owner' }, { name: 'enhancement' }],
    })
    expect(res).toContainEqual(expect.stringMatching(/default GitHub labels.*7\.2/))
  })

  it('requires exactly one channel:* from the taxonomy', () => {
    expect(missingFields({ ...clean, labels: [] })).toContain('missing channel:*')
    expect(
      missingFields({ ...clean, labels: [{ name: 'channel:owner' }, { name: 'channel:agent' }] }),
    ).toContainEqual(expect.stringMatching(/multiple channel/))
    expect(missingFields({ ...clean, labels: [{ name: 'channel:луна' }] })).toContainEqual(
      expect.stringMatching(/unknown channel/),
    )
  })

  it('requires a non-empty **Source:** body line as a separate dimension', () => {
    expect(missingFields({ ...clean, body: '## Context' })).toContain(
      'missing non-empty **Source:** line',
    )
    expect(missingFields({ ...clean, body: '**Source:**' })).toContain(
      'missing non-empty **Source:** line',
    )
  })

  it('catches retired source:* labels', () => {
    expect(
      missingFields({ ...clean, labels: [{ name: 'channel:owner' }, { name: 'source:owner' }] }),
    ).toContainEqual(expect.stringMatching(/retired source/))
  })

  it('requires a milestone and assignee', () => {
    expect(missingFields({ ...clean, milestone: null })).toContain('missing milestone')
    expect(missingFields({ ...clean, assignees: [] })).toContain('missing assignee')
  })

  it('accepts labels as strings because gh has more than one response shape', () => {
    expect(missingFields({ ...clean, labels: ['channel:owner'] })).toEqual([])
  })
})

describe('sourceLineText', () => {
  /**
   * Provenance is free text, so only presence and non-emptiness are checked.
   * Bodies arrive in two forms: `pnpm issue:create` writes `**Source:** …`,
   * while GitHub issue forms render a `### Source` section.
   */
  it('reads the line written by the wrapper', () => {
    expect(sourceLineText('**Source:** баг-репорт в Mattermost\n\n## Context')).toBe(
      'баг-репорт в Mattermost',
    )
  })

  it('reads the section rendered by an issue form', () => {
    expect(sourceLineText('### Source\n\nexecutive-решение партнёров\n\n### Context\n\nx')).toBe(
      'executive-решение партнёров',
    )
  })

  it('reads the Source section even when it is last in the body', () => {
    expect(sourceLineText('### Context\n\nx\n\n### Source\n\nсам поймал при работе над #124')).toBe(
      'сам поймал при работе над #124',
    )
  })

  it('does not count an unfilled form field as provenance', () => {
    expect(sourceLineText('### Source\n\n_No response_\n\n### Context')).toBeNull()
    expect(sourceLineText('**Source:**')).toBeNull()
    expect(sourceLineText('## Context')).toBeNull()
  })

  /**
   * Regression: indentation used `\s`, which includes `\n`, so an empty
   * `**Source:**` line captured the next paragraph and read as populated.
   */
  it('does not let an empty Source line capture the next paragraph', () => {
    expect(sourceLineText('**Source:**\n\nобычный текст')).toBeNull()
    expect(sourceLineText('**Source:**   \n\n## Context')).toBeNull()
  })

  it("does not treat canon §1's unfilled angle-bracket placeholder as provenance", () => {
    expect(sourceLineText('**Source:** <на основании чего задача существует>')).toBeNull()
  })
})

describe('parseRefsWithRationale', () => {
  it('parses a reference with rationale after a dash', () => {
    expect(parseRefsWithRationale('#131 — схема задаётся там')).toEqual([
      { number: 131, rationale: 'схема задаётся там' },
    ])
  })

  it('parses multiple references, some without rationale', () => {
    expect(parseRefsWithRationale('#1 — почему, #2')).toEqual([
      { number: 1, rationale: 'почему' },
      { number: 2, rationale: null },
    ])
  })

  it('does not invent edges from placeholders', () => {
    for (const p of ['', 'нет', '—', 'none', '_No response_']) {
      expect(parseRefsWithRationale(p)).toEqual([])
    }
  })
})

describe('isPlaceholder', () => {
  it('treats an unfilled HTML template comment as a placeholder', () => {
    expect(isPlaceholder('<!-- сюда ссылки -->')).toBe(true)
  })

  it("treats canon §1's unfilled angle-bracket value as a placeholder", () => {
    expect(isPlaceholder('<на основании чего задача существует — свободный текст>')).toBe(true)
    expect(isPlaceholder('<конкретный deliverable>')).toBe(true)
  })

  it('does not treat meaningful text as a placeholder', () => {
    expect(isPlaceholder('#12 — причина')).toBe(false)
    expect(isPlaceholder('баг-репорт <Антона> в Mattermost')).toBe(false)
  })
})

describe('parseDependenciesSection', () => {
  const body = [
    '## Dependencies',
    '',
    '**Blocked by:** #131 — контракт БД задаётся там',
    '**Blocks:** #140, #141',
  ].join('\n')

  it('reads edges and rationale from the Dependencies section', () => {
    const deps = parseDependenciesSection(body)
    expect(deps.blockedBy).toEqual([{ number: 131, rationale: 'контракт БД задаётся там' }])
    expect(deps.blocks).toEqual([140, 141])
  })

  it('also reads the list-item form rendered by issue forms', () => {
    expect(parseDependenciesSection('- **Blocked by:** #7').blockedBy).toEqual([
      { number: 7, rationale: null },
    ])
  })

  it('does not invent edges from an empty section', () => {
    expect(parseDependenciesSection('**Blocked by:** нет\n**Blocks:**')).toEqual({
      blockedBy: [],
      blocks: [],
    })
  })
})

describe('parseProseBlockers', () => {
  it('sees a prose dependency outside the Dependencies section', () => {
    expect(parseProseBlockers('Эта задача зависит от #99, пока он не сделан.')).toEqual([99])
  })

  it('does NOT treat hierarchy as blocking: parent, epic, related, successor', () => {
    expect(parseProseBlockers('Часть эпика #117, зависит от него организационно')).toEqual([])
    expect(parseProseBlockers('Связано с #12, зависит от общего контекста')).toEqual([])
    expect(parseProseBlockers('Преемник #40 — зависит от его выводов')).toEqual([])
  })

  it('does not duplicate an existing Blocked by line', () => {
    expect(parseProseBlockers('**Blocked by:** #131 — причина')).toEqual([])
  })
})

describe('mentionsIssue', () => {
  it('recognises both `#N` and a link', () => {
    expect(mentionsIssue('см. #131', 131)).toBe(true)
    expect(mentionsIssue('https://github.com/o/r/issues/131', 131)).toBe(true)
  })

  it('does not count #1310 as a mention of #131', () => {
    expect(mentionsIssue('#1310', 131)).toBe(false)
  })
})

describe('evaluateRationale', () => {
  it("finds rationale on the blocked issue's edge line", () => {
    const body = '**Blocked by:** #131 — контракт БД задаётся там'
    expect(evaluateRationale(140, 131, body, null)).toBe('present')
  })

  it('treats a bare link as an edge without rationale (provenance-orphan)', () => {
    expect(evaluateRationale(140, 131, '**Blocked by:** #131', null)).toBe('absent')
  })

  it('counts an explanation on the blocker side', () => {
    expect(
      evaluateRationale(140, 131, 'нет упоминаний', 'этим блокируется #140, пока нет схемы'),
    ).toBe('present')
  })

  it('returns unknown honestly when neither body is available', () => {
    expect(evaluateRationale(140, 131, null, null)).toBe('unknown')
  })
})

describe('classify', () => {
  const issue = { number: 140, title: 'issue', labels: [] }

  it('makes an issue takeable when it has no edges', () => {
    expect(classify(issue, []).blocked).toBe(false)
  })

  it('lets an open blocker block', () => {
    const t = classify(issue, [{ number: 131, source: 'native', open: true, rationale: 'present' }])
    expect(t.blocked).toBe(true)
    expect(t.blockers).toHaveLength(1)
  })

  it('does not let a closed blocker block', () => {
    expect(
      classify(issue, [{ number: 131, source: 'native', open: false, rationale: 'present' }])
        .blocked,
    ).toBe(false)
  })

  it('makes a native edge beat prose for the same number because the graph is authoritative', () => {
    const t = classify(issue, [
      { number: 131, source: 'prose', open: true, rationale: 'absent' },
      { number: 131, source: 'native', open: true, rationale: 'present' },
    ])
    expect(t.edges).toHaveLength(1)
    expect(t.edges[0].source).toBe('native')
  })

  /**
   * Regression: readiness also counted prose, so an issue with a correctly
   * filled body but a missing graph edge disappeared from the takeable set and
   * step 6 of `spec-issue-graph` returned a false green. Canon §3: prose is not
   * a relation.
   */
  it('does not let a prose-only edge block because prose is not a relation', () => {
    const t = classify(issue, [{ number: 131, source: 'prose', open: true, rationale: 'present' }])
    expect(t.blocked).toBe(false)
    expect(t.blockers).toEqual([])
    expect(t.edges).toEqual([])
  })
})

describe('findMirrorDrift', () => {
  const body = ['## Dependencies', '', '**Blocked by:** #131 — контракт БД задаётся там'].join('\n')

  it('classifies a body line without a graph edge as mirror drift', () => {
    expect(findMirrorDrift(body, [])).toEqual([{ number: 131, source: 'mirror' }])
  })

  it('classifies a graph edge without a body line as graph-only drift', () => {
    expect(findMirrorDrift('empty body', [131])).toEqual([{ number: 131, source: 'graph-only' }])
  })

  it('reports no drift when body and graph agree', () => {
    expect(findMirrorDrift(body, [131])).toEqual([])
  })

  it('marks prose outside Dependencies as its own drift kind', () => {
    expect(findMirrorDrift('Эта задача зависит от #99.', [])).toEqual([
      { number: 99, source: 'prose' },
    ])
  })

  it('does not count the same mention twice', () => {
    expect(findMirrorDrift(`${body}\nтакже зависит от #131`, [])).toEqual([
      { number: 131, source: 'mirror' },
    ])
  })
})

describe('findMegaBlockers', () => {
  const blockedBy = (n: number, blocker: number) => ({
    number: n,
    title: `#${n}`,
    blocked: true,
    edges: [],
    blockers: [{ number: blocker, source: 'native', open: true, rationale: 'present' }],
  })

  it('finds a node that blocks at least five issues', () => {
    const triaged = [1, 2, 3, 4, 5].map((n) => blockedBy(n, 99))
    expect(findMegaBlockers(triaged)).toEqual([{ number: 99, blocked: [1, 2, 3, 4, 5], count: 5 }])
  })

  it('does not make four issues a mega-blocker yet', () => {
    expect(findMegaBlockers([1, 2, 3, 4].map((n) => blockedBy(n, 99)))).toEqual([])
  })

  it('sorts by descending reach', () => {
    const triaged = [
      ...[1, 2, 3, 4, 5].map((n) => blockedBy(n, 99)),
      ...[6, 7, 8, 9, 10, 11].map((n) => blockedBy(n, 88)),
    ]
    expect(findMegaBlockers(triaged).map((m) => m.number)).toEqual([88, 99])
  })
})

describe('detectClaimState — the two claim signals (canon §4)', () => {
  const base = { number: 130, hasWorktree: false, hasBranch: false, boardStatus: null, ageMs: 0 }

  it('makes worktree + In Progress a complete claim', () => {
    expect(detectClaimState({ ...base, hasWorktree: true, boardStatus: 'In Progress' }).kind).toBe(
      'in-flight',
    )
  })

  it('trusts the worktree when status is absent and points to the board repair', () => {
    const state = detectClaimState({ ...base, hasWorktree: true, boardStatus: 'Todo' })
    expect(state.kind).toBe('board-lags')
    expect(state.message).toMatch(/pnpm board:status 130 "In Progress"/)
  })

  it('makes status without a worktree or branch stale but leaves release to a human', () => {
    const state = detectClaimState({
      ...base,
      boardStatus: 'In Progress',
      ageMs: 3 * 24 * 3600 * 1000,
    })
    expect(state.kind).toBe('stale-claim')
    expect(state.message).toMatch(/3d/)
    expect(state.message).toMatch(/lead\/owner.*not the script/)
  })

  it('recognises work outside this machine from status plus an origin branch', () => {
    expect(detectClaimState({ ...base, boardStatus: 'In Progress', hasBranch: true }).kind).toBe(
      'branch-only',
    )
  })

  it('makes an issue free when neither signal exists', () => {
    expect(detectClaimState({ ...base, boardStatus: 'Todo' }).kind).toBe('free')
  })
})

describe('formatAge', () => {
  it('scales the unit with the magnitude', () => {
    expect(formatAge(30_000)).toBe('<1m')
    expect(formatAge(34 * 60_000)).toBe('34m')
    expect(formatAge(2 * 3600_000)).toBe('2h')
    expect(formatAge(3 * 24 * 3600_000)).toBe('3d')
  })

  it('does not pretend a non-numeric age is zero', () => {
    expect(formatAge(NaN)).toBe('?')
    expect(formatAge(null)).toBe('?')
  })
})

describe('claim drift without an update date', () => {
  it('reports «?» rather than «idle <1m» for a stale claim without a date', () => {
    const state = detectClaimState({
      number: 130,
      hasWorktree: false,
      hasBranch: false,
      boardStatus: 'In Progress',
      ageMs: null,
    })
    expect(state.kind).toBe('stale-claim')
    expect(state.message).toMatch(/idle \?/)
  })
})

describe('formatReport', () => {
  const model = {
    generatedAt: '2026-08-04T00:00:00.000Z',
    takeable: [{ number: 1, title: 'takeable' }],
    inFlight: [{ number: 2, title: 'in flight', claim: 'worktree + In Progress' }],
    blocked: [
      {
        number: 3,
        title: 'waiting',
        blockers: [{ number: 1, source: 'native', open: true, rationale: 'absent' }],
      },
    ],
    claimIssues: [{ number: 4, message: 'worktree exists, status missing' }],
    epics: [{ number: 5, title: 'umbrella' }],
    hygiene: [{ number: 6, missing: ['missing Type'] }],
    mirrorDrift: [{ number: 3, blocker: 1, source: 'mirror' }],
    orphanEdges: [{ blocked: 3, blocker: 1 }],
    megaBlockers: [{ number: 1, blocked: [3], count: 1 }],
    warnings: ['board read failed'],
  }

  it('prints every contract section with its count', () => {
    const report = formatReport(model)
    for (const heading of [
      '## Takeable (1)',
      '## In flight (1)',
      '## Claim drift (1)',
      '## Blocked (1)',
      '## Dependencies mirror drift (1)',
      '## Edges without rationale (1)',
      '## Mega-blockers (1)',
      '## Epics (1)',
      '## Field hygiene (1)',
      '## Warnings (1)',
    ]) {
      expect(report).toContain(heading)
    }
  })

  it('marks an edge without rationale as grounds to challenge rather than fact', () => {
    expect(formatReport(model)).toMatch(/⚠ rationale not recorded/)
    expect(formatReport(model)).toMatch(/grounds to challenge the edge/)
  })

  it('does not present an empty takeable list as an empty backlog', () => {
    const report = formatReport({ ...model, takeable: [] })
    expect(report).toMatch(/an empty takeable list ≠ an empty backlog/)
  })

  it('omits the Warnings section when there are no warnings', () => {
    expect(formatReport({ ...model, warnings: [] })).not.toContain('## Warnings')
  })
})

/**
 * Retro 2026-08-20 (#299), theme `epic-checklist-drift`. Epic #111 had every
 * native sub-issue closed while its body checklist still showed one tick — so a
 * finished epic sat in the open list reading as work, feeding the owner's «ничего
 * не закрывается». The graph is the fact; the checklist is a mirror that drifted.
 * WARN only: closing an epic is the lead's or the owner's call, never a script's.
 */
describe('findEpicChecklistDrift', () => {
  const done = [
    { number: 10, state: 'closed' },
    { number: 11, state: 'closed' },
  ]

  it('all sub-issues closed with an unchecked box is drift', () => {
    const res = findEpicChecklistDrift({
      number: 111,
      body: '- [x] #10 first\n- [ ] #11 second',
      subIssues: done,
    })
    expect(res).toMatchObject({ number: 111, unchecked: [11] })
  })

  it('an unchecked box with an OPEN sub-issue is ordinary work in progress', () => {
    expect(
      findEpicChecklistDrift({
        number: 111,
        body: '- [ ] #11 second',
        subIssues: [{ number: 11, state: 'open' }],
      }),
    ).toBeNull()
  })

  it('a fully ticked checklist over closed children is clean', () => {
    expect(
      findEpicChecklistDrift({ number: 111, body: '- [x] #10\n- [x] #11', subIssues: done }),
    ).toBeNull()
  })

  it('an epic with no sub-issue graph at all is not judged by its checkboxes', () => {
    expect(
      findEpicChecklistDrift({ number: 111, body: '- [ ] write the spec', subIssues: [] }),
    ).toBeNull()
  })

  it('an unchecked box naming no issue still counts once the graph is done', () => {
    const res = findEpicChecklistDrift({
      number: 111,
      body: '- [x] #10\n- [x] #11\n- [ ] final sweep',
      subIssues: done,
    })
    expect(res).toMatchObject({ number: 111, unchecked: [] })
    expect(res?.uncheckedCount).toBe(1)
  })
})

describe('formatReport — epic checklist drift', () => {
  it('prints the section and says the graph is the fact, not the checklist', () => {
    const report = formatReport({
      generatedAt: '2026-08-20T00:00:00.000Z',
      epicChecklistDrift: [{ number: 111, uncheckedCount: 1, unchecked: [11], closed: 2 }],
    })
    expect(report).toContain('## Epic checklist drift (1)')
    expect(report).toMatch(/#111/)
    expect(report).toMatch(/all 2 native sub-issues are closed/)
  })

  it('says «none» when body and graph agree', () => {
    expect(formatReport({ generatedAt: 'x' })).toContain('## Epic checklist drift (0)')
  })
})
