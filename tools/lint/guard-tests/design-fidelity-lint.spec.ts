import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  checkDesignFidelity,
  classifyMarker,
  coveringRow,
  extractMarkerValues,
  ghFilesArgs,
  ghIssueArgs,
  ghPrArgs,
  matchesGlob,
  parseIndex,
  runDesignFidelityLint,
} from '../design-fidelity-lint.mjs'

/**
 * `pnpm lint:design-fidelity` (#359) turns the prose rule «a surface whose
 * design source is a WIREFRAME is not ready to build» into a deterministic
 * pre-merge check.
 *
 * Why the guard exists (retro 2026-08-26): `design-source/p-launcher.html` — a
 * Stage-A LAYOUT wireframe — was treated as the fidelity source of truth across
 * #312/#314. The kit's tokens were derived from wireframe greys, PR #354 shipped
 * wireframe idioms as UI, and the reviewer blocked deviations FROM the wireframe.
 * The owner rejected the stand. Every input was present (the README row said
 * "wireframe"); the CHECK was absent.
 *
 * Surface under test: the pure `checkDesignFidelity({ pr, rows, ... })` seam, the
 * `parseIndex` reader over `design-source/README.md`, and the thin
 * `runDesignFidelityLint({ prNumber, gh, index })` driver with an INJECTED gh
 * runner — no live GitHub, no network. The synthetic payloads below are the exact
 * shapes `gh pr view --json number,body`, `gh api …/pulls/N/files` and
 * `gh issue view --json comments` return.
 */

/** A synthetic PR: the file list carries the API's `status` (added/modified/…). */
function pr({
  number = 1,
  body = '',
  files = [] as { path: string; status?: string }[],
}: {
  number?: number
  body?: string
  files?: { path: string; status?: string }[]
}) {
  return { number, body, files: files.map((f) => ({ status: 'modified', ...f })) }
}

/** The `/p` launcher page — the exact surface PR #354 shipped from a wireframe. */
const LAUNCHER = 'src/app/(platform)/p/page.tsx'
const LAUNCHER_CSS = 'src/app/(platform)/p/launcher.css'

/** A synthetic index, in the shipped README's own table shape. */
function indexMd(rows: string[]) {
  return [
    '## Index',
    '',
    '| File | Surface | Covers | Fidelity | Provenance (original / export / build) | Built by |',
    '| ---- | ------- | ------ | -------- | -------------------------------------- | -------- |',
    ...rows,
    '',
  ].join('\n')
}

const WIREFRAME_INDEX = indexMd([
  '| `p-launcher.html` | `/p` home launcher | `src/app/(platform)/p/page.tsx`, `src/app/(platform)/p/*.css` | wireframe | **original** — static-HTML wireframe for #311 Stage A | #314 |',
])

const SYSTEM_INDEX = indexMd([
  "| `system: shadcn/ui via ui.refine.dev @ default theme` | `/p` home launcher | `src/app/(platform)/p/**` | visual | **original** — the standard system's own default theme; owner decision Антон, 2026-08-26 (#360) | #360 |",
])

function rowsOf(md: string) {
  return parseIndex(md).rows
}

/** Fake `gh`: PR view, the files API, and issue comments — what the driver reads. */
function makeGh({
  prs = {} as Record<number, ReturnType<typeof pr>>,
  issues = {} as Record<number, { body: string }[]>,
} = {}) {
  const calls: string[][] = []
  return {
    calls,
    gh(args: string[]) {
      calls.push(args)
      if (args[0] === 'api') {
        const n = Number(/pulls\/(\d+)\/files/.exec(String(args[1]))?.[1])
        const payload = prs[n]
        return payload
          ? {
              status: 0,
              stdout: JSON.stringify(
                payload.files.map((f) => ({ filename: f.path, status: f.status })),
              ),
              stderr: '',
            }
          : { status: 1, stdout: '', stderr: 'no such PR' }
      }
      const n = Number(args[2])
      if (args[0] === 'pr') {
        const payload = prs[n]
        return payload
          ? {
              status: 0,
              stdout: JSON.stringify({ number: payload.number, body: payload.body }),
              stderr: '',
            }
          : { status: 1, stdout: '', stderr: 'no such PR' }
      }
      const comments = issues[n]
      return comments
        ? { status: 0, stdout: JSON.stringify({ number: n, comments }), stderr: '' }
        : { status: 1, stdout: '', stderr: 'no such issue' }
    },
  }
}

