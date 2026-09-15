import { describe, expect, it } from 'vitest'

import {
  checkInteractionStates,
  parseArgs,
  runInteractionStatesLint,
  severityFromArgv,
} from '../interaction-states-lint.mjs'

/**
 * `pnpm lint:interaction-states` (#435) is the states half of the same owner
 * ruling `primitives-first` covers: an element you can click has to LOOK
 * clickable and has to show keyboard focus, and that contract is owned once by
 * the `src/ui` kit rather than hand-assembled per screen.
 *
 * #435's measurement is the reason it exists: under `src/app/(platform)`,
 * `onClick` appears 27 times against 6 `hover:` occurrences, and `cursor-pointer`
 * appears ZERO times anywhere in `src` — interactive elements built from raw tags
 * with no hover, focus or active treatment at all.
 *
 * Ported from ds-platform `tools/lint/interaction-states-lint.ts`. Two deliberate
 * divergences, both recorded in the guard's own header: the scope is one PR's
 * DIFF rather than the whole tree (see `primitives-first`'s spec for why), and
 * the layer-1 / primitive-contract halves of the original are dropped — they
 * assert a `globals.css` base reset and an `interactiveBase` fragment that this
 * repo's kit (stock shadcn/ui via Refine, #360/#434) does not have.
 */

/** One `gh api .../pulls/<n>/files` entry built from added lines. */
function file(filename: string, addedLines: string[], startLine = 1) {
  const patch = [`@@ -0,0 +${startLine},${addedLines.length} @@`, ...addedLines.map((l) => `+${l}`)]
  return { filename, patch: patch.join('\n') }
}

function makeGh(prs: Record<number, ReturnType<typeof file>[]>) {
  return {
    gh(args: string[]) {
      const m = /pulls[/](\d+)[/]files[?]per_page=(\d+)&page=(\d+)/.exec(String(args[1] ?? ''))
      if (args[0] !== 'api' || !m) return { status: 1, stdout: '', stderr: 'unexpected call' }
      const payload = prs[Number(m[1])]
      if (!payload) return { status: 1, stdout: '', stderr: 'no such PR' }
      const per = Number(m[2])
      const page = Number(m[3])
      return {
        status: 0,
        stdout: JSON.stringify(payload.slice((page - 1) * per, page * per)),
        stderr: '',
      }
    },
  }
}

const BOARD = 'src/app/(platform)/p/finance/requests/RequestsBoard.tsx'

describe('interaction-states-lint: a clickable with no states is a finding (AC2 of #435)', () => {
  const result = checkInteractionStates([
    file(BOARD, [
      '<div className="rounded border p-3" onClick={() => open(row.id)}>',
      '  {row.title}',
      '</div>',
    ]),
  ])

  it('flags the onClick host and names what is missing', () => {
    expect(result.verdict).toBe('violation')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].missing).toEqual(['hover', 'focus-visible'])
  })

  it('reports the tag and the line it opens on', () => {
    expect(result.findings[0].tag).toBe('div')
    expect(result.findings[0].line).toBe(1)
  })

  it('flags a raw <button onClick> with no hover treatment either', () => {
    const r = checkInteractionStates([
      file(BOARD, ['<button className="px-3" onClick={submit}>Отправить</button>']),
    ])
    expect(r.findings.map((f) => f.tag)).toEqual(['button'])
  })

  it('names only the half that is missing when the other half is present', () => {
    const r = checkInteractionStates([
      file(BOARD, ['<button className="hover:bg-muted" onClick={submit}>ok</button>']),
    ])
    expect(r.findings[0].missing).toEqual(['focus-visible'])
  })

  it('points at the kit rather than restating the contract', () => {
    expect(result.findings[0].message).toContain('src/ui')
  })
})

