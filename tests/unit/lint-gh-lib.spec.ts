import { describe, expect, it } from 'vitest'

import {
  normalizeFilesPage,
  pagePrFiles,
  prFilesArgs,
  quoteForShell,
} from '../../tools/lint/lib/gh.mjs'

/**
 * The `gh` seam of the lint guards (`tools/lint/lib/gh.mjs`, canon
 * docs/ci-guardrails.md §8). Its own unit test lives here rather than under
 * `tools/lint/guard-tests/`, which `guard-test-coverage` reserves for
 * `<name>-lint.spec.ts` files paired with a guard.
 */
describe('lib/gh: argv that survives the Windows shell', () => {
  /**
   * RED: `ghRun` spawns with `shell: true` on win32 (that is how `gh.cmd` is
   * found), and cmd.exe splits an UNQUOTED `&` into a second command — so
   * `…/files?per_page=100&page=1` ran `gh api …?per_page=100` and then tried to
   * execute `page=1`, and every paged guard failed locally with
   * «'page' is not recognized as an internal or external command». The same
   * latent break existed on the `ghCommit` URL that `tdd-order` uses.
   */
  it('quotes an argument carrying a query string, and leaves plain argv alone', () => {
    const args = prFilesArgs(449, 2)
    expect(quoteForShell(args)).toEqual([
      'api',
      '"repos/{owner}/{repo}/pulls/449/files?per_page=100&page=2"',
    ])
    expect(quoteForShell(['pr', 'view', '449', '--json', 'number,body'])).toEqual([
      'pr',
      'view',
      '449',
      '--json',
      'number,body',
    ])
  })

  it('does not double-quote an argument that is already quoted', () => {
    expect(quoteForShell(['"a&b"'])).toEqual(['"a&b"'])
  })
})

describe('lib/gh: the paged file list', () => {
  it('walks pages until a short one and normalises the REST entry shape', () => {
    const pages: Record<number, unknown[]> = {
      1: Array.from({ length: 3 }, (_, i) => ({ filename: `docs/n-${i}.md`, additions: 1 })),
      2: [{ filename: 'src/a.ts', additions: 4, deletions: 2, status: 'modified' }],
    }
    const seen: number[] = []
    const res = pagePrFiles(
      (page: number) => {
        seen.push(page)
        return { ok: true, data: pages[page] ?? [] }
      },
      { perPage: 3 },
    )
    expect(seen).toEqual([1, 2])
    expect(res.ok).toBe(true)
    expect(res.data.map((f: { path: string }) => f.path)).toEqual([
      'docs/n-0.md',
      'docs/n-1.md',
      'docs/n-2.md',
      'src/a.ts',
    ])
  })

  it('fails closed when the page bound is exhausted, rather than judging a partial set', () => {
    const res = pagePrFiles(() => ({ ok: true, data: [{ filename: 'a.ts' }] }), {
      perPage: 1,
      maxPages: 3,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/more than 3 changed files/)
  })

  it('accepts a bare path string, the shape the pure guard seams are specified for', () => {
    expect(normalizeFilesPage(['src/a.ts'])).toEqual([{ path: 'src/a.ts' }])
  })
})