describe('design-fidelity-lint: the #354 shape fails (AC1 of #359)', () => {
  const rows = rowsOf(WIREFRAME_INDEX)
  const result = checkDesignFidelity({
    pr: pr({
      number: 354,
      body: '## What\n\nThe /p launcher.\n\nCloses #314\n\nStage-B: N/A (no visual surface) — lead-certified',
      files: [{ path: LAUNCHER }, { path: LAUNCHER_CSS }],
    }),
    rows,
  })

  it('reports a violation: the surface is sourced from a wireframe and no GO is recorded', () => {
    expect(result.verdict).toBe('violation')
    expect(result.findings.map((f) => f.kind)).toEqual(['wireframe', 'wireframe'])
  })

  it('names the touched files and the wireframe row behind them', () => {
    expect(result.findings.map((f) => f.path)).toEqual([LAUNCHER, LAUNCHER_CSS])
    expect(result.findings[0].source).toBe('`p-launcher.html`')
  })

  it('says STOP — the surface is not ready to build — not «match the wireframe»', () => {
    expect(result.message).toContain('not ready to build')
    expect(result.message).toContain('Design-fidelity: GO')
  })

  it('a Stage-B marker is NOT design-fidelity evidence — the two gates are different questions', () => {
    expect(result.evidence).toBeNull()
  })

  it('exits 1 through the driver — the guard is BLOCK, with no severity dial', () => {
    const gh = makeGh({
      prs: {
        354: pr({ number: 354, body: 'Closes #314', files: [{ path: LAUNCHER }] }),
      },
    })
    const run = runDesignFidelityLint({ prNumber: 354, gh: gh.gh, index: WIREFRAME_INDEX })
    expect(run.verdict).toBe('violation')
    expect(run.exitCode).toBe(1)
    expect(run.lines.join('\n')).toContain('BLOCK')
  })
})

describe('design-fidelity-lint: the recorded owner GO clears a wireframe-sourced surface', () => {
  const rows = rowsOf(WIREFRAME_INDEX)
  const files = [{ path: LAUNCHER }]

  it('`Design-fidelity: GO — <owner, date>` in the PR body passes', () => {
    const result = checkDesignFidelity({
      pr: pr({
        body: 'Design-fidelity: GO — Антон, 2026-08-26 (adopting the shadcn/ui default theme, #360)',
        files,
      }),
      rows,
    })
    expect(result.verdict).toBe('pass')
    expect(result.evidence).toContain('GO')
  })

  it('the GO may live on a linked issue — the shape an owner decision actually takes', () => {
    const result = checkDesignFidelity({
      pr: pr({ body: 'Closes #360', files }),
      rows,
      issueComments: [
        'Стенд поднят на 3002.',
        'Design-fidelity: GO — Антон, 2026-08-26 — visual language of /p is the shadcn/ui default theme',
      ],
    })
    expect(result.verdict).toBe('pass')
  })

  it('a bare `GO` is NOT evidence — the verdict names its owner and its day', () => {
    expect(
      checkDesignFidelity({ pr: pr({ body: 'Design-fidelity: GO', files }), rows }).verdict,
    ).toBe('violation')
    expect(classifyMarker('GO').kind).not.toBe('go')
    expect(classifyMarker('GO — Антон, 2026-08-26').kind).toBe('go')
  })

  it('a quoted or commented-out marker is never evidence (the stage-b stripping rule)', () => {
    expect(extractMarkerValues('<!--\nDesign-fidelity: GO — owner, date\n-->')).toEqual([])
    expect(extractMarkerValues('```\nDesign-fidelity: GO — owner, date\n```')).toEqual([])
    expect(
      extractMarkerValues('<!-- example -->\n- **Design-fidelity:** GO — Антон, 2026-08-26'),
    ).toEqual(['GO — Антон, 2026-08-26'])
    expect(
      checkDesignFidelity({
        pr: pr({ body: 'Closes #1', files }),
        rows,
        issueComments: ['Напоминание:\n```\nDesign-fidelity: GO — <owner, date>\n```'],
      }).verdict,
    ).toBe('violation')
  })

  it('the unfilled placeholder fails, and says so distinctly', () => {
    const result = checkDesignFidelity({
      pr: pr({ body: 'Design-fidelity: <GO — owner, date | batched at #N covers …>', files }),
      rows,
    })
    expect(result.verdict).toBe('violation')
    expect(result.message).toContain('placeholder')
  })
})

