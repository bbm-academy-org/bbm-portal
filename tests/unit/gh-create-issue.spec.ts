import { describe, expect, it } from 'vitest'

import {
  collectLabels,
  enrichCreateError,
  ensureAssigneeFlag,
  extractIssueUrl,
  flagValues,
  hasAssignee,
  hasRepoOverride,
  issueNumberFromUrl,
  kindLabelError,
  milestoneError,
  bodyError,
  partitionArgs,
  readBodyText,
  skeletonWarnings,
  channelError,
  composeBody,
  dedupeLabelFlags,
  normalizeChannel,
  resolveChannel,
  sourceLineError,
  sourceTextError,
  stripConsumedFlags,
  typeError,
  validationError,
} from '../../tools/gh/create-issue.mjs'
import { branchTypeFromIssueType, parseNodeReadback } from '../../tools/gh/lib/gh.mjs'

/**
 * `pnpm issue:create` is the only issue-creation path, and its validation fails
 * closed: a taxonomy violation must cancel creation BEFORE the first gh call.
 * Every gate is a pure function, so the suite needs no network.
 * Canon: `.claude/skills/task-canon/SKILL.md` §2 + §7.
 */

const OK_ARGS = [
  '--title',
  'something',
  '--body',
  'body',
  '--type',
  'Task',
  '--channel',
  'agent',
  '--source',
  'found while working on #130',
  '--milestone',
  'Platform consolidation',
]

describe('partitionArgs', () => {
  it('consumes its control flags and passes everything else to gh verbatim', () => {
    const { setTodo, passthrough } = partitionArgs(['--no-todo', '--title', 'x'])
    expect(setTodo).toBe(false)
    expect(passthrough).toEqual(['--title', 'x'])
  })

  it('sets Status=Todo by default', () => {
    expect(partitionArgs(['--title', 'x']).setTodo).toBe(true)
  })
})

describe('flagValues', () => {
  it('reads every flag form accepted by gh', () => {
    expect(flagValues(['--milestone', 'A'], 'milestone', 'm')).toEqual(['A'])
    expect(flagValues(['--milestone=A'], 'milestone', 'm')).toEqual(['A'])
    expect(flagValues(['-m', 'A'], 'milestone', 'm')).toEqual(['A'])
    expect(flagValues(['-mA'], 'milestone', 'm')).toEqual(['A'])
  })

  it('does not confuse a short flag with a long one or consume unrelated flags', () => {
    expect(flagValues(['--milestone-ish', 'A'], 'milestone', 'm')).toEqual([])
    expect(flagValues(['--type', 'Task'], 'milestone', 'm')).toEqual([])
  })
})

