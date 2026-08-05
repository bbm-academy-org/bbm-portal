import { describe, expect, it } from 'vitest'

import {
  buildPayload,
  envFooter,
  extractNote,
  noteIsReal,
  stripServiceMarkers,
} from '../../tools/ci/post-product-note.mjs'
import {
  buildDigest,
  buildTechnicalReleaseLine,
  extractPrNumbers,
} from '../../tools/deploy/release-notes.mjs'
import {
  buildReleaseNotesArgs,
  resolvePrevSha,
  shouldPost,
} from '../../tools/ci/post-release-digest.mjs'

/**
 * Release notes to Mattermost (task 7.6, #137) — two channels off ONE source of
 * truth, the PR body's «Product note (RU)» section:
 *
 *   • per-PR, on merge → the change is on main (i.e. it will ship next deploy);
 *   • aggregated, on a successful production Deployment → what actually shipped.
 *
 * Both render from the same extraction seams, so a note can never read one way
 * in the per-PR post and another way in the digest.
 *
 * Adaptation from the ds-platform original: ds gates delivery on a product-kind
 * PR LABEL (feature|bug). bbm-portal PRs carry no labels at all and the repo has
 * no such taxonomy (its labels are `channel:*` + `epic`/`consolidation`, and the
 * Type lives on the ISSUE), so porting the gate would have meant inventing a
 * label taxonomy nobody maintains — a second source of truth that silently
 * drifts. Here the NOTE is the gate: write a note and it is delivered, write
 * `none` and nothing is.
 */

// ── extraction ───────────────────────────────────────────────────────────────

describe('extractNote', () => {
  it('takes the section under the «Product note (RU)» heading', () => {
    const body = [
      '## What',
      'internal',
      '',
      '## Product note (RU)',
      'Часы теперь считают.',
      '',
      '## Why',
      'Closes #1',
    ].join('\n')
    expect(extractNote(body)).toBe('Часы теперь считают.')
  })

  it('stops at a horizontal rule, not just at the next heading', () => {
    const body = '## Product note (RU)\nВидимое изменение.\n\n---\n\nEnglish summary for reviewers.'
    expect(extractNote(body)).toBe('Видимое изменение.')
  })

  it('drops HTML comments — the template’s own instructions are not the note', () => {
    const body = '## Product note (RU)\n<!-- 2-4 sentences, plain product Russian -->\nnone'
    expect(extractNote(body)).toBe('none')
  })

  it('accepts an inline `product-note:` marker as a fallback', () => {
    expect(extractNote('product-note: Кнопка теперь видна редактору.')).toBe(
      'Кнопка теперь видна редактору.',
    )
  })

  it('is empty when there is no note at all', () => {
    expect(extractNote('## What\nchore\n\n## Why\nCloses #1')).toBe('')
    expect(extractNote('')).toBe('')
  })
})