describe('interaction-states-lint: a treated clickable passes (AC2 of #435)', () => {
  it('accepts a raw tag that carries both hover and focus-visible', () => {
    const result = checkInteractionStates([
      file(BOARD, [
        '<button',
        '  onClick={submit}',
        '  className="rounded px-3 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"',
        '>',
        '  Отправить',
        '</button>',
      ]),
    ])
    expect(result.verdict).toBe('pass')
  })

  /**
   * The enclosing-tag walk goes backwards to the nearest `<`. A `<` inside an
   * attribute EXPRESSION (`{count < limit}`) is not a tag opening — JSX has no
   * `< limit>` tag — but taking it for one slices the tag text after the real
   * `className`, and the guard invents a finding about a tag that does not exist
   * (review of PR #459, N5).
   */
  it('does not mistake a `<` inside an attribute expression for the tag opening', () => {
    const result = checkInteractionStates([
      file(BOARD, [
        '<button className="hover:bg-accent focus-visible:ring-2" aria-hidden={count < limit} onClick={run}>',
        '  ok',
        '</button>',
      ]),
    ])
    expect(result.findings).toEqual([])
    expect(result.verdict).toBe('pass')
  })

  it('accepts `group-hover:` / `peer-focus-visible:` variants as the treatment', () => {
    const result = checkInteractionStates([
      file(BOARD, [
        '<div onClick={open} className="group-hover:bg-muted peer-focus-visible:ring-2" />',
      ]),
    ])
    expect(result.verdict).toBe('pass')
  })

  it('leaves a kit component alone — the primitive owns its own states', () => {
    const result = checkInteractionStates([
      file(BOARD, ["import { Button } from '@/ui/button'", '<Button onClick={submit}>ok</Button>']),
    ])
    expect(result.verdict).toBe('pass')
  })

  it('says on stdout what it scanned rather than exiting silently', () => {
    const result = checkInteractionStates([file(BOARD, ['<Button onClick={x} />'])])
    expect(result.message.toLowerCase()).toContain('file')
  })
})

describe('interaction-states-lint: the disabled half', () => {
  it('requires a disabled treatment when the clickable can be disabled', () => {
    const result = checkInteractionStates([
      file(BOARD, [
        '<button onClick={submit} disabled={busy} className="hover:bg-accent focus-visible:ring-2">',
        '  ok',
        '</button>',
      ]),
    ])
    expect(result.findings[0].missing).toEqual(['disabled'])
  })

  it('accepts it once the disabled variant is styled', () => {
    const result = checkInteractionStates([
      file(BOARD, [
        '<button onClick={submit} disabled={busy}',
        '  className="hover:bg-accent focus-visible:ring-2 disabled:opacity-50">ok</button>',
      ]),
    ])
    expect(result.verdict).toBe('pass')
  })
})

describe('interaction-states-lint: scope is the PR diff under src/app/(platform)', () => {
  it('ignores an untreated clickable outside the platform app', () => {
    const result = checkInteractionStates([
      file('src/components/Legacy.tsx', ['<div onClick={go} />']),
    ])
    expect(result.verdict).toBe('skip')
  })

  it('ignores the kit itself', () => {
    const result = checkInteractionStates([file('src/ui/button.tsx', ['<button onClick={go} />'])])
    expect(result.verdict).toBe('skip')
  })

  it('reads only ADDED lines', () => {
    const patch = ['@@ -10,2 +10,3 @@', ' <div onClick={go}>', '+  {label}', ' </div>'].join('\n')
    expect(checkInteractionStates([{ filename: BOARD, patch }]).verdict).toBe('pass')
  })

  it('does not flag a clickable that only exists in a comment', () => {
    const result = checkInteractionStates([
      file(BOARD, ['// the old row was <div onClick={go}> with no states', '<Button />']),
    ])
    expect(result.verdict).toBe('pass')
  })
})

describe('interaction-states-lint: the inline allow-list', () => {
  it('accepts a reasoned `interaction-states-ok:` marker above the tag', () => {
    const result = checkInteractionStates([
      file(BOARD, [
        '{/* interaction-states-ok: a full-card overlay, the card below carries the affordance */}',
        '<div onClick={open} className="absolute inset-0" />',
      ]),
    ])
    expect(result.verdict).toBe('pass')
  })

  it('does NOT accept a bare marker with no reason', () => {
    const result = checkInteractionStates([
      file(BOARD, ['{/* interaction-states-ok: */}', '<div onClick={open} />']),
    ])
    expect(result.verdict).toBe('violation')
  })
})