describe('design-fidelity-lint: the guard’s own printed shape is not a way out of the guard', () => {
  // Review of PR #371: the blocked session is HANDED the marker shape by the
  // violation message. If pasting that string back unfilled clears the BLOCK,
  // the gate is decorative — the same «every input present, nothing checked»
  // class #359 exists to close. Canon: `.claude/rules/design-process.md` §2 —
  // «a bare GO, a TBD, or the unfilled template placeholder is NOT a record».
  const rows = rowsOf(WIREFRAME_INDEX)
  const files = [{ path: LAUNCHER }]

  /** The guard's OWN output for a blocked PR — the bytes a session copies from. */
  const blockedMessage = checkDesignFidelity({ pr: pr({ files }), rows }).message
  /** The `Design-fidelity: …` lines that message prints, verbatim, indent and all. */
  const printedLines = blockedMessage.split('\n').filter((l) => /Design-fidelity\s*:/i.test(l))
  /** Their VALUES — what `classifyMarker` would see if the indent were decoration. */
  const printedValues = printedLines.map((l) => l.replace(/^.*?Design-fidelity\s*:\s*/i, '').trim())

  it('the message really does print both marker shapes (the premise of this block)', () => {
    expect(printedLines.length).toBe(2)
    expect(printedValues[0]).toMatch(/^GO\b/)
    expect(printedValues[1]).toMatch(/^batched\b/)
  })

  it('a GO whose tail is only angle-bracket placeholders is a placeholder, not evidence', () => {
    for (const value of printedValues) expect(classifyMarker(value).kind).not.toBe('go')
    expect(classifyMarker(printedValues[0]).kind).toBe('placeholder')
    expect(classifyMarker('GO — <owner, date>').kind).toBe('placeholder')
    expect(
      classifyMarker('GO — <owner, date> — <the visual language that was approved>').kind,
    ).toBe('placeholder')
    // …and the filled record still passes: the tail is a named person and a day.
    expect(classifyMarker('GO — Антон, 2026-08-26 — shadcn/ui default theme').kind).toBe('go')
  })

  it('the unfilled `batched at #<gate issue>` shape is a placeholder too', () => {
    expect(classifyMarker(printedValues[1]).kind).toBe('placeholder')
    expect(classifyMarker('batched at #<gate issue> covers `<path glob>`').kind).toBe('placeholder')
    expect(classifyMarker('batched at #360 covers `src/**`').kind).toBe('batched')
  })

  it('pasting the unfilled GO into the PR body does NOT clear the BLOCK', () => {
    const result = checkDesignFidelity({
      pr: pr({
        body: 'Design-fidelity: GO — <owner, date> — <the visual language that was approved>',
        files,
      }),
      rows,
    })
    expect(result.verdict).toBe('violation')
    expect(result.evidence).toBeNull()
    expect(result.message).toContain('placeholder')
  })

  it('the guard’s own violation output, pasted verbatim, yields no evidence at all', () => {
    // The indented SHAPES lines are markdown INDENTED CODE — text that only
    // talks about the marker, exactly like the fenced example `stripNonEvidence`
    // already drops. Neither the PR body nor a linked-issue comment may arm the
    // gate with it.
    expect(extractMarkerValues(blockedMessage)).toEqual([])
    for (const body of [blockedMessage, `> ${blockedMessage.split('\n').join('\n> ')}`]) {
      const result = checkDesignFidelity({ pr: pr({ body, files }), rows })
      expect(result.verdict).toBe('violation')
      expect(result.evidence).toBeNull()
    }
    expect(
      checkDesignFidelity({
        pr: pr({ body: 'Closes #360', files }),
        rows,
        issueComments: [blockedMessage],
      }).verdict,
    ).toBe('violation')
  })

  it('an indented marker line is never evidence, filled or not', () => {
    expect(extractMarkerValues('    Design-fidelity: GO — Антон, 2026-08-26')).toEqual([])
    expect(extractMarkerValues('\tDesign-fidelity: GO — Антон, 2026-08-26')).toEqual([])
    // A one-level list indent is still prose, not a code block: it stays evidence.
    expect(extractMarkerValues('  - Design-fidelity: GO — Антон, 2026-08-26')).toEqual([
      'GO — Антон, 2026-08-26',
    ])
  })
})