describe('collectLabels', () => {
  it('collects labels from repetitions, `=` forms and comma-separated lists', () => {
    expect(collectLabels(['--label', 'a', '-l', 'b,c', '--label=d'])).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('normalizeChannel', () => {
  it('accepts both short and full forms', () => {
    expect(normalizeChannel('owner')).toBe('channel:owner')
    expect(normalizeChannel('channel:owner')).toBe('channel:owner')
    expect(normalizeChannel('  spec ')).toBe('channel:spec')
  })

  it('does not treat an empty value as a channel', () => {
    expect(normalizeChannel('')).toBe('')
    expect(normalizeChannel(null)).toBe('')
  })
})

describe('channelError', () => {
  it('accepts exactly one channel in flag and label form', () => {
    expect(channelError(['--channel', 'owner'])).toBeNull()
    expect(channelError(['--label', 'channel:spec'])).toBeNull()
  })

  it('fails without a channel and explains that this is NOT provenance', () => {
    const err = channelError(['--label', 'epic'])
    expect(err).toMatch(/exactly one backlog-entry channel/)
    expect(err).toMatch(/NOT provenance/)
  })

  it('fails on two different channels', () => {
    expect(channelError(['--channel', 'owner', '--label', 'channel:agent'])).toMatch(
      /exactly ONE channel/,
    )
  })

  it('does not treat the same value in both forms as a conflict', () => {
    expect(channelError(['--channel', 'owner', '--label', 'channel:owner'])).toBeNull()
  })

  it('fails on a channel outside the taxonomy', () => {
    expect(channelError(['--channel', 'outsider'])).toMatch(/unknown channel/)
  })
})

describe('resolveChannel', () => {
  it('returns the canonical channel label', () => {
    expect(resolveChannel(['--channel', 'retro'])).toBe('channel:retro')
    expect(resolveChannel(['--label', 'channel:spec'])).toBe('channel:spec')
    expect(resolveChannel([])).toBeNull()
  })
})

describe('sourceTextError', () => {
  /**
   * Provenance is required FREE text (owner ruling, 2026-08-04): «99% of issues
   * will be owner requests, which conveys nothing» — an enum would collapse,
   * while the context of what warrants the issue is the first thing lost.
   */
  it('accepts non-empty free text', () => {
    expect(sourceTextError(['--source', "Anton's bug report in Mattermost, 2026-08-04"])).toBeNull()
  })

  it('fails without --source and gives wording examples', () => {
    const err = sourceTextError([])
    expect(err).toMatch(/needs provenance/)
    expect(err).toMatch(/executive decision/)
  })

  it('keeps a whitespace-only --source empty', () => {
    expect(sourceTextError(['--source', '   '])).toMatch(/needs provenance/)
  })

  it('treats two --source values as a conflict instead of joining them', () => {
    expect(sourceTextError(['--source', 'A', '--source', 'B'])).toMatch(/exactly ONE --source/)
  })
})

describe('sourceLineError', () => {
  it('forbids a manual **Source:** body line because the wrapper adds it', () => {
    expect(sourceLineError('**Source:** something\n\n## Context')).toMatch(
      /do not write it manually/,
    )
  })

  it('accepts a body without that line', () => {
    expect(sourceLineError('## Context\n\ntext')).toBeNull()
  })
})

describe('composeBody', () => {
  it('puts the Source line first and the body after it', () => {
    expect(composeBody('bug report in MM', '## Context\n\ntext')).toBe(
      '**Source:** bug report in MM\n\n## Context\n\ntext\n',
    )
  })
})

describe('stripConsumedFlags', () => {
  it('removes body and wrapper flags while preserving unrelated ones', () => {
    expect(
      stripConsumedFlags([
        '--title',
        'x',
        '--body-file',
        'f.md',
        '--channel',
        'agent',
        '--source',
        'text',
        '--label',
        'epic',
      ]),
    ).toEqual(['--title', 'x', '--label', 'epic'])
  })

  it('removes both the `=` form and the short form', () => {
    expect(
      stripConsumedFlags(['--body=text', '-b', 'x', '--source=y', '--milestone', 'M']),
    ).toEqual(['--milestone', 'M'])
  })
})

describe('kindLabelError', () => {
  /**
   * There are no kind:* labels here: issue class uses the native Type field
   * (owner ruling, 2026-08-04). A ds-platform habit must fail loudly, or a
   * second, divergent classification will emerge.
   */
  it('stays quiet when no retired label is present', () => {
    expect(kindLabelError(['--label', 'channel:agent'])).toBeNull()
  })

  it('fails on any kind:* label and points to --type', () => {
    expect(kindLabelError(['--label', 'kind:feat'])).toMatch(/retired.*--type/s)
  })

  it('fails on an old source:* label and separates the two dimensions', () => {
    const err = kindLabelError(['--label', 'source:owner'])
    expect(err).toMatch(/source:\* labels were retired/)
    expect(err).toMatch(/--source/)
    expect(err).toMatch(/--channel/)
  })
})

describe('typeError', () => {
  it('accepts exactly one native type', () => {
    for (const t of ['Bug', 'Feature', 'Task']) expect(typeError(['--type', t])).toBeNull()
  })

  it('fails without a type', () => {
    expect(typeError([])).toMatch(/exactly one native type/)
  })

  it('fails on an unknown type and on two types', () => {
    expect(typeError(['--type', 'Chore'])).toMatch(/unknown type/)
    expect(typeError(['--type', 'Bug', '--type', 'Task'])).toMatch(/exactly ONE --type/)
  })
})

describe('milestoneError', () => {
  it('requires a non-empty value, not merely the flag itself', () => {
    expect(milestoneError(['--milestone', 'Theme'])).toBeNull()
    expect(milestoneError(['--milestone', '   '])).toMatch(/needs a milestone/)
    expect(milestoneError([])).toMatch(/needs a milestone/)
  })

  it('names the permanent fallback in the error', () => {
    expect(milestoneError([])).toMatch(/Platform: operations and hardening/)
  })
})

describe('bodyError', () => {
  it('accepts a non-empty body in either form', () => {
    expect(bodyError(['--body', 'text'])).toBeNull()
    expect(bodyError(['--body-file', 'x.md'], () => 'text')).toBeNull()
  })

  it('fails on a missing, empty or whitespace-only body', () => {
    expect(bodyError([])).toMatch(/needs a body/)
    expect(bodyError(['--body', '   '])).toMatch(/body is empty/)
    expect(bodyError(['--body-file', 'x.md'], () => '\n\n')).toMatch(/is empty/)
  })

  it('fails when the body file is unreadable instead of creating silently', () => {
    expect(
      bodyError(['--body-file', 'missing.md'], () => {
        throw new Error('ENOENT')
      }),
    ).toMatch(/could not read body file/)
  })
})

describe('hasRepoOverride', () => {
  it('catches every --repo and -R form because the board is repo-bound', () => {
    expect(hasRepoOverride(['--repo', 'o/r'])).toBe(true)
    expect(hasRepoOverride(['--repo=o/r'])).toBe(true)
    expect(hasRepoOverride(['-R', 'o/r'])).toBe(true)
    expect(hasRepoOverride(['-Ro/r'])).toBe(true)
    expect(hasRepoOverride(OK_ARGS)).toBe(false)
  })
})

describe('validationError — gate order', () => {
  it('accepts the complete valid set', () => {
    expect(validationError(OK_ARGS)).toBeNull()
  })

  it('makes the repo override take precedence over every other check', () => {
    expect(validationError(['--repo', 'foreign/repo'])).toMatch(/--repo\/-R is forbidden/)
  })

  it('reports exactly one error at a time, starting with the channel', () => {
    const err = validationError(['--title', 'x'])
    expect(err).toMatch(/exactly one backlog-entry channel/)
    expect(err).not.toMatch(/milestone/)
  })

  it('reports missing provenance second when the channel exists', () => {
    expect(validationError(['--channel', 'owner'])).toMatch(/needs provenance/)
  })

  it('returns a non-empty error for every individual violation', () => {
    const drop = (flag: string) => {
      const i = OK_ARGS.indexOf(flag)
      return [...OK_ARGS.slice(0, i), ...OK_ARGS.slice(i + 2)]
    }
    expect(validationError(drop('--channel'))).toBeTruthy()
    expect(validationError(drop('--source'))).toBeTruthy()
    expect(validationError(drop('--type'))).toBeTruthy()
    expect(validationError(drop('--milestone'))).toBeTruthy()
    expect(validationError(drop('--body'))).toBeTruthy()
  })
})

describe('dedupeLabelFlags', () => {
  /**
   * The channel arrives as both a `--channel` flag and a label. Without
   * collapsing duplicates, the same `channel:*` reached gh twice.
   */
  it('collapses a repeated label while preserving first-occurrence order', () => {
    expect(dedupeLabelFlags(['--label', 'channel:owner', '--label', 'channel:owner'])).toEqual([
      '--label',
      'channel:owner',
    ])
    expect(
      dedupeLabelFlags(['--label', 'epic', '--label', 'channel:spec', '--label', 'epic']),
    ).toEqual(['--label', 'epic', '--label', 'channel:spec'])
  })

  it('expands comma-separated lists and the short form', () => {
    expect(dedupeLabelFlags(['-l', 'a,b', '--label=b'])).toEqual(['--label', 'a', '--label', 'b'])
  })

  it('leaves unrelated flags untouched', () => {
    expect(dedupeLabelFlags(['--title', 'x', '--label', 'a', '--milestone', 'M'])).toEqual([
      '--title',
      'x',
      '--label',
      'a',
      '--milestone',
      'M',
    ])
  })
})

describe('assignee', () => {
  it('adds @me when no assignee is explicit', () => {
    expect(ensureAssigneeFlag(['--title', 'x'])).toEqual(['--title', 'x', '--assignee', '@me'])
  })

  it('never overwrites an explicit assignee', () => {
    const args = ['--assignee', 'sidorovanthon']
    expect(hasAssignee(args)).toBe(true)
    expect(ensureAssigneeFlag(args)).toEqual(args)
  })
})

describe('skeletonWarnings', () => {
  const full = [
    '**Source:** found while working on #130',
    '## Context',
    'why',
    '## Scope',
    '## Spec reference',
    '## Acceptance criteria',
  ].join('\n')

  it('stays quiet on the full canon §1 skeleton', () => {
    expect(skeletonWarnings(full)).toEqual([])
  })

  it('accepts `###` headings because GitHub issue forms render fields that way', () => {
    expect(skeletonWarnings(full.replace(/^## /gm, '### '))).toEqual([])
  })

  it('names every missing section', () => {
    const warnings = skeletonWarnings('plain text')
    expect(warnings).toContain('missing **Source:** line (canon §1)')
    expect(warnings).toContain('missing «Acceptance criteria» section (canon §1)')
  })

  it('does not require acceptance criteria on an epic because closed children are its criterion', () => {
    const body = full.replace('## Acceptance criteria', '')
    expect(skeletonWarnings(body, ['epic'])).toEqual([])
    expect(skeletonWarnings(body, [])).toContain('missing «Acceptance criteria» section (canon §1)')
  })
})

describe('readBodyText', () => {
  it('joins an inline body with file contents', () => {
    expect(readBodyText(['--body', 'A', '--body-file', 'f.md'], () => 'B')).toBe('A\nB')
  })
})

describe('gh response parsing', () => {
  it('extracts the created issue URL and number', () => {
    const stdout = 'https://github.com/bbm-academy-org/bbm-portal/issues/131\n'
    expect(extractIssueUrl(stdout)).toBe('https://github.com/bbm-academy-org/bbm-portal/issues/131')
    expect(issueNumberFromUrl(extractIssueUrl(stdout)!)).toBe(131)
  })

  it('returns null when the output contains no URL', () => {
    expect(extractIssueUrl('creating issue…')).toBeNull()
  })
})

describe('enrichCreateError', () => {
  /**
   * The wrapper is the only issue-creation path, while `source:*` labels do not
   * exist before `taxonomy:bootstrap --apply`; without a hint the first attempt
   * stops at an opaque «could not add label».
   */
  it('points a label error to taxonomy:bootstrap', () => {
    const msg = enrichCreateError("could not add label: 'channel:agent' not found", [
      'channel:agent',
    ])
    expect(msg).toMatch(/taxonomy:bootstrap --apply/)
  })

  it('does not attach unrelated advice to other errors', () => {
    expect(enrichCreateError('HTTP 502', ['channel:agent'])).toBe('HTTP 502')
    expect(enrichCreateError('could not add label: epic', [])).toBe('could not add label: epic')
  })
})

describe('parseNodeReadback', () => {
  const node = (number: number, status: string | null) => ({
    node: {
      content: { number },
      fieldValueByName: status === null ? null : { name: status },
    },
  })

  it('confirms a board item with the expected Todo', () => {
    expect(parseNodeReadback(node(131, 'Todo'), 131, { expectTodo: true })).toEqual({
      ok: true,
      status: 'Todo',
      number: 131,
    })
  })

  it('catches a different issue under the same item id', () => {
    expect(parseNodeReadback(node(999, 'Todo'), 131).ok).toBe(false)
  })

  it('catches an unset Status when one was expected', () => {
    const res = parseNodeReadback(node(131, null), 131, { expectTodo: true })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/\u043d\u0435 \u0437\u0430\u0434\u0430\u043d/)
  })

  it('treats an empty node as a missing board item rather than success', () => {
    expect(parseNodeReadback({}, 131).ok).toBe(false)
  })
})

describe('branchTypeFromIssueType', () => {
  /** Canon §2 chain: Type → branch prefix → Conventional Commit type. */
  it('maps the native Type to a branch prefix', () => {
    expect(branchTypeFromIssueType('Bug')).toBe('fix')
    expect(branchTypeFromIssueType('Feature')).toBe('feat')
    expect(branchTypeFromIssueType('Task')).toBe('chore')
  })

  it('falls back to safe chore for an unknown or missing Type', () => {
    expect(branchTypeFromIssueType('Epic')).toBe('chore')
    expect(branchTypeFromIssueType(null)).toBe('chore')
  })
})
