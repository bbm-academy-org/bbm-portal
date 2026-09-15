import { describe, expect, it } from 'vitest'

import {
  WHITELIST_ROWS,
  checkWhitelistBlocks,
  classifyMarker,
  extractMarkerValues,
  isWhitelistScopeFile,
  parseArgs,
  registryClasses,
  runWhitelistBlocksLint,
  severityFromArgv,
} from '../whitelist-blocks-lint.mjs'

/**
 * `pnpm lint:whitelist-blocks` (#482) mechanizes rung 2 of the reuse ladder
 * (`.claude/skills/build-ui-from-design-system/SKILL.md`): a settled row of
 * `docs/design/ui-whitelist.md` is IMPORTED, and departing from one needs an
 * OWNER record — `Bespoke-UI: GO — <owner, date> — <what was approved>` — not
 * the agent's own doc-comment.
 *
 * The recurrence that filed it: PR #470's `RequestsTable.tsx` hand-built a table
 * out of `@/ui/table` primitives instead of the List row's Refine `data-table`
 * block, justified that in its own header comment, passed every round-1 guard,
 * and the owner rejected the live stand on 2026-09-15 (#481).
 *
 * Surface under test: the pure `checkWhitelistBlocks(...)` seam over the exact
 * `{ filename, patch }` shape `gh api repos/{owner}/{repo}/pulls/<n>/files`
 * returns, plus the thin `runWhitelistBlocksLint({ prNumber, gh })` driver with
 * an INJECTED gh runner — no live GitHub, no network.
 */

/** One `gh api .../pulls/<n>/files` entry. */
function file(filename: string, addedLines: string[], startLine = 1) {
  const patch = [`@@ -0,0 +${startLine},${addedLines.length} @@`, ...addedLines.map((l) => `+${l}`)]
  return { filename, patch: patch.join('\n') }
}

const TABLE_PATH = 'src/app/(platform)/p/finance/requests/RequestsTable.tsx'

/**
 * The shape of PR #470's `RequestsTable.tsx`, reduced to what the guard reads:
 * the kit-primitive import, the hand-built markup, and the self-certifying
 * doc-comment that stood in for an owner decision.
 */
const REQUESTS_TABLE = [
  "'use client'",
  '',
  "import { Badge } from '@/ui/badge'",
  "import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'",
  '',
  '/**',
  " * REUSE. The kit's `@/ui/table` primitives, not the Refine `data-table` block",
  ' * of `docs/design/ui-whitelist.md` — that block is driven by `useTable` over a',
  ' * paged RESOURCE, and this surface reads ONE snapshot through `useCustom`.',
  ' */',
  'export function RequestsTable({ rows }: { rows: readonly Row[] }) {',
  '  return (',
  '    <Table className="min-w-[46rem]">',
  '      <TableHeader>',
  '        <TableRow>',
  '          <TableHead>Дата</TableHead>',
  '        </TableRow>',
  '      </TableHeader>',
  '      <TableBody>',
  '        {rows.map((r) => (',
  '          <TableRow key={r.id}>',
  '            <TableCell>{r.createdAt}</TableCell>',
  '          </TableRow>',
  '        ))}',
  '      </TableBody>',
  '    </Table>',
  '  )',
  '}',
]

/** The same surface built on the settled List row instead. */
const BLOCK_TABLE = [
  "'use client'",
  '',
  "import { useTable } from '@refinedev/react-table'",
  '',
  "import { DataTable } from '@/ui/refine-ui/data-table/data-table'",
  "import { DataTablePagination } from '@/ui/refine-ui/data-table/data-table-pagination'",
  '',
  'export function RequestsTable({ columns }: { columns: ColumnDef<Row>[] }) {',
  '  const table = useTable({ columns })',
  '  return <DataTable table={table} />',
  '}',
]

/** Fake `gh` runner: `pr view`, the paged files endpoint, and `issue view`. */
function makeGh(
  prs: Record<number, { body?: string; files: ReturnType<typeof file>[] }>,
  issues: Record<number, string[]> = {},
) {
  return function gh(args: string[]) {
    if (args[0] === 'pr' && args[1] === 'view') {
      const pr = prs[Number(args[2])]
      if (!pr) return { status: 1, stdout: '', stderr: 'no such PR' }
      return {
        status: 0,
        stdout: JSON.stringify({ number: Number(args[2]), body: pr.body ?? '' }),
        stderr: '',
      }
    }
    if (args[0] === 'issue' && args[1] === 'view') {
      const comments = issues[Number(args[2])]
      if (!comments) return { status: 1, stdout: '', stderr: 'no such issue' }
      return {
        status: 0,
        stdout: JSON.stringify({
          number: Number(args[2]),
          comments: comments.map((body) => ({ body })),
        }),
        stderr: '',
      }
    }
    const m = /pulls[/](\d+)[/]files[?]per_page=(\d+)&page=(\d+)/.exec(String(args[1] ?? ''))
    if (args[0] === 'api' && m) {
      const pr = prs[Number(m[1])]
      if (!pr) return { status: 1, stdout: '', stderr: 'no such PR' }
      const per = Number(m[2])
      const page = Number(m[3])
      return {
        status: 0,
        stdout: JSON.stringify(pr.files.slice((page - 1) * per, page * per)),
        stderr: '',
      }
    }
    return { status: 1, stdout: '', stderr: 'unexpected call' }
  }
}