describe('design-fidelity-lint: a standard design system is a legitimate visual source (#359 scope note)', () => {
  // Owner decision 2026-08-26 on #359/#360: the visual language of /p is the
  // default theme of a standard system, not a vendored mockup. The gate must
  // accept the row that says so, with no mockup file and no per-PR marker.
  it('a `system:` row with `fidelity: visual` passes on its own', () => {
    const result = checkDesignFidelity({
      pr: pr({ body: 'Closes #360', files: [{ path: LAUNCHER }] }),
      rows: rowsOf(SYSTEM_INDEX),
    })
    expect(result.verdict).toBe('pass')
    expect(result.findings).toEqual([])
  })

  it('the row is parsed as a system source, not as a missing file', () => {
    const [row] = rowsOf(SYSTEM_INDEX)
    expect(row.system).toBe('shadcn/ui via ui.refine.dev @ default theme')
    expect(row.file).toBeNull()
    expect(row.fidelity).toBe('visual')
  })

  it('`canvas` fidelity passes too — a visual canvas is a visual decision', () => {
    const rows = rowsOf(
      indexMd([
        '| `finance/Overview.dc.html` | `/p/finance` overview | `src/app/(platform)/p/finance/**` | canvas | **original** — artboard | #338 |',
      ]),
    )
    expect(
      checkDesignFidelity({
        pr: pr({ files: [{ path: 'src/app/(platform)/p/finance/page.tsx' }] }),
        rows,
      }).verdict,
    ).toBe('pass')
  })
})

describe('design-fidelity-lint: a new route with no design source fails outright (AC2 of #359)', () => {
  const rows = rowsOf(WIREFRAME_INDEX)

  it('an ADDED route file no row covers is a finding', () => {
    const result = checkDesignFidelity({
      pr: pr({ files: [{ path: 'src/app/(platform)/p/leads/page.tsx', status: 'added' }] }),
      rows,
    })
    expect(result.verdict).toBe('violation')
    expect(result.findings[0].kind).toBe('no-source')
    expect(result.message).toContain('design-source/')
  })

  it('a MODIFIED uncovered view file is not a finding — back-fill is «on first touch», not retroactive', () => {
    const result = checkDesignFidelity({
      pr: pr({ files: [{ path: 'src/app/(platform)/p/okr/page.tsx', status: 'modified' }] }),
      rows,
    })
    expect(result.verdict).toBe('pass')
  })

  it('an added NON-route view file (a shared component) is not a finding', () => {
    expect(
      checkDesignFidelity({
        pr: pr({ files: [{ path: 'src/ui/Button.tsx', status: 'added' }] }),
        rows,
      }).verdict,
    ).toBe('pass')
  })
})

describe('design-fidelity-lint: `batched at #N` must cover the touched surface (AC of #359)', () => {
  const rows = rowsOf(WIREFRAME_INDEX)

  it('a gate whose `covers` globs match the touched files passes', () => {
    const result = checkDesignFidelity({
      pr: pr({
        body: 'Design-fidelity: batched at #360 covers `src/app/(platform)/p/**`',
        files: [{ path: LAUNCHER }, { path: LAUNCHER_CSS }],
      }),
      rows,
    })
    expect(result.verdict).toBe('pass')
  })

  it('a gate that does not cover the touched surface is not a pass, and the message names it', () => {
    const result = checkDesignFidelity({
      pr: pr({
        body: 'Design-fidelity: batched at #360 covers `src/app/(platform)/p/admin/**`',
        files: [{ path: LAUNCHER }],
      }),
      rows,
    })
    expect(result.verdict).toBe('violation')
    expect(result.findings[0].kind).toBe('batched-scope')
    expect(result.message).toContain('#360')
  })

  it('`batched at #N` with no `covers` clause covers nothing', () => {
    expect(classifyMarker('batched at #360')).toEqual({ kind: 'batched', gate: 360, covers: [] })
    expect(classifyMarker('batched at #360 covers `a/**`, b/*.css')).toEqual({
      kind: 'batched',
      gate: 360,
      covers: ['a/**', 'b/*.css'],
    })
    expect(
      checkDesignFidelity({
        pr: pr({ body: 'Design-fidelity: batched at #360', files: [{ path: LAUNCHER }] }),
        rows,
      }).verdict,
    ).toBe('violation')
  })
})

