import { describe, expect, it } from 'vitest'

import { extractNote, isUserVisible, verdict } from '../product-note-lint.mjs'
import { caseDir, ghDir, runGuard } from './run-guard'

/**
 * product-note — a user-visible change ships the note the owner reads (canon
 * docs/ci-guardrails.md §5).
 *
 * WARN since 2026-08-05 and deliberately NOT on the promotion clock: it is
 * promoted together with task 7.6 (#137), the pipeline that delivers the note.
 * Blocking a merge over a note nothing delivers buys friction, not delivery.
 */

const NOTE = 'Часы теперь считаются по новой формуле, и таблица показывает итог за период.'

describe('isUserVisible', () => {
  it('is true for a changed component or stylesheet', () => {
    expect(isUserVisible(['src/app/(payload)/hours/page.tsx'])).toBe(true)
    expect(isUserVisible(['src/styles/hours.css'])).toBe(true)
  })

  it('is false for tooling, docs, tests and backend-only changes', () => {
    expect(isUserVisible(['tools/lint/no-stub-lint.mjs', 'docs/ci-guardrails.md'])).toBe(false)
    expect(isUserVisible(['src/lib/hours/formula.ts'])).toBe(false)
    expect(isUserVisible(['tests/unit/hours-view-markup.spec.ts'])).toBe(false)
  })
})

describe('extractNote', () => {
  it('reads the section and stops at the next heading', () => {
    expect(extractNote(`## Product note (RU)\n\n${NOTE}\n\n## Why\nCloses #1`)).toBe(NOTE)
  })

  it('reads the single-line marker form', () => {
    expect(extractNote(`product-note: ${NOTE}`)).toBe(NOTE)
  })

  it('does not mistake the template hint for a note', () => {
    expect(
      extractNote('## Product note (RU)\n\n<!-- two sentences in product language -->\n'),
    ).toBeNull()
  })

  it('returns null when there is no section at all', () => {
    expect(extractNote('## What\nrefactor')).toBeNull()
  })
})

describe('verdict', () => {
  const files = ['src/app/hours/page.tsx']

  it('skips a PR that changes nothing a user sees', () => {
    expect(verdict({ files: ['tools/x.mjs'], body: '' })).toMatchObject({
      applies: false,
      ok: true,
    })
  })

  it('passes a user-visible PR carrying a real note', () => {
    expect(verdict({ files, body: `## Product note (RU)\n${NOTE}` })).toMatchObject({ ok: true })
  })

  it('fails a user-visible PR with no section', () => {
    expect(verdict({ files, body: '## What\nnew table' })).toMatchObject({
      applies: true,
      ok: false,
    })
  })

  it('fails the literal `none` — sanctioned only where nobody sees the change', () => {
    expect(verdict({ files, body: 'product-note: none' })).toMatchObject({ ok: false })
  })

  it('fails a placeholder and a one-word note', () => {
    expect(verdict({ files, body: 'product-note: TBD' }).ok).toBe(false)
    expect(verdict({ files, body: 'product-note: пофиксил' }).ok).toBe(false)
  })
})

describe('product-note (spawned)', () => {
  const env = (n: string) => ({
    GITHUB_EVENT_NAME: 'pull_request',
    PR_NUMBER: '7',
    LINT_GH_FIXTURE_DIR: ghDir('product-note', n),
  })

  it('exits 1 on a user-visible PR with no note', () => {
    const res = runGuard('product-note-lint.mjs', caseDir('product-note', 'missing'), {
      env: env('missing'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('Product note (RU)')
  })

  it('exits 0 on a tooling PR — `none` is the sanctioned value there', () => {
    const res = runGuard('product-note-lint.mjs', caseDir('product-note', 'tooling'), {
      env: env('tooling'),
    })
    expect(res.code).toBe(0)
  })
})