describe('interaction-states-lint: severity dial and the unreadable-PR contract (AC5 of #435)', () => {
  const board = [file(BOARD, ['<div onClick={go} />'])]

  it('reports the same violation at exit 0 under WARN and exit 1 under BLOCK', () => {
    const gh = makeGh({ 500: board })
    const warn = runInteractionStatesLint({ prNumber: 500, severity: 'warn', gh: gh.gh })
    expect(warn.verdict).toBe('violation')
    expect(warn.exitCode).toBe(0)
    expect(warn.lines.join('\n')).toContain('WARN')

    const block = runInteractionStatesLint({ prNumber: 500, severity: 'block', gh: gh.gh })
    expect(block.verdict).toBe('violation')
    expect(block.exitCode).toBe(1)
  })

  it('exits non-zero under EVERY severity when the PR cannot be read', () => {
    const gh = makeGh({})
    for (const severity of ['warn', 'block'] as const) {
      const run = runInteractionStatesLint({ prNumber: 404, severity, gh: gh.gh })
      expect(run.verdict).toBe('error')
      expect(run.exitCode).toBe(1)
      expect(run.lines.join('\n')).toContain('ERROR')
    }
  })

  it('parses the PR number and the severity flag together', () => {
    expect(parseArgs(['430', '--severity', 'block'], {})).toEqual({
      prNumber: '430',
      severity: 'block',
    })
    expect(parseArgs([], { PR_NUMBER: '430' })).toEqual({ prNumber: '430', severity: 'warn' })
    expect(severityFromArgv([], { INTERACTION_STATES_SEVERITY: 'block' })).toBe('block')
  })
})

/**
 * #483 — the guard used to skip EVERY capitalised tag, so PR #470's clickable
 * `<TableRow onClick={…} className="cursor-pointer">` (the finance requests
 * table, issue #388) walked through it while the owner rejected exactly that
 * class of defect on the live stand, 2026-09-15. A clickable is a clickable
 * whether its tag is `<div>` or `<TableRow>`.
 *
 * The widened rule and why it is drawn where it is: the guard's own header,
 * «KIT COMPONENTS».
 */
const TABLE = 'src/app/(platform)/p/finance/requests/RequestsTable.tsx'
const KIT_IMPORT = "import { Table, TableBody, TableCell, TableRow } from '@/ui/table'"

describe('interaction-states-lint: a clickable KIT component is judged too (#483)', () => {
  /** PR #470's row, verbatim in shape: the kit import, the in-tag comment, `cursor-pointer` only. */
  const requestsTableRow = [
    KIT_IMPORT,
    "import { Button } from '@/ui/button'",
    '<TableRow',
    '  key={request.id}',
    '  // The whole row is the pointer target — a table whose rows open',
    '  // something and look inert is the row-action defect of #433.',
    '  onClick={() => onOpen(request)}',
    '  className="cursor-pointer"',
    '>',
  ]

  it('reports PR #470\u2019s `<TableRow onClick>` with `cursor-pointer` and nothing else', () => {
    const result = checkInteractionStates([file(TABLE, requestsTableRow)])
    expect(result.verdict).toBe('violation')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].tag).toBe('TableRow')
    expect(result.findings[0].missing).toEqual(['hover', 'focus-visible'])
  })

  it('reports it at the line the tag opens on, in that file', () => {
    const result = checkInteractionStates([file(TABLE, requestsTableRow)])
    expect(result.findings[0].file).toBe(TABLE)
    expect(result.findings[0].line).toBe(3)
  })

  /**
   * The import does not have to be in the diff: an edited file adds the
   * clickable row without re-adding its import line. The kit is read from the
   * checked-out tree — `src/ui/table.tsx` exports `TableRow`.
   */
  it('judges a kit component whose import line is not part of the diff', () => {
    const result = checkInteractionStates([
      file(TABLE, ['<TableRow onClick={() => onOpen(row)} className="cursor-pointer" />']),
    ])
    expect(result.findings.map((f) => f.tag)).toEqual(['TableRow'])
  })

  it('passes once the call site declares hover and focus-visible', () => {
    const result = checkInteractionStates([
      file(TABLE, [
        KIT_IMPORT,
        '<TableRow',
        '  onClick={() => onOpen(row)}',
        '  className="cursor-pointer hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"',
        '/>',
      ]),
    ])
    expect(result.verdict).toBe('pass')
  })

  it('accepts a reasoned `interaction-states-ok:` marker at the call site', () => {
    const result = checkInteractionStates([
      file(TABLE, [
        KIT_IMPORT,
        '{/* interaction-states-ok: the row mirrors the named control in the cell */}',
        '<TableRow onClick={() => onOpen(row)} className="cursor-pointer" />',
      ]),
    ])
    expect(result.verdict).toBe('pass')
  })
})

