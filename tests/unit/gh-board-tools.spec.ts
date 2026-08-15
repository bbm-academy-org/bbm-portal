import { describe, expect, it, vi } from 'vitest'

import {
  checkRenovateMilestonePin,
  formatPlan,
  missingIssueTypes,
  planLabels,
  planMilestones,
  CHANNEL_LABEL_SPECS,
} from '../../tools/gh/bootstrap-taxonomy.mjs'
import {
  DEPENDENCIES_MILESTONE,
  FALLBACK_MILESTONE,
  PERMANENT_MILESTONES,
  KNOWN,
  buildBoardItemsPageQuery,
  buildDeleteItemMutation,
  buildIssueProjectItemsQuery,
  buildStatusMutation,
  knownIdWarnings,
  pickProjectItem,
  resolveStatusOption,
} from '../../tools/gh/lib/gh.mjs'
import { parseArgs, runBoardStatus } from '../../tools/gh/set-board-status.mjs'

/**
 * Board plumbing: query builders must not interpolate unchecked strings, while
 * `board:status` must tolerate an unquoted «In Progress» or half the claims will
 * never be set (canon §4).
 */

describe('parseArgs (board:status)', () => {
  it('parses the issue number and status', () => {
    expect(parseArgs(['130', 'Done'])).toMatchObject({ ok: true, issueNumber: 130, status: 'Done' })
  })

  it('joins an «In Progress» that lost its shell quotes', () => {
    expect(parseArgs(['130', 'In', 'Progress'])).toMatchObject({ ok: true, status: 'In Progress' })
  })

  it('supports read-only mode', () => {
    expect(parseArgs(['130', '--resolve'])).toMatchObject({ ok: true, resolveOnly: true })
  })

  it('fails on a bad number and on missing or unknown status', () => {
    expect(parseArgs(['abc', 'Done']).ok).toBe(false)
    expect(parseArgs(['130']).ok).toBe(false)
    expect(parseArgs(['130', 'Review']).ok).toBe(false)
  })
})

/**
 * Regression #132. Mutation succeeded, then the success log threw
 * `ReferenceError: item is not defined`, making completed work exit 1 and
 * `pr:land` read board-done as failed. That bug lived exactly where the old test
 * stopped, so this suite drives the successful path IN FULL, including final
 * message construction.
 */
describe('runBoardStatus — complete successful path', () => {
  const target = (over: Record<string, unknown> = {}) => ({
    ok: true,
    projectId: 'PVT_kwDOtest',
    itemId: 'PVTI_lADOtest',
    fieldId: 'PVTSSF_lADOtest',
    optionId: '98236657',
    project: { id: 'PVT_kwDOtest', number: 2, title: 'BBM Platform' },
    statusField: { id: 'PVTSSF_lADOtest', options: [{ id: '98236657', name: 'Done' }] },
    warnings: [],
    ...over,
  })

  // The command always leaves through exit(); in tests exit throws so execution
  // stops exactly where the real process would stop.
  const drive = (
    parsed: Record<string, unknown>,
    over: Record<string, unknown> = {},
  ): { out: string; err: string; code: number | null } => {
    const out: string[] = []
    const err: string[] = []
    let code: number | null = null
    try {
      runBoardStatus(parsed, {
        resolve: () => target(),
        mutate: () => ({ ok: true, data: {} }),
        ...over,
        out: (m: string) => out.push(m),
        err: (m: string) => err.push(m),
        exit: (c: number) => {
          code = c
          throw new Error('__exit__')
        },
      })
    } catch (e) {
      if ((e as Error).message !== '__exit__') throw e
    }
    return { out: out.join(''), err: err.join(''), code }
  }

  const done = { ok: true, issueNumber: 130, resolveOnly: false, status: 'Done' }

  it('prints DONE with issue, status and board item after mutation, then exits 0', () => {
    const res = drive(done)
    expect(res.code).toBe(0)
    expect(res.out).toContain('DONE')
    expect(res.out).toContain('#130')
    expect(res.out).toContain('Done')
    expect(res.out).toContain('PVTI_lADOtest')
    // The final line must not contain holes from nonexistent variables.
    expect(res.out).not.toMatch(/undefined/)
  })

  it('builds the mutation from LIVE-resolved ids', () => {
    const mutate = vi.fn((_query: string) => ({ ok: true, data: {} }))
    drive(done, { mutate })
    const query = String(mutate.mock.calls[0]?.[0] ?? '')
    expect(query).toContain('PVTI_lADOtest')
    expect(query).toContain('98236657')
  })

  it('exits 1 with no mutation when resolution fails', () => {
    const mutate = vi.fn()
    const res = drive(done, {
      resolve: () => ({ ok: false, error: 'issue #130 is not on the board' }),
      mutate,
    })
    expect(mutate).not.toHaveBeenCalled()
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/is not on the board/)
  })

  it('exits 1 and prints no DONE when mutation fails', () => {
    const res = drive(done, { mutate: () => ({ ok: false, error: 'GraphQL returned errors' }) })
    expect(res.code).toBe(1)
    expect(res.out).not.toContain('DONE')
  })

  it('reports id drift to stderr but completes the work', () => {
    const res = drive(done, { resolve: () => target({ warnings: ['project id drifted'] }) })
    expect(res.err).toMatch(/remark: project id drifted/)
    expect(res.code).toBe(0)
    expect(res.out).toContain('DONE')
  })

  it('--resolve prints the resolution, exits 0 and does NOT mutate', () => {
    const mutate = vi.fn()
    const res = drive({ ok: true, issueNumber: 130, resolveOnly: true, status: null }, { mutate })
    expect(mutate).not.toHaveBeenCalled()
    expect(res.code).toBe(0)
    expect(res.out).toMatch(/No mutation was made/)
    expect(res.out).toContain('PVTI_lADOtest')
    expect(res.out).not.toMatch(/undefined/)
  })
})