describe('whitelist-blocks-lint: the #470 regression (AC2 of #482)', () => {
  const result = checkWhitelistBlocks({
    pr: {
      number: 470,
      body: 'Stage-B: GO — Антон, 2026-09-14',
      files: [file(TABLE_PATH, REQUESTS_TABLE)],
    },
  })

  it('reports the hand-built table as a departure from the settled List row', () => {
    expect(result.verdict).toBe('violation')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].class).toBe('List')
    expect(result.findings[0].file).toBe(TABLE_PATH)
  })

  it('names the settled implementation the surface had to import', () => {
    expect(result.findings[0].message).toContain('@/ui/refine-ui/data-table')
    expect(result.findings[0].message).toContain('docs/design/ui-whitelist.md')
  })

  it('reports the line the departing import sits on in the NEW file', () => {
    expect(result.findings[0].line).toBe(4)
  })

  it('is NOT satisfied by the component’s own doc-comment justification', () => {
    // The whole reason the guard exists: the prose above is IN the fixture.
    expect(result.message).toContain('Bespoke-UI: GO')
  })
})

describe('whitelist-blocks-lint: the owner record is the only escape (AC3 of #482)', () => {
  const files = [file(TABLE_PATH, REQUESTS_TABLE)]

  function withBody(body: string) {
    return checkWhitelistBlocks({ pr: { number: 470, body, files } })
  }

  it('passes on a filled owner record', () => {
    const r = withBody(
      'Bespoke-UI: GO — Антон, 2026-09-15 — one snapshot through useCustom, no paged resource',
    )
    expect(r.verdict).toBe('pass')
    expect(r.marker).toBe('go')
  })

  it('refuses a BARE `Bespoke-UI: GO` — the tail is part of the record', () => {
    expect(withBody('Bespoke-UI: GO').verdict).toBe('violation')
  })

  it('refuses a GO whose tail records nothing (TBD, an unfilled slot)', () => {
    expect(withBody('Bespoke-UI: GO — TBD').verdict).toBe('violation')
    expect(withBody('Bespoke-UI: GO — <owner, date> — <what was approved>').verdict).toBe(
      'violation',
    )
    expect(withBody('Bespoke-UI: TBD').verdict).toBe('violation')
  })

  it('never reads a record out of an HTML comment or a fenced example', () => {
    expect(withBody('<!-- Bespoke-UI: GO — Антон, 2026-09-15 — why -->').verdict).toBe('violation')
    expect(
      withBody(['```', 'Bespoke-UI: GO — Антон, 2026-09-15 — why', '```'].join('\n')).verdict,
    ).toBe('violation')
  })

  it('accepts the record from a linked issue comment, not only the PR body', () => {
    const r = checkWhitelistBlocks({
      pr: { number: 470, body: 'Closes #388', files },
      issueComments: ['Bespoke-UI: GO — Антон, 2026-09-15 — snapshot endpoint, no resource'],
    })
    expect(r.verdict).toBe('pass')
  })

  it('reads a bold list-item marker the PR template renders', () => {
    expect(withBody('- **Bespoke-UI:** GO — Антон, 2026-09-15 — snapshot endpoint').verdict).toBe(
      'pass',
    )
  })
})

describe('whitelist-blocks-lint: importing the settled block needs no record (AC4 of #482)', () => {
  it('passes a diff that composes the List block', () => {
    const r = checkWhitelistBlocks({
      pr: { number: 1, body: '', files: [file(TABLE_PATH, BLOCK_TABLE)] },
    })
    expect(r.verdict).toBe('pass')
    expect(r.findings).toEqual([])
  })

  it('passes a file that imports BOTH — the block is composed, the primitives dress a cell', () => {
    const r = checkWhitelistBlocks({
      pr: { number: 1, body: '', files: [file(TABLE_PATH, [...BLOCK_TABLE, ...REQUESTS_TABLE])] },
    })
    expect(r.verdict).toBe('pass')
  })

  it('skips a PR with no view code in scope at all', () => {
    const r = checkWhitelistBlocks({
      pr: {
        number: 1,
        body: '',
        files: [file('tools/lint/whitelist-blocks-lint.mjs', ['const x = 1'])],
      },
    })
    expect(r.verdict).toBe('skip')
    expect(r.findings).toEqual([])
  })
})