describe('design-fidelity-lint: the index is the machine-readable record', () => {
  // The real shipped file, read from disk: the fixture and the artifact this
  // guard governs can never drift apart (AC3 of #359).
  const README = readFileSync(resolve(process.cwd(), 'design-source/README.md'), 'utf8')

  it('every shipped provenance row carries a valid `fidelity` value', () => {
    const { rows, badRows } = parseIndex(README)
    expect(badRows).toEqual([])
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const row of rows) expect(['wireframe', 'visual', 'canvas']).toContain(row.fidelity)
  })

  it('`p-launcher.html` and `p-admin-shell.html` are wireframes', () => {
    const { rows } = parseIndex(README)
    const byFile = Object.fromEntries(rows.filter((r) => r.file).map((r) => [r.file, r.fidelity]))
    expect(byFile['`p-launcher.html`']).toBe('wireframe')
    expect(byFile['`p-admin-shell.html`']).toBe('wireframe')
  })

  it('a row with a missing or unknown fidelity is itself a finding', () => {
    const { rows, badRows } = parseIndex(
      indexMd([
        '| `x.html` | `/x` | `src/app/x/**` | high-fi | **original** — x | #1 |',
        '| `y.html` | `/y` | `src/app/y/**` |  | **original** — y | #2 |',
      ]),
    )
    expect(rows).toEqual([])
    expect(badRows.map((r) => r.reason)).toEqual(['unknown-fidelity', 'missing-fidelity'])
  })

  it('a bad row fails a PR that touches the index or ships a UI diff, and only those', () => {
    const { rows, badRows } = parseIndex(
      indexMd(['| `x.html` | `/x` | `src/app/x/**` | high-fi | **original** — x | #1 |']),
    )
    const readmeTouch = checkDesignFidelity({
      pr: pr({ files: [{ path: 'design-source/README.md' }] }),
      rows,
      badRows,
    })
    expect(readmeTouch.verdict).toBe('violation')
    expect(readmeTouch.findings[0].kind).toBe('bad-row')

    const unrelated = checkDesignFidelity({
      pr: pr({ files: [{ path: 'src/endpoints/leads.ts' }] }),
      rows,
      badRows,
    })
    expect(unrelated.verdict).toBe('skip')
  })

  it('the most specific covering row wins — a screen row overrides the shell row it sits in', () => {
    const rows = rowsOf(
      indexMd([
        '| `p-admin-shell.html` | shell | `src/app/(platform)/p/admin/**` | wireframe | **original** — a | #315 |',
        '| `finance/References.dc.html` | refs | `src/app/(platform)/p/admin/finance/**` | canvas | **original** — b | #338 |',
      ]),
    )
    expect(coveringRow(rows, 'src/app/(platform)/p/admin/page.tsx')?.fidelity).toBe('wireframe')
    expect(coveringRow(rows, 'src/app/(platform)/p/admin/finance/page.tsx')?.fidelity).toBe(
      'canvas',
    )
    expect(coveringRow(rows, 'src/app/(platform)/p/okr/page.tsx')).toBeNull()
  })

  it('glob matching is literal about the route-group parentheses', () => {
    expect(matchesGlob('src/app/(platform)/p/**', 'src/app/(platform)/p/a/page.tsx')).toBe(true)
    expect(matchesGlob('src/app/(platform)/p/**', 'src/app/platform/p/a/page.tsx')).toBe(false)
    expect(matchesGlob('src/app/(platform)/p/*.css', 'src/app/(platform)/p/a.css')).toBe(true)
    expect(matchesGlob('src/app/(platform)/p/*.css', 'src/app/(platform)/p/a/b.css')).toBe(false)
  })
})