describe('query builders', () => {
  it('puts the issue number and Status field in the targeted query', () => {
    const q = buildIssueProjectItemsQuery(130)
    expect(q).toContain('issue(number:130)')
    expect(q).toContain('field(name:"Status")')
  })

  it('refuses to build a query for a non-positive number', () => {
    expect(() => buildIssueProjectItemsQuery(0)).toThrow()
    expect(() => buildIssueProjectItemsQuery(1.5)).toThrow()
  })

  it('rejects ids with quotes and brackets so they cannot break a mutation string', () => {
    expect(() => buildStatusMutation('a"', 'b', 'c', 'd')).toThrow()
    expect(() => buildDeleteItemMutation('a', '')).toThrow()
  })

  it('adds a board-pagination cursor only when one exists', () => {
    expect(buildBoardItemsPageQuery()).not.toContain('after:')
    expect(buildBoardItemsPageQuery('Y3Vyc29y')).toContain('after:"Y3Vyc29y"')
  })
})

describe('pickProjectItem', () => {
  const nodes = [
    { id: 'i1', project: { number: 9 } },
    { id: 'i2', project: { number: 2 } },
  ]

  it('selects the item from OUR board rather than the first one', () => {
    expect(pickProjectItem(nodes, '2')?.id).toBe('i2')
  })

  it('selects the first item without a number because a PR has one board', () => {
    expect(pickProjectItem(nodes)?.id).toBe('i1')
  })

  it('returns null on an empty list instead of throwing', () => {
    expect(pickProjectItem(undefined, '2')).toBeNull()
  })
})

describe('resolveStatusOption', () => {
  it('finds an option by exact name', () => {
    const options = [{ id: 'x', name: 'Todo' }]
    expect(resolveStatusOption(options, 'Todo')?.id).toBe('x')
    expect(resolveStatusOption(options, 'Done')).toBeNull()
  })
})

describe('knownIdWarnings', () => {
  it('stays quiet when live ids match the documented ids', () => {
    expect(
      knownIdWarnings({
        projectId: KNOWN.projectId,
        statusFieldId: KNOWN.statusFieldId,
        options: [{ name: 'Todo', id: KNOWN.options.Todo }],
      }),
    ).toEqual([])
  })

  it('makes drift a warning rather than a block because the resolved value wins', () => {
    const warnings = knownIdWarnings({ projectId: 'PVT_other', statusFieldId: null, options: [] })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(
      /\u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f \u0440\u0435\u0437\u043e\u043b\u0432\u043d\u0443\u0442\u044b\u0439/,
    )
  })
})