describe('whitelist-blocks-lint: the Form and Feedback rows', () => {
  const FORM_PATH = 'src/app/(platform)/p/finance/requests/RequestFormSheet.tsx'

  it('flags a raw <form> built with no kit Form composition', () => {
    const r = checkWhitelistBlocks({
      pr: {
        number: 1,
        body: '',
        files: [
          file(FORM_PATH, [
            "import { Input } from '@/ui/input'",
            '<form onSubmit={submit}>',
            '  <Input value={amount} />',
            '</form>',
          ]),
        ],
      },
    })
    expect(r.verdict).toBe('violation')
    expect(r.findings.map((f) => f.class)).toEqual(['Form'])
    expect(r.findings[0].message).toContain('@/ui/form')
  })

  it('passes the same form once it composes the settled Form block', () => {
    const r = checkWhitelistBlocks({
      pr: {
        number: 1,
        body: '',
        files: [
          file(FORM_PATH, [
            "import { Form, FormField } from '@/ui/form'",
            '<form onSubmit={form.handleSubmit(submit)}>',
            '</form>',
          ]),
        ],
      },
    })
    expect(r.verdict).toBe('pass')
  })

  it('flags a browser `alert()` used as the outcome channel', () => {
    const r = checkWhitelistBlocks({
      pr: {
        number: 1,
        body: '',
        files: [file(FORM_PATH, ['  window.alert("Заявка отправлена")'])],
      },
    })
    expect(r.findings.map((f) => f.class)).toEqual(['Feedback'])
    expect(r.findings[0].message).toContain('sonner')
  })

  it('passes a surface that reports through the settled toast channel', () => {
    const r = checkWhitelistBlocks({
      pr: {
        number: 1,
        body: '',
        files: [
          file(FORM_PATH, [
            "import { toast } from 'sonner'",
            '  toast.success("Заявка отправлена")',
          ]),
        ],
      },
    })
    expect(r.verdict).toBe('pass')
  })
})

describe('whitelist-blocks-lint: scope', () => {
  it('judges non-test *.tsx under src/, and never the kit itself', () => {
    expect(isWhitelistScopeFile('src/app/(platform)/p/finance/requests/RequestsTable.tsx')).toBe(
      true,
    )
    expect(isWhitelistScopeFile('src/components/Foo.tsx')).toBe(true)
    // The kit is WHERE the blocks and the primitives live.
    expect(isWhitelistScopeFile('src/ui/table.tsx')).toBe(false)
    expect(isWhitelistScopeFile('src/ui/refine-ui/data-table/data-table.tsx')).toBe(false)
    expect(isWhitelistScopeFile('src/app/(platform)/p/foo/Foo.spec.tsx')).toBe(false)
    expect(isWhitelistScopeFile('src/lib/platform/finance/service.ts')).toBe(false)
    expect(isWhitelistScopeFile('docs/design/ui-whitelist.md')).toBe(false)
  })
})

describe('whitelist-blocks-lint: the guard table cannot drift from the registry', () => {
  const REGISTRY = [
    '## Entries',
    '',
    '| Element class | Settled implementation | Approved at | Notes |',
    '| --- | --- | --- | --- |',
    '| **Form** — any screen that collects or edits fields | shadcn `form` block | #434 | x |',
    '| **List** — any register of records with paging | Refine `data-table` block | #434 | x |',
    '| **Feedback** — the outcome of any act | Toasts through Refine | #434 | x |',
    '',
    '## Adding a row',
  ].join('\n')

  it('parses the settled element classes out of the registry table', () => {
    expect(registryClasses(REGISTRY)).toEqual(['Form', 'List', 'Feedback'])
  })

  it('knows exactly the classes the shipped registry settles', () => {
    expect(WHITELIST_ROWS.map((r) => r.class).sort()).toEqual(['Feedback', 'Form', 'List'].sort())
  })

  it('reports a registry row the guard does not cover — but only on a PR touching the registry', () => {
    const grown = REGISTRY.replace(
      '## Adding a row',
      '| **Navigation** — the shell menu | something | #500 | x |\n\n## Adding a row',
    )
    const touching = checkWhitelistBlocks({
      pr: {
        number: 1,
        body: '',
        files: [file('docs/design/ui-whitelist.md', ['| **Navigation** |'])],
      },
      registry: grown,
    })
    expect(touching.verdict).toBe('violation')
    expect(touching.findings[0].rule).toBe('registry-drift')
    expect(touching.findings[0].message).toContain('Navigation')

    const unrelated = checkWhitelistBlocks({
      pr: { number: 1, body: '', files: [file(TABLE_PATH, BLOCK_TABLE)] },
      registry: grown,
    })
    expect(unrelated.verdict).toBe('pass')
  })

  it('is not cleared by an owner record — drift is about the guard, not the surface', () => {
    const grown = REGISTRY.replace(
      '## Adding a row',
      '| **Navigation** — the shell menu | something | #500 | x |\n\n## Adding a row',
    )
    const r = checkWhitelistBlocks({
      pr: {
        number: 1,
        body: 'Bespoke-UI: GO — Антон, 2026-09-15 — approved',
        files: [file('docs/design/ui-whitelist.md', ['| **Navigation** |'])],
      },
      registry: grown,
    })
    expect(r.verdict).toBe('violation')
  })
})