describe('stripServiceMarkers', () => {
  it('removes the process tail a last-section note would otherwise swallow', () => {
    const note = [
      'Реальный текст заметки.',
      '',
      'Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>',
      'Claude-Session: https://claude.ai/code/session_x',
      '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    ].join('\n')
    expect(stripServiceMarkers(note)).toBe('Реальный текст заметки.\n')
  })

  it('leaves prose that merely mentions Claude alone — whole LINES only', () => {
    expect(stripServiceMarkers('Заметка про то, как Claude помогает редактору.')).toBe(
      'Заметка про то, как Claude помогает редактору.',
    )
  })
})

describe('noteIsReal', () => {
  it('is false for `none`, blanks and placeholders', () => {
    for (const v of ['none', 'None.', '', '   ', 'n/a', 'TBD', 'todo', '---', '<...>']) {
      expect(noteIsReal(v), JSON.stringify(v)).toBe(false)
    }
  })

  it('is false for a note too short to be a sentence', () => {
    expect(noteIsReal('ок')).toBe(false)
  })

  it('is true for an actual product sentence', () => {
    expect(noteIsReal('Редактор видит черновик до публикации.')).toBe(true)
  })
})

describe('envFooter', () => {
  it('marks the two environments distinctly, case-insensitively', () => {
    // ds says "DEV" because a merge reaches their dev stand. bbm-portal has no
    // such stand: a merge only means the change is ON MAIN and will ship with
    // the next manual deploy. Saying that plainly is the whole point of the
    // marker — a reader must never mistake "merged" for "live".
    expect(envFooter('dev')).toMatch(/main/)
    expect(envFooter('dev')).toMatch(/следующим релизом/)
    expect(envFooter(' PROD ')).toMatch(/PROD/)
    expect(envFooter('dev')).not.toBe(envFooter('prod'))
  })

  it('is null for unset/unknown — an unmarked post must be impossible', () => {
    expect(envFooter(undefined)).toBeNull()
    expect(envFooter('staging')).toBeNull()
  })
})

describe('buildPayload', () => {
  it('is note, linked PR title, then the environment footer as the last line', () => {
    const { text } = buildPayload('Заметка.', 'feat: hours', 'https://gh/pr/1', 'ФУТЕР')
    expect(text).toBe('Заметка.\n\n[feat: hours](https://gh/pr/1)\n\nФУТЕР')
  })
})

// ── digest ───────────────────────────────────────────────────────────────────

describe('extractPrNumbers', () => {
  it('takes the LAST (#N) of a squash-merge subject — that is the merged PR', () => {
    expect(extractPrNumbers(['fix(gh): board:status ReferenceError (#132) (#141)'])).toEqual([141])
  })

  it('dedupes, preserves first-appearance order, skips subjects with no PR ref', () => {
    expect(extractPrNumbers(['a (#2)', 'b', 'c (#1)', 'd (#2)'])).toEqual([2, 1])
  })

  it('is empty for garbage input', () => {
    expect(extractPrNumbers(null as never)).toEqual([])
  })
})

describe('buildDigest / buildTechnicalReleaseLine', () => {
  const newSha = 'a'.repeat(40)

  it('lists every note with its PR link, footer last', () => {
    const { text } = buildDigest({
      notes: [
        { note: 'Часы считают.', title: 'feat: hours', url: 'https://gh/pr/1' },
        { note: 'Лиды видны.', title: 'feat: leads', url: 'https://gh/pr/2' },
      ],
      newSha,
      footer: 'ФУТЕР',
    })
    expect(text).toContain('aaaaaaaaaaaa')
    expect(text).toContain('[feat: hours](https://gh/pr/1)')
    expect(text).toContain('[feat: leads](https://gh/pr/2)')
    expect(text.trim().endsWith('ФУТЕР')).toBe(true)
  })

  it('says so plainly when a release carried no user-visible change', () => {
    const { text } = buildTechnicalReleaseLine({ newSha, footer: 'ФУТЕР' })
    expect(text).toMatch(/[Тт]ехнический релиз/)
    expect(text.trim().endsWith('ФУТЕР')).toBe(true)
  })
})

// ── the CI resolver ──────────────────────────────────────────────────────────

describe('shouldPost', () => {
  it('posts only for a successful PRODUCTION deployment', () => {
    expect(shouldPost({ state: 'success', environment: 'production' })).toBe(true)
    expect(shouldPost({ state: 'failure', environment: 'production' })).toBe(false)
    expect(shouldPost({ state: 'success', environment: 'preview' })).toBe(false)
    expect(shouldPost({})).toBe(false)
  })
})

describe('resolvePrevSha', () => {
  const newSha = 'n'.repeat(40)

  it('anchors on the newest release tag that is a STRICT ancestor', () => {
    expect(
      resolvePrevSha(
        [
          { tag: 'release-2026.08.01-1', sha: 'aaa' },
          { tag: 'release-2026.08.04-2', sha: 'bbb' },
          { tag: 'release-2026.08.04-10', sha: 'ccc' },
        ],
        newSha,
        'root',
      ),
    ).toBe('ccc')
  })

  it('excludes a tag AT the new sha — re-running still ranges from the PRIOR release', () => {
    expect(
      resolvePrevSha(
        [
          { tag: 'release-2026.08.05-1', sha: newSha },
          { tag: 'release-2026.08.04-1', sha: 'bbb' },
        ],
        newSha,
        'root',
      ),
    ).toBe('bbb')
  })

  it('falls back to the repo-root commit when NO release tag exists yet', () => {
    // bbm-portal's state today: the inaugural deploy has no previous release to
    // range from. ds's #975 bug was anchoring on the previous DEPLOYMENT here,
    // which made the first digest tooling-only. The full-history range matches
    // what `gh release create --generate-notes` puts in the inaugural Release.
    expect(resolvePrevSha([], newSha, 'root')).toBe('root')
    expect(resolvePrevSha([{ tag: 'v1.0.0', sha: 'xxx' }], newSha, 'root')).toBe('root')
  })

  it('is null when even the root is unavailable — the caller then green-skips', () => {
    expect(resolvePrevSha([], newSha, null)).toBeNull()
  })
})

describe('buildReleaseNotesArgs', () => {
  it('passes the resolved range through', () => {
    expect(buildReleaseNotesArgs('prev', 'new')).toEqual(['--prev-sha', 'prev', '--new-sha', 'new'])
  })

  it('turns a null baseline into the literal `none` (a green skip downstream)', () => {
    expect(buildReleaseNotesArgs(null, 'new')).toEqual(['--prev-sha', 'none', '--new-sha', 'new'])
  })
})

describe('the PR template section is the SSOT — one shape, two readers (#136 / #137)', () => {
  // Task 7.5 (#136, PR #154) added the `## Product note (RU)` section and the
  // `product-note` CI guard that makes it non-optional on a render-surface PR.
  // 7.6 does NOT add a second section: it consumes THAT one. This test pins the
  // template's literal shape, so if 7.5's template moves, the delivery breaks
  // here rather than silently posting nothing.
  const TEMPLATE_TAIL = [
    '## Why',
    '',
    'Closes #',
    '',
    '## Product note (RU)',
    '',
    '<!-- Две фразы продуктовым языком: что читатель теперь увидит. Для PR, который',
    '     никто не видит (тулинг, доки, бэкенд без UI), допустимо `none`.',
    '     Проверяется гардом product-note — docs/ci-guardrails.md §5. -->',
    '',
    'PLACEHOLDER',
    '',
    '## Task-cycle checklist',
    '',
    '- [ ] Owner\'s "go" was given in-session on this scope (stage 2)',
  ].join('\n')

  it('an untouched template delivers nothing (the `none` default)', () => {
    const body = TEMPLATE_TAIL.replace('PLACEHOLDER', 'none')
    expect(noteIsReal(extractNote(body))).toBe(false)
  })

  it('a filled-in note is extracted without the authoring hint or the checklist', () => {
    const note = 'Редактор теперь видит черновик страницы до публикации.'
    const body = TEMPLATE_TAIL.replace('PLACEHOLDER', note)
    expect(extractNote(body)).toBe(note)
    expect(noteIsReal(extractNote(body))).toBe(true)
  })

  it('the delivery threshold is looser than the guard’s on purpose', () => {
    // The guard blocks a note under 40 characters — that is an AUTHORING
    // standard, judged when the note is written. Delivery must not silently
    // drop a short note that a human deliberately merged (the guard is WARN);
    // refusing to POST what a reviewer accepted would hide it from the channel
    // with no signal anywhere.
    const short = 'Кнопка стала видна.'
    expect(short.length).toBeLessThan(40)
    expect(noteIsReal(short)).toBe(true)
  })
})
