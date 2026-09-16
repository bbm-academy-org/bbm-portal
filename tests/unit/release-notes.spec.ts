import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  composeDigest,
  extractPrNumbers,
  pluralizeTechnicalChanges,
} from '../../tools/deploy/release-notes.mjs'
import {
  buildReleaseNotesArgs,
  resolvePrevSha,
  shouldPost,
} from '../../tools/ci/post-release-digest.mjs'
import {
  extractNote as guardExtractNote,
  verdict as guardVerdict,
} from '../../tools/lint/product-note-lint.mjs'

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

/**
 * `composeDigest` shells out twice — `git log` for the range's subjects and
 * `gh pr view` per PR number. Both go through ONE `spawnSync`, so stubbing that
 * import is enough to drive every arm of the count seam with no network, no gh
 * and no repo state.
 *
 * The factory does NOT delegate to the real module: this suite runs in the
 * jsdom environment, where `importOriginal('node:child_process')` resolves to
 * Vite's browser-external shim and throws. Nothing else in this file spawns a
 * process — every other seam under test is pure — so a stub that refuses an
 * unarmed call is both sufficient and louder than a fall-through would be.
 */
const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))

vi.mock('node:child_process', () => {
  const spawnSync = (...args: unknown[]) => spawnSyncMock(...args)
  const spawn = () => {
    throw new Error('spawn() is not stubbed in this suite')
  }
  // The default export is part of the shape: a sibling module under test
  // imports the namespace, and vitest refuses a mock that drops it.
  return { spawnSync, spawn, default: { spawnSync, spawn } }
})

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

  // #501 — the owner read a three-paragraph digest of a 23-PR release as «only
  // three things shipped». Listing the technical PRs was ruled out of scope;
  // their COUNT is what the digest now states.
  it('states the count of technical changes, in the line before the footer', () => {
    const { text } = buildDigest({
      notes: [{ note: 'Часы считают.', title: 'feat: hours', url: 'https://gh/pr/1' }],
      newSha,
      footer: 'ФУТЕР',
      technicalCount: 20,
    })
    expect(text).toContain(
      'Плюс 20 технических изменений (инфраструктура, проверки, документация) — ' +
        'на экране их не видно.',
    )
    const lines = text.trim().split('\n')
    expect(lines[lines.length - 1]).toBe('ФУТЕР')
    expect(lines[lines.length - 3]).toMatch(/^Плюс 20 технических изменений/)
  })

  it('declines the noun with the count in the digest line too', () => {
    const digest = (technicalCount: number) =>
      buildDigest({
        notes: [{ note: 'Часы считают.', title: 't', url: 'u' }],
        newSha,
        footer: 'ФУТЕР',
        technicalCount,
      }).text
    expect(digest(1)).toContain('Плюс 1 техническое изменение (')
    expect(digest(3)).toContain('Плюс 3 технических изменения (')
  })

  it('has no such line at zero — and none when the caller passes no count', () => {
    const notes = [{ note: 'Часы считают.', title: 't', url: 'u' }]
    expect(buildDigest({ notes, newSha, footer: 'ФУТЕР', technicalCount: 0 }).text).not.toMatch(
      /Плюс/,
    )
    expect(buildDigest({ notes, newSha, footer: 'ФУТЕР' }).text).not.toMatch(/Плюс/)
  })

  it('the technical-release line names the count as well', () => {
    const { text } = buildTechnicalReleaseLine({ newSha, footer: 'ФУТЕР', technicalCount: 7 })
    expect(text).toContain(
      '— 7 технических изменений, пользовательских изменений в этой поставке нет.',
    )
    expect(text.trim().endsWith('ФУТЕР')).toBe(true)
  })

  it('the technical-release line keeps its old text at zero / without a count', () => {
    const bare = '— пользовательских изменений в этой поставке нет.'
    expect(
      buildTechnicalReleaseLine({ newSha, footer: 'ФУТЕР', technicalCount: 0 }).text,
    ).toContain(bare)
    expect(buildTechnicalReleaseLine({ newSha, footer: 'ФУТЕР' }).text).toContain(bare)
  })
})

describe('pluralizeTechnicalChanges', () => {
  it('declines «изменение» the way Russian does, teens included', () => {
    expect(pluralizeTechnicalChanges(1)).toBe('1 техническое изменение')
    expect(pluralizeTechnicalChanges(2)).toBe('2 технических изменения')
    expect(pluralizeTechnicalChanges(5)).toBe('5 технических изменений')
    expect(pluralizeTechnicalChanges(11)).toBe('11 технических изменений')
    expect(pluralizeTechnicalChanges(21)).toBe('21 техническое изменение')
    expect(pluralizeTechnicalChanges(22)).toBe('22 технических изменения')
    expect(pluralizeTechnicalChanges(25)).toBe('25 технических изменений')
  })

  it('normalizes its own input — the export cannot say «-1» or «2.5»', () => {
    expect(pluralizeTechnicalChanges(-1)).toBe('0 технических изменений')
    expect(pluralizeTechnicalChanges(2.5)).toBe('2 технических изменения')
    expect(pluralizeTechnicalChanges(Number.NaN)).toBe('0 технических изменений')
  })
})