describe('bootstrap-taxonomy — plan', () => {
  it('creates missing channel labels', () => {
    const plan = planLabels([])
    expect(plan.create).toHaveLength(CHANNEL_LABEL_SPECS.length)
    expect(plan.update).toEqual([])
  })

  it('keeps matching labels unchanged', () => {
    expect(planLabels(CHANNEL_LABEL_SPECS).keep).toHaveLength(CHANNEL_LABEL_SPECS.length)
  })

  it('updates a label whose colour or description drifted', () => {
    const drifted = CHANNEL_LABEL_SPECS.map((s, i) => (i === 0 ? { ...s, color: 'ffffff' } : s))
    const plan = planLabels(drifted)
    expect(plan.update).toEqual([CHANNEL_LABEL_SPECS[0]])
  })

  it('never includes deletes because migration 7.2 owns legacy-label fate', () => {
    const labels = planLabels([{ name: 'enhancement', color: 'a2eeef', description: '' }])
    expect(Object.keys(labels)).toEqual(['create', 'update', 'keep'])
    const lines = formatPlan({
      labels,
      milestones: planMilestones(PERMANENT_MILESTONES),
      missingTypes: [],
    })
    expect(lines.join('\n')).not.toMatch(/delete/i)
  })

  it('creates the complete permanent milestone set when none exists', () => {
    const plan = planMilestones([])
    expect(plan.create.map((m) => m.title)).toEqual([FALLBACK_MILESTONE, DEPENDENCIES_MILESTONE])
    expect(plan.keep).toEqual([])
  })

  it('does not touch an existing milestone in any state, including closed', () => {
    const plan = planMilestones([
      { title: FALLBACK_MILESTONE, state: 'closed' },
      { title: DEPENDENCIES_MILESTONE, state: 'open' },
    ])
    expect(plan.create).toEqual([])
    expect(plan.keep.map((m) => m.title)).toEqual([FALLBACK_MILESTONE, DEPENDENCIES_MILESTONE])
  })

  it('creates only the missing member of the permanent set', () => {
    const plan = planMilestones([{ title: FALLBACK_MILESTONE, state: 'open' }])
    expect(plan.create.map((m) => m.title)).toEqual([DEPENDENCIES_MILESTONE])
    expect(plan.keep.map((m) => m.title)).toEqual([FALLBACK_MILESTONE])
    const lines = formatPlan({
      labels: { create: [], update: [], keep: [] },
      milestones: plan,
      missingTypes: [],
    })
    expect(lines.join('\n')).toMatch(new RegExp(`CREATE milestone «${DEPENDENCIES_MILESTONE}»`))
    expect(lines.join('\n')).toMatch(
      new RegExp(`already present: milestone «${FALLBACK_MILESTONE}»`),
    )
  })

  it('reports «no changes required» when the complete permanent set exists', () => {
    const lines = formatPlan({
      labels: planLabels(CHANNEL_LABEL_SPECS),
      milestones: planMilestones(PERMANENT_MILESTONES),
      missingTypes: [],
    })
    expect(lines).toContain('no changes required')
  })

  it('makes a renovate.json pin matching the live number OK', () => {
    const check = checkRenovateMilestonePin(
      [
        { title: FALLBACK_MILESTONE, number: 1 },
        { title: DEPENDENCIES_MILESTONE, number: 4 },
      ],
      { milestone: 4 },
    )
    expect(check.status).toBe('ok')
    expect(check.expected).toBe(4)
    const lines = formatPlan({
      labels: planLabels(CHANNEL_LABEL_SPECS),
      milestones: planMilestones(PERMANENT_MILESTONES),
      missingTypes: [],
      renovatePin: check,
    })
    expect(lines.join('\n')).not.toMatch(/⚠/)
    expect(lines).toContain('no changes required')
  })

  it('reports a pin pointing elsewhere as drift with the expected number', () => {
    const check = checkRenovateMilestonePin([{ title: DEPENDENCIES_MILESTONE, number: 7 }], {
      milestone: 4,
    })
    expect(check.status).toBe('drift')
    expect(check.pinned).toBe(4)
    expect(check.expected).toBe(7)
    const lines = formatPlan({
      labels: { create: [], update: [], keep: [] },
      milestones: planMilestones(PERMANENT_MILESTONES),
      missingTypes: [],
      renovatePin: check,
    })
    expect(lines.join('\n')).toMatch(/⚠.*renovate\.json.*4.*7/)
  })

  it('makes a missing milestone impossible to check rather than drift', () => {
    const check = checkRenovateMilestonePin([{ title: FALLBACK_MILESTONE, number: 1 }], {
      milestone: 4,
    })
    expect(check.status).toBe('unknown')
    expect(check.expected).toBeNull()
    const lines = formatPlan({
      labels: { create: [], update: [], keep: [] },
      milestones: planMilestones([{ title: FALLBACK_MILESTONE, state: 'open' }]),
      missingTypes: [],
      renovatePin: check,
    })
    expect(lines.join('\n')).toMatch(/cannot check/)
    expect(lines.join('\n')).not.toMatch(/drifted/)
  })

  it('makes renovate.json without a milestone key unpinned rather than drift', () => {
    const check = checkRenovateMilestonePin([{ title: DEPENDENCIES_MILESTONE, number: 4 }], {
      extends: ['config:recommended'],
    })
    expect(check.status).toBe('unpinned')
    expect(check.pinned).toBeNull()
    expect(check.expected).toBe(4)
    const lines = formatPlan({
      labels: { create: [], update: [], keep: [] },
      milestones: planMilestones(PERMANENT_MILESTONES),
      missingTypes: [],
      renovatePin: check,
    })
    expect(lines.join('\n')).toMatch(/⚠.*no pinned number/)
    expect(lines.join('\n')).not.toMatch(/drifted/)
  })

  it('reports a missing org Issue Type instead of repairing it here', () => {
    expect(missingIssueTypes([{ name: 'Task' }])).toEqual(['Bug', 'Feature'])
    const lines = formatPlan({
      labels: { create: [], update: [], keep: [] },
      milestones: planMilestones(PERMANENT_MILESTONES),
      missingTypes: ['Bug'],
    })
    expect(lines.join('\n')).toMatch(/organization settings/)
  })
})