describe('interaction-states-lint: what the widened rule deliberately does NOT judge (#483)', () => {
  it('leaves an app-local component alone — the diff cannot classify its states', () => {
    const result = checkInteractionStates([
      file(TABLE, ['function RequestRow() {}', '<RequestRow onClick={open} />']),
    ])
    expect(result.verdict).toBe('pass')
  })

  it('leaves a name the diff imports from OUTSIDE the kit alone, kit namesake or not', () => {
    const result = checkInteractionStates([
      file(TABLE, ["import { Card } from './RequestCard'", '<Card onClick={open} />']),
    ])
    expect(result.verdict).toBe('pass')
  })

  it('leaves an `asChild` pass-through alone — the CHILD carries the states', () => {
    const result = checkInteractionStates([
      file(TABLE, [
        "import { DropdownMenuTrigger } from '@/ui/dropdown-menu'",
        '<DropdownMenuTrigger asChild onClick={open}>',
        '  <Button>…</Button>',
        '</DropdownMenuTrigger>',
      ]),
    ])
    expect(result.verdict).toBe('pass')
  })

  it.each([
    'Button',
    'InputGroupButton',
    'PaginationLink',
    'AlertDialogAction',
    'AlertDialogCancel',
    'CalendarDayButton',
    'DropdownMenuItem',
    'DropdownMenuCheckboxItem',
    'DropdownMenuRadioItem',
    'DropdownMenuSubTrigger',
    'SelectItem',
    'SelectTrigger',
    'CommandItem',
    'TabsTrigger',
    'Checkbox',
    'Switch',
    'SidebarMenuButton',
    'SidebarMenuSubButton',
    'SidebarMenuAction',
  ])('leaves the state-owning kit control `%s` alone', (name) => {
    const result = checkInteractionStates([
      file(TABLE, [`import { ${name} } from '@/ui/kit'`, `<${name} onClick={run} />`]),
    ])
    expect(result.verdict).toBe('pass')
  })

  it('does not report a kit clickable twice when the tag is also a `Button` host', () => {
    const result = checkInteractionStates([
      file(TABLE, [
        KIT_IMPORT,
        "import { Button } from '@/ui/button'",
        '<TableRow onClick={open} className="cursor-pointer">',
        '  <TableCell>',
        '    <Button variant="link" onClick={open}>ok</Button>',
        '  </TableCell>',
        '</TableRow>',
      ]),
    ])
    expect(result.findings.map((f) => f.tag)).toEqual(['TableRow'])
  })

  it('reads the kit from an injected component set rather than the tree when given one', () => {
    const files = [file(TABLE, ['<Widget onClick={open} />'])]
    expect(checkInteractionStates(files, { kitComponents: [] }).verdict).toBe('pass')
    expect(checkInteractionStates(files, { kitComponents: ['Widget'] }).verdict).toBe('violation')
  })
})
