import { describe, expect, it } from 'vitest'

import {
  KIT_EQUIVALENTS,
  checkPrimitivesFirst,
  parseArgs,
  runPrimitivesFirstLint,
  severityFromArgv,
} from '../primitives-first-lint.mjs'

/**
 * `pnpm lint:primitives-first` (#435) mechanizes the first rung of the reuse
 * ladder (`.claude/skills/build-ui-from-design-system/SKILL.md`) for the surface
 * the owner ruled on 2026-09-02: «the ready libraries are sufficient and nothing
 * is to be reinvented».
 *
 * A ruling without a mechanism decays. PR #430 hand-rolled a `NativeSelect`
 * around a raw `<select>` while `src/ui/select.tsx` sat next to it, and every
 * form under `src/app/(platform)` carries hand-rolled `useState` field state
 * while `src/ui/form.tsx` (react-hook-form) is in the kit.
 *
 * Surface under test: the pure `checkPrimitivesFirst(files, opts)` seam over the
 * exact `{ filename, patch }` shape `gh api repos/{owner}/{repo}/pulls/<n>/files`
 * returns, and the thin `runPrimitivesFirstLint({ prNumber, gh })` driver with an
 * INJECTED gh runner — no live GitHub, no network.
 *
 * Ported from ds-platform `tools/lint/primitives-first-lint.ts`. The rule is the
 * same; the SCOPE is not — ds-platform sweeps its whole tree, this guard reads
 * one PR's DIFF, because the existing corpus here is full of violations and a
 * tree sweep would report a backlog nobody filed instead of a regression someone
 * just wrote (#435 «Out of scope»).
 */

/** One `gh api .../pulls/<n>/files` entry. */
function file(filename: string, addedLines: string[], startLine = 1) {
  const patch = [`@@ -0,0 +${startLine},${addedLines.length} @@`, ...addedLines.map((l) => `+${l}`)]
  return { filename, patch: patch.join('\n') }
}