describe('design-fidelity-lint: what counts as a UI diff (the lint:stage-b definition)', () => {
  const rows = rowsOf(WIREFRAME_INDEX)

  it('a PR with no non-test *.tsx / *.css under src/ is skipped', () => {
    const result = checkDesignFidelity({
      pr: pr({ files: [{ path: 'src/endpoints/leads.ts' }, { path: 'docs/specs/1.md' }] }),
      rows,
    })
    expect(result.verdict).toBe('skip')
    expect(result.message).toContain('no UI diff')
  })

  it('tests, migrations and generated types never trigger the gate', () => {
    expect(
      checkDesignFidelity({
        pr: pr({
          files: [
            { path: 'src/app/(platform)/p/view.spec.tsx' },
            { path: 'src/migrations/20260101_init.ts' },
            { path: 'src/payload-types.ts' },
          ],
        }),
        rows,
      }).verdict,
    ).toBe('skip')
  })
})

describe('design-fidelity-lint: driver contract', () => {
  it('reads the PR body, the files API and the linked issue, naming the repo each time', () => {
    expect(ghPrArgs(359)).toEqual([
      'pr',
      'view',
      '359',
      '--repo',
      'bbm-academy-org/bbm-portal',
      '--json',
      'number,body',
    ])
    expect(ghFilesArgs(359)).toEqual([
      'api',
      'repos/bbm-academy-org/bbm-portal/pulls/359/files?per_page=100',
      '--paginate',
      '--slurp',
    ])
    expect(ghIssueArgs(360)).toEqual([
      'issue',
      'view',
      '360',
      '--repo',
      'bbm-academy-org/bbm-portal',
      '--json',
      'number,comments',
    ])
  })

  it('the driver reads the GO off a `Closes #N` issue and passes', () => {
    const gh = makeGh({
      prs: { 361: pr({ number: 361, body: 'Closes #360', files: [{ path: LAUNCHER }] }) },
      issues: { 360: [{ body: 'Design-fidelity: GO — Антон, 2026-08-26' }] },
    })
    const run = runDesignFidelityLint({ prNumber: 361, gh: gh.gh, index: WIREFRAME_INDEX })
    expect(run.verdict).toBe('pass')
    expect(run.exitCode).toBe(0)
  })

  it('also resolves the partial linkage `Part of #N`', () => {
    const gh = makeGh({
      prs: { 362: pr({ number: 362, body: 'Part of #360', files: [{ path: LAUNCHER }] }) },
      issues: { 360: [{ body: 'Design-fidelity: GO — Антон, 2026-08-26' }] },
    })
    expect(
      runDesignFidelityLint({ prNumber: 362, gh: gh.gh, index: WIREFRAME_INDEX }).verdict,
    ).toBe('pass')
  })

  it('an unreadable PR is a fatal error, never a silent pass', () => {
    const run = runDesignFidelityLint({ prNumber: 999, gh: makeGh().gh, index: WIREFRAME_INDEX })
    expect(run.verdict).toBe('error')
    expect(run.exitCode).toBe(1)
    expect(run.lines.join('\n')).toContain('#999')
  })

  it('an unreachable linked issue is reported and is not evidence', () => {
    const gh = makeGh({
      prs: { 363: pr({ number: 363, body: 'Closes #4242', files: [{ path: LAUNCHER }] }) },
    })
    const run = runDesignFidelityLint({ prNumber: 363, gh: gh.gh, index: WIREFRAME_INDEX })
    expect(run.verdict).toBe('violation')
    expect(run.lines.join('\n')).toContain('#4242')
  })

  it('an unreadable index is fail-closed, not an empty index that clears everything', () => {
    const gh = makeGh({
      prs: { 364: pr({ number: 364, body: 'Closes #1', files: [{ path: LAUNCHER }] }) },
    })
    const run = runDesignFidelityLint({ prNumber: 364, gh: gh.gh, index: '# no index here\n' })
    expect(run.verdict).toBe('error')
    expect(run.exitCode).toBe(1)
  })
})