describe('whitelist-blocks-lint: marker plumbing', () => {
  it('extracts every `Bespoke-UI:` value, decorated or not', () => {
    expect(extractMarkerValues('Bespoke-UI: GO — Антон')).toEqual(['GO — Антон'])
    expect(extractMarkerValues('> - **Bespoke-UI:** GO — Антон')).toEqual(['GO — Антон'])
    expect(extractMarkerValues('nothing here')).toEqual([])
  })

  it('classifies a filled record, an unfilled shape and junk', () => {
    expect(classifyMarker('GO — Антон, 2026-09-15 — approved').kind).toBe('go')
    // A bare `GO` carries no separator and therefore no tail at all: it is not
    // the printed shape either, so it reads as junk rather than as a template
    // left unfilled. What matters is that neither is a record.
    expect(classifyMarker('GO').kind).not.toBe('go')
    expect(classifyMarker('GO — <owner, date>').kind).toBe('placeholder')
    expect(classifyMarker('TBD').kind).toBe('placeholder')
    expect(classifyMarker('someone said it is fine').kind).toBe('unrecognized')
  })
})

describe('whitelist-blocks-lint: severity dial and the unreadable-PR contract (AC5 of #482)', () => {
  const prs = { 470: { body: '', files: [file(TABLE_PATH, REQUESTS_TABLE)] } }

  it('reports the same violation at exit 0 under WARN and exit 1 under BLOCK', () => {
    const gh = makeGh(prs)
    const warn = runWhitelistBlocksLint({ prNumber: 470, severity: 'warn', gh, registry: null })
    expect(warn.verdict).toBe('violation')
    expect(warn.exitCode).toBe(0)
    expect(warn.lines.join('\n')).toContain('WARN')

    const block = runWhitelistBlocksLint({ prNumber: 470, severity: 'block', gh, registry: null })
    expect(block.verdict).toBe('violation')
    expect(block.exitCode).toBe(1)
    expect(block.lines.join('\n')).toContain('BLOCK')
  })

  it('exits non-zero under EVERY severity when the PR cannot be read', () => {
    const gh = makeGh({})
    for (const severity of ['warn', 'block'] as const) {
      const run = runWhitelistBlocksLint({ prNumber: 404, severity, gh, registry: null })
      expect(run.verdict).toBe('error')
      expect(run.exitCode).toBe(1)
      expect(run.lines.join('\n')).toContain('ERROR')
    }
  })

  it('reads the record off a linked issue through the gh seam', () => {
    const gh = makeGh(
      { 470: { body: 'Closes #388', files: [file(TABLE_PATH, REQUESTS_TABLE)] } },
      { 388: ['Bespoke-UI: GO — Антон, 2026-09-15 — snapshot endpoint, no paged resource'] },
    )
    const run = runWhitelistBlocksLint({ prNumber: 470, severity: 'block', gh, registry: null })
    expect(run.verdict).toBe('pass')
    expect(run.exitCode).toBe(0)
  })

  it('parses the PR number and the severity flag together', () => {
    expect(parseArgs(['482', '--severity', 'block'], {})).toEqual({
      prNumber: '482',
      severity: 'block',
      help: false,
    })
    expect(parseArgs([], { PR_NUMBER: '482' })).toEqual({
      prNumber: '482',
      severity: 'warn',
      help: false,
    })
    expect(severityFromArgv([], { WHITELIST_BLOCKS_SEVERITY: 'block' })).toBe('block')
    expect(parseArgs(['--help'], {}).help).toBe(true)
  })
})