/** Fake `gh` runner serving one PR's paged file list. */
function makeGh(prs: Record<number, ReturnType<typeof file>[]>) {
  const calls: string[][] = []
  return {
    calls,
    gh(args: string[]) {
      calls.push(args)
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
/** The whole kit is present in the worktree these fixtures describe. */
const KIT = Object.values(KIT_EQUIVALENTS)

describe('primitives-first-lint: a hand-rolled raw control is a finding (AC2 of #435)', () => {
  const result = checkPrimitivesFirst(
    [
      file(BOARD, [
        'export function StatusPicker({ value, onChange }: Props) {',
        '  return (',
        '    <select',
        '      value={value}',
        '      onChange={(event) => onChange(event.target.value)}',
        '      className="h-9 rounded-md border"',
        '    >',
        '      <option value="draft">draft</option>',
        '    </select>',
        '  )',
        '}',
      ]),
    ],
    { kitFiles: KIT },
  )

  it('flags the raw <select> and names the kit equivalent', () => {
    expect(result.verdict).toBe('violation')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].tag).toBe('select')
    expect(result.findings[0].message).toContain('src/ui/select.tsx')
  })

  it('reports the line the tag opens on in the NEW file, not the diff offset', () => {
    expect(result.findings[0].line).toBe(3)
  })

  it('flags a raw <button> too', () => {
    const r = checkPrimitivesFirst(
      [file(BOARD, ['<button type="submit" onClick={submit}>Отправить</button>'])],
      { kitFiles: KIT },
    )
    expect(r.findings.map((f) => f.tag)).toEqual(['button'])
  })

  it('flags each of the five raw tags the issue names', () => {
    for (const tag of ['button', 'table', 'select', 'input', 'form']) {
      const r = checkPrimitivesFirst([file(BOARD, [`<${tag} className="x" />`])], { kitFiles: KIT })
      expect(r.findings.map((f) => f.tag)).toEqual([tag])
    }
  })
})

describe('primitives-first-lint: the kit-based equivalent passes (AC2 of #435)', () => {
  it('does not flag a screen composed from `@/ui` components', () => {
    const result = checkPrimitivesFirst(
      [
        file(BOARD, [
          "import { Button } from '@/ui/button'",
          "import { Select, SelectTrigger, SelectValue } from '@/ui/select'",
          '',
          'export function StatusPicker({ value, onChange }: Props) {',
          '  return (',
          '    <Select value={value} onValueChange={onChange}>',
          '      <SelectTrigger><SelectValue /></SelectTrigger>',
          '    </Select>',
          '  )',
          '}',
        ]),
      ],
      { kitFiles: KIT },
    )
    expect(result.verdict).toBe('pass')
    expect(result.findings).toEqual([])
  })

  it('says on stdout what it scanned rather than exiting silently', () => {
    const result = checkPrimitivesFirst([file(BOARD, ['<Button>ok</Button>'])], { kitFiles: KIT })
    expect(result.message).toContain('1')
    expect(result.message.toLowerCase()).toContain('file')
  })
})

describe('primitives-first-lint: useState-driven form field state (AC2 of #435)', () => {
  const formDiff = [
    "  const [amount, setAmount] = useState('')",
    "  const [comment, setComment] = useState('')",
    '  return (',
    '    <form onSubmit={submit}>',
    '      <Input value={amount} onChange={(e) => setAmount(e.target.value)} />',
    '    </form>',
    '  )',
  ]

  it('flags the hand-rolled field state when the diff also adds a <form>', () => {
    const result = checkPrimitivesFirst([file(BOARD, formDiff)], { kitFiles: KIT })
    const rules = result.findings.map((f) => f.rule)
    expect(rules).toContain('form-state')
    expect(result.findings.find((f) => f.rule === 'form-state')?.message).toContain(
      'src/ui/form.tsx',
    )
  })

  it('leaves `useState` alone when the diff builds no form', () => {
    const result = checkPrimitivesFirst(
      [
        file(BOARD, [
          '  const [open, setOpen] = useState(false)',
          '  return <Sheet open={open} />',
        ]),
      ],
      { kitFiles: KIT },
    )
    expect(result.verdict).toBe('pass')
  })

  it('passes a form driven by the kit `useForm` rather than useState', () => {
    const result = checkPrimitivesFirst(
      [
        file(BOARD, [
          '  const form = useForm({ resolver: zodResolver(schema) })',
          '  return (',
          '    <Form {...form}>',
          '      <FormField name="amount" render={({ field }) => <Input {...field} />} />',
          '    </Form>',
          '  )',
        ]),
      ],
      { kitFiles: KIT },
    )
    expect(result.verdict).toBe('pass')
  })
})

describe('primitives-first-lint: scope is the PR diff under src/app/(platform)', () => {
  it('ignores a raw <select> outside the platform app', () => {
    const result = checkPrimitivesFirst([file('src/components/Legacy.tsx', ['<select />'])], {
      kitFiles: KIT,
    })
    expect(result.verdict).toBe('skip')
  })

  it('ignores the kit itself — `src/ui` IS the primitive layer', () => {
    const result = checkPrimitivesFirst([file('src/ui/select.tsx', ['<select />'])], {
      kitFiles: KIT,
    })
    expect(result.verdict).toBe('skip')
  })

  it('ignores tests under the platform app', () => {
    const result = checkPrimitivesFirst(
      [file('src/app/(platform)/p/finance/page.spec.tsx', ['<select />'])],
      { kitFiles: KIT },
    )
    expect(result.verdict).toBe('skip')
  })

  it('reads only ADDED lines — a raw control the PR merely touches around is not its finding', () => {
    const patch = [
      '@@ -10,3 +10,4 @@',
      ' <select id="status">',
      '+  <option value="new">new</option>',
      ' </select>',
    ].join('\n')
    const result = checkPrimitivesFirst([{ filename: BOARD, patch }], { kitFiles: KIT })
    expect(result.verdict).toBe('pass')
  })

  it('does not flag a tag that only exists in a comment', () => {
    const result = checkPrimitivesFirst(
      [file(BOARD, ['// before the kit we wrote <select className="h-9"> by hand', '<Button />'])],
      { kitFiles: KIT },
    )
    expect(result.verdict).toBe('pass')
  })

  it('says nothing when the kit has no equivalent for the tag', () => {
    const result = checkPrimitivesFirst([file(BOARD, ['<select />'])], {
      kitFiles: ['src/ui/button.tsx'],
    })
    expect(result.verdict).toBe('pass')
  })
})

describe('primitives-first-lint: the inline allow-list is the third rung of the ladder', () => {
  it('accepts a reasoned `primitives-first-ok:` marker on the tag line', () => {
    const result = checkPrimitivesFirst(
      [
        file(BOARD, [
          '{/* primitives-first-ok: a native file picker; the kit has no upload control */}',
          '<input type="file" onChange={upload} />',
        ]),
      ],
      { kitFiles: KIT },
    )
    expect(result.verdict).toBe('pass')
  })

  it('does NOT accept a bare marker with no reason', () => {
    const result = checkPrimitivesFirst(
      [file(BOARD, ['{/* primitives-first-ok: */}', '<input type="file" />'])],
      { kitFiles: KIT },
    )
    expect(result.verdict).toBe('violation')
  })

  it('does not let one marker silence a second, unrelated tag further down', () => {
    const result = checkPrimitivesFirst(
      [
        file(BOARD, [
          '{/* primitives-first-ok: native file picker, no kit equivalent */}',
          '<input type="file" />',
          '',
          '',
          '',
          '',
          '',
          '<select />',
        ]),
      ],
      { kitFiles: KIT },
    )
    expect(result.findings.map((f) => f.tag)).toEqual(['select'])
  })
})

describe('primitives-first-lint: severity dial and the unreadable-PR contract (AC5 of #435)', () => {
  const board = [file(BOARD, ['<select />'])]

  it('reports the same violation at exit 0 under WARN and exit 1 under BLOCK', () => {
    const gh = makeGh({ 500: board })
    const warn = runPrimitivesFirstLint({
      prNumber: 500,
      severity: 'warn',
      gh: gh.gh,
      kitFiles: KIT,
    })
    expect(warn.verdict).toBe('violation')
    expect(warn.exitCode).toBe(0)
    expect(warn.lines.join('\n')).toContain('WARN')

    const block = runPrimitivesFirstLint({
      prNumber: 500,
      severity: 'block',
      gh: gh.gh,
      kitFiles: KIT,
    })
    expect(block.verdict).toBe('violation')
    expect(block.exitCode).toBe(1)
  })

  it('exits non-zero under EVERY severity when the PR cannot be read', () => {
    const gh = makeGh({})
    for (const severity of ['warn', 'block'] as const) {
      const run = runPrimitivesFirstLint({ prNumber: 404, severity, gh: gh.gh, kitFiles: KIT })
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
    expect(severityFromArgv([], { PRIMITIVES_FIRST_SEVERITY: 'block' })).toBe('block')
  })
})