// ── the count seam ─────────────────────────────────────────────────────

describe('composeDigest — what counts as a technical change (#501)', () => {
  const newSha = 'c'.repeat(40)
  const prevSha = 'p'.repeat(40)
  const PRODUCT = '## Product note (RU)\nРедактор видит черновик до публикации.'
  const NONE = '## Product note (RU)\nnone'
  const NO_SECTION = '## What\nchore\n\n## Why\nCloses #1'

  /**
   * `prs` maps a PR number to what `gh pr view` does for it: a body string is a
   * real PR, `'gh-fails'` is a non-zero exit (an issue reference or a 404), and
   * `'garbage'` is a zero exit whose stdout does not parse.
   */
  function arm(prs: Record<number, string>) {
    const subjects = Object.keys(prs)
      .map((n) => `subject (#${n})`)
      .join('\n')
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') return { status: 0, stdout: `${subjects}\n`, stderr: '' }
      const n = Number(args[2])
      const spec = prs[n]
      if (spec === 'gh-fails') return { status: 1, stdout: '', stderr: 'not a pull request' }
      if (spec === 'garbage') return { status: 0, stdout: 'not json', stderr: '' }
      return {
        status: 0,
        stdout: JSON.stringify({
          number: n,
          title: `PR ${n}`,
          url: `https://gh/pr/${n}`,
          body: spec,
        }),
        stderr: '',
      }
    })
  }

  const compose = () => composeDigest({ prevSha, newSha, footer: 'ФУТЕР' })

  beforeEach(() => {
    spawnSyncMock.mockReset()
    spawnSyncMock.mockImplementation((cmd: string) => {
      throw new Error(`unarmed spawnSync call: ${cmd}`)
    })
  })

  it('a real PR with a real note is a PRODUCT change, and nothing technical', async () => {
    arm({ 1: PRODUCT })
    const digest = await compose()
    expect(digest).not.toBeNull()
    expect(digest?.productCount).toBe(1)
    expect(digest?.technicalCount).toBe(0)
    expect(digest?.text).not.toMatch(/Плюс/)
  })

  it('a real PR whose note is `none` is counted as a TECHNICAL change', async () => {
    arm({ 1: PRODUCT, 2: NONE })
    const digest = await compose()
    expect(digest?.productCount).toBe(1)
    expect(digest?.technicalCount).toBe(1)
    expect(digest?.text).toContain('Плюс 1 техническое изменение (')
  })

  it('a real PR with NO note section at all is counted as a technical change too', async () => {
    arm({ 1: PRODUCT, 2: NO_SECTION })
    const digest = await compose()
    expect(digest?.productCount).toBe(1)
    expect(digest?.technicalCount).toBe(1)
    expect(digest?.text).toContain('Плюс 1 техническое изменение (')
  })

  it('a number that is NO PR at all shipped nothing — counted in neither', async () => {
    // The guard this pins: move the increment above the `gh` exit check and the
    // digest starts announcing 404s and issue references as shipped changes,
    // while every renderer test stays green.
    arm({ 1: PRODUCT, 2: 'gh-fails', 3: 'garbage' })
    const digest = await compose()
    expect(digest?.productCount).toBe(1)
    expect(digest?.technicalCount).toBe(0)
    expect(digest?.text).not.toMatch(/Плюс/)
  })

  it('counts every technical arm together, and renders the plural for the total', async () => {
    arm({ 1: PRODUCT, 2: NONE, 3: NO_SECTION, 4: 'gh-fails' })
    const digest = await compose()
    expect(digest?.productCount).toBe(1)
    expect(digest?.technicalCount).toBe(2)
    expect(digest?.text).toContain(
      'Плюс 2 технических изменения (инфраструктура, проверки, документация) — ' +
        'на экране их не видно.',
    )
  })

  it('a range of ONLY technical PRs renders the technical-release line WITH the count', async () => {
    arm({ 1: NONE, 2: NO_SECTION, 3: NONE })
    const digest = await compose()
    expect(digest?.productCount).toBe(0)
    expect(digest?.technicalCount).toBe(3)
    expect(digest?.text).toContain(
      '— 3 технических изменения, пользовательских изменений в этой поставке нет.',
    )
  })

  it('keeps the bare technical-release line when the range shipped nothing countable', async () => {
    arm({ 1: 'gh-fails' })
    const digest = await compose()
    expect(digest?.productCount).toBe(0)
    expect(digest?.technicalCount).toBe(0)
    expect(digest?.text).toContain('— пользовательских изменений в этой поставке нет.')
  })

  it('green-skips when `git log` itself fails — a bad anchor is not a red deploy', async () => {
    spawnSyncMock.mockImplementation(() => ({ status: 128, stdout: '', stderr: 'bad revision' }))
    expect(await compose()).toBeNull()
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

  it('does NOT post for a ROLLBACK deployment — the incident is not a release', () => {
    // `pnpm deploy:prod --rollback` records its own Deployment so GitHub stops
    // asserting the sha just taken off the box. That record is also a
    // `deployment_status: success` on `production`, so without this predicate it
    // would fire «🚀 Релиз на PROD» re-announcing the release being rolled back
    // TO — the worst possible message at the worst possible moment.
    expect(
      shouldPost({ state: 'success', environment: 'production', task: 'deploy:rollback' }),
    ).toBe(false)
  })

  it('treats a missing task as `deploy` — GitHub’s own API default', () => {
    // A Deployment created by any other means (or before this field was set)
    // omits `task`, and GitHub defaults it to `deploy`. Refusing those would
    // silently drop legitimate digests.
    expect(shouldPost({ state: 'success', environment: 'production', task: undefined })).toBe(true)
    expect(shouldPost({ state: 'success', environment: 'production', task: '' })).toBe(true)
    expect(shouldPost({ state: 'success', environment: 'production', task: 'deploy' })).toBe(true)
  })

  it('refuses any other task rather than guessing', () => {
    expect(
      shouldPost({ state: 'success', environment: 'production', task: 'deploy:migration' }),
    ).toBe(false)
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
  // Task 7.5 (#136) landed the `## Product note (RU)` section and the
  // `product-note` CI guard that makes it non-optional on a render-surface PR.
  // 7.6 adds no second section — it DELIVERS that one. So this reads the REAL
  // template off disk: if 7.5's template ever loses or renames the section, the
  // delivery half breaks here rather than silently posting nothing forever.
  // Same convention as tools/lint/guard-tests/stage-b-lint.spec.ts: the REAL
  // artifact off disk, so the shipped template and this test can never drift.
  const template = readFileSync(resolve(process.cwd(), '.github/pull_request_template.md'), 'utf8')

  it('the shipped template really has the section — and its default is `none`', () => {
    // Both halves matter. `noteIsReal === false` alone would ALSO pass if the
    // heading vanished entirely (extractNote would return ''), quietly turning
    // this into a test of nothing. Asserting the exact extracted value pins the
    // section's presence and its default in one shot.
    expect(extractNote(template)).toBe('none')
    expect(noteIsReal(extractNote(template))).toBe(false)
  })

  it('an untouched template delivers NOTHING to the channel', () => {
    expect(noteIsReal(extractNote(template))).toBe(false)
  })

  it('a filled-in note in the REAL template is extracted clean', () => {
    // Authoring hint (HTML comment), the checklist and the Stage-B block that
    // follow must all stay out of the delivered text.
    const note = 'Редактор теперь видит черновик страницы до публикации.'
    const filled = template.replace(/^none$/m, note)
    expect(extractNote(filled)).toBe(note)
    expect(noteIsReal(extractNote(filled))).toBe(true)
    expect(extractNote(filled)).not.toMatch(/Stage-B|Task-cycle|продуктовым языком/)
  })

  it('the guard and the delivery read the SAME section out of the same file', () => {
    const note = 'Редактор теперь видит черновик страницы до публикации, до нажатия «Опубликовать».'
    const filled = template.replace(/^none$/m, note)
    expect(guardExtractNote(filled)).toBe(extractNote(filled))
  })

  it('the two thresholds diverge ON PURPOSE, and only in the safe direction', () => {
    // The guard demands >=40 characters — an AUTHORING standard, applied when
    // the note is written, on a render-surface PR. Delivery accepts any
    // non-`none` note, because the guard ships as WARN: a short note a reviewer
    // nonetheless merged must still reach the channel. The asymmetry is only
    // ever "delivery is more permissive" — never the reverse, which would mean
    // a note the guard demanded and a human wrote silently never arriving.
    const short = 'Кнопка стала видна.'
    expect(short.length).toBeLessThan(40)

    const filled = template.replace(/^none$/m, short)
    const guarded = guardVerdict({ files: ['src/app/(frontend)/page.tsx'], body: filled })
    expect(guarded.ok).toBe(false) // the guard would flag it as too short…
    expect(noteIsReal(extractNote(filled))).toBe(true) // …delivery still ships it

    // And the reverse must never happen: anything the guard PASSES is
    // necessarily deliverable.
    const proper =
      'Редактор теперь видит черновик страницы до публикации, до нажатия «Опубликовать».'
    const properBody = template.replace(/^none$/m, proper)
    expect(guardVerdict({ files: ['src/app/(frontend)/page.tsx'], body: properBody }).ok).toBe(true)
    expect(noteIsReal(extractNote(properBody))).toBe(true)
  })
})
