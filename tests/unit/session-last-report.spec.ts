import { describe, expect, it } from 'vitest'

import {
  AGENT_LOG_MARKERS,
  USAGE,
  assistantTexts,
  discoverLogs,
  findReport,
  isSessionLog,
  lastTimestamp,
  main,
  parseArgs,
  parseEntries,
  selectReport,
} from '../../tools/session/last-report.mjs'

/**
 * `pnpm session:last-report`. Three properties are load-bearing:
 *   * MULTI-SLUG discovery — a worktree re-slug hides half a session under
 *     `…--claude-worktrees-<N>`;
 *   * the agent-log exclusion is a POSITIVE test (marker present → skip), not
 *     the inverted `grep -v` form that excludes nothing;
 *   * NEWEST-with-a-report wins, and the output is UTF-8 bytes.
 * Every filesystem call is an injectable seam, so nothing here touches disk.
 */

const PROJECTS = '/home/u/.claude/projects'

type Dirent = { name: string; isDirectory: () => boolean; isFile: () => boolean }

const dir = (name: string): Dirent => ({
  name,
  isDirectory: () => true,
  isFile: () => false,
})
const file = (name: string): Dirent => ({
  name,
  isDirectory: () => false,
  isFile: () => true,
})

function readdirStub(tree: Record<string, Dirent[]>) {
  return (path: string) => {
    const entries = tree[path.replace(/\\/g, '/')]
    if (!entries) throw new Error(`ENOENT ${path}`)
    return entries
  }
}

const line = (obj: unknown) => JSON.stringify(obj)

const userTurn = (ts: string) => line({ type: 'user', timestamp: ts, message: { content: 'go' } })

const assistantTurn = (ts: string, text: string) =>
  line({
    type: 'assistant',
    timestamp: ts,
    message: { content: [{ type: 'text', text }] },
  })

const REPORT = [
  'Готово: гард добавлен.',
  '',
  'Проверить глазами: https://example.test/p/hours',
  'Отклонения от конвенций: нет',
].join('\n')

const sessionLog = (ts: string, text = REPORT) =>
  [userTurn(ts), assistantTurn(ts, 'работаю'), assistantTurn(ts, text)].join('\n')

describe('parseArgs', () => {
  it('accepts --session and strips a .jsonl suffix', () => {
    expect(parseArgs(['--session', 'abc-123.jsonl'])).toMatchObject({
      session: 'abc-123',
      errors: [],
    })
  })

  it('reports --session without a value instead of consuming the next flag', () => {
    expect(parseArgs(['--session', '--help']).errors).toHaveLength(1)
  })

  it('reports unknown arguments', () => {
    expect(parseArgs(['--nope']).errors).toEqual(['unknown argument: --nope'])
  })
})

describe('discoverLogs', () => {
  it('collects logs from EVERY bbm-portal slug, worktree re-slugs included', () => {
    const main_ = `${PROJECTS}/C--Users-sidor-repos-bbm-portal`
    const wt = `${PROJECTS}/C--Users-sidor-repos-bbm-portal--claude-worktrees-42`
    const files = discoverLogs(PROJECTS, {
      readdirSync: readdirStub({
        [PROJECTS]: [
          dir('C--Users-sidor-repos-bbm-portal'),
          dir('C--Users-sidor-repos-bbm-portal--claude-worktrees-42'),
          dir('C--Users-sidor-repos-other-project'),
        ],
        [main_]: [file('a.jsonl'), file('notes.txt')],
        [wt]: [file('b.jsonl')],
      }),
    }).map((p: string) => p.replace(/\\/g, '/'))

    expect(files).toEqual([`${main_}/a.jsonl`, `${wt}/b.jsonl`])
  })

  it('returns [] when the projects dir does not exist', () => {
    expect(discoverLogs(PROJECTS, { readdirSync: readdirStub({}) })).toEqual([])
  })
})

describe('isSessionLog', () => {
  it.each(AGENT_LOG_MARKERS)('excludes a log carrying %s', (marker) => {
    expect(isSessionLog(`${userTurn('2026-08-25T10:00:00Z')}\n{${marker}}`)).toBe(false)
  })

  it('excludes the marker even when most lines lack it (positive test, not grep -v)', () => {
    const log = [
      userTurn('2026-08-25T10:00:00Z'),
      assistantTurn('2026-08-25T10:00:01Z', 'x'),
      '{"promptSource":"sdk"}',
    ].join('\n')
    expect(isSessionLog(log)).toBe(false)
  })

  it('keeps a log with human turns and no agent marker', () => {
    expect(isSessionLog(sessionLog('2026-08-25T10:00:00Z'))).toBe(true)
  })

  it('excludes a log with no human turns at all', () => {
    expect(isSessionLog(assistantTurn('2026-08-25T10:00:00Z', 'x'))).toBe(false)
  })
})

describe('parsing', () => {
  it('skips a truncated trailing line rather than throwing', () => {
    const entries = parseEntries(`${userTurn('2026-08-25T10:00:00Z')}\n{"type":"assi`)
    expect(entries).toHaveLength(1)
  })

  it('reads the last usable timestamp', () => {
    const entries = parseEntries(
      [userTurn('2026-08-25T10:00:00Z'), assistantTurn('2026-08-25T12:00:00Z', 'x')].join('\n'),
    )
    expect(lastTimestamp(entries)).toBe(Date.parse('2026-08-25T12:00:00Z'))
    expect(lastTimestamp([])).toBe(0)
  })

  it('extracts assistant text from both content shapes', () => {
    const entries = parseEntries(
      [
        line({ type: 'assistant', message: { content: 'plain' } }),
        assistantTurn('2026-08-25T10:00:00Z', 'blocks'),
        line({ type: 'user', message: { content: 'ignored' } }),
      ].join('\n'),
    )
    expect(assistantTexts(entries)).toEqual(['plain', 'blocks'])
  })
})

describe('findReport', () => {
  it('prefers a message carrying BOTH marker lines', () => {
    expect(findReport(['Проверить глазами: url', REPORT])).toBe(REPORT)
  })

  it('falls back to a single-marker message', () => {
    expect(findReport(['ничего', 'Отклонения от конвенций: нет'])).toBe(
      'Отклонения от конвенций: нет',
    )
  })

  it('returns null when no assistant message is a report', () => {
    expect(findReport(['раз', 'два'])).toBeNull()
  })
})

describe('selectReport', () => {
  const files = ['/logs/old.jsonl', '/logs/new.jsonl', '/logs/agent.jsonl']
  const contents: Record<string, string> = {
    '/logs/old.jsonl': sessionLog('2026-08-24T10:00:00Z', `старый\n${REPORT}`),
    '/logs/new.jsonl': sessionLog('2026-08-25T10:00:00Z', `свежий\n${REPORT}`),
    '/logs/agent.jsonl': `{"promptSource":"sdk"}\n${sessionLog('2026-08-26T10:00:00Z')}`,
  }
  const deps = {
    readFileSync: (p: string) => contents[p],
    statSync: () => ({ mtimeMs: 0 }),
  }

  it('picks the newest session log that actually has a report', () => {
    const hit = selectReport(files, deps)
    expect(hit?.file).toBe('/logs/new.jsonl')
    expect(hit?.report).toContain('свежий')
  })

  it('never picks a dispatched-agent log, however new it is', () => {
    expect(selectReport(['/logs/agent.jsonl'], deps)).toBeNull()
  })

  it('picks by the in-log last timestamp, not by the order files arrive in', () => {
    // The newest log listed FIRST: an implementation that stopped at the first
    // hit in list order would still be right here only by accident, so the
    // assertion is that the reversed order gives the same answer.
    const hit = selectReport(['/logs/new.jsonl', '/logs/old.jsonl'], deps)
    expect(hit?.file).toBe('/logs/new.jsonl')
    expect(selectReport(['/logs/old.jsonl', '/logs/new.jsonl'], deps)?.file).toBe('/logs/new.jsonl')
  })

  it('skips an unreadable file instead of throwing', () => {
    const hit = selectReport(['/logs/gone.jsonl', '/logs/new.jsonl'], {
      ...deps,
      readFileSync: (p: string) => {
        if (p === '/logs/gone.jsonl') throw new Error('EACCES')
        return contents[p]
      },
    })
    expect(hit?.file).toBe('/logs/new.jsonl')
  })
})

describe('main', () => {
  const sink = () => {
    const chunks: Buffer[] = []
    return {
      write: (b: Buffer) => chunks.push(b),
      text: () => Buffer.concat(chunks).toString('utf8'),
    }
  }

  it('--help prints usage and exits 0 without touching the filesystem', () => {
    const out = sink()
    const code = main(['--help'], {
      stdout: out,
      stderr: sink(),
      discoverLogs: () => {
        throw new Error('must not scan on --help')
      },
    })
    expect(code).toBe(0)
    expect(out.text()).toBe(USAGE)
  })

  it('prints the report as UTF-8 bytes with a provenance header', () => {
    const out = sink()
    const code = main([], {
      stdout: out,
      stderr: sink(),
      discoverLogs: () => ['/logs/new.jsonl'],
      readFileSync: () => sessionLog('2026-08-25T10:00:00Z'),
      statSync: () => ({ mtimeMs: 0 }),
    })
    expect(code).toBe(0)
    const text = out.text()
    expect(text).toContain('/logs/new.jsonl')
    expect(text).toContain('Проверить глазами:')
    expect(text).not.toContain('�')
  })

  it('exits 1 with a diagnostic when nothing carries a report', () => {
    const err = sink()
    const code = main([], {
      stdout: sink(),
      stderr: err,
      discoverLogs: () => ['/logs/plain.jsonl'],
      readFileSync: () => sessionLog('2026-08-25T10:00:00Z', 'нет отчёта'),
      statSync: () => ({ mtimeMs: 0 }),
    })
    expect(code).toBe(1)
    expect(err.text()).toContain('no stage-6 report found')
  })

  it('exits 1 when --session names an unknown log', () => {
    const err = sink()
    const code = main(['--session', 'nope'], {
      stdout: sink(),
      stderr: err,
      discoverLogs: () => ['/logs/new.jsonl'],
    })
    expect(code).toBe(1)
    expect(err.text()).toContain('no log found for session nope')
  })

  it('--session matches the basename exactly, not by suffix', () => {
    const err = sink()
    const code = main(['--session', '123'], {
      stdout: sink(),
      stderr: err,
      // `abc-123.jsonl` ENDS WITH `123.jsonl` — a suffix test would pick it up.
      discoverLogs: () => ['/logs/abc-123.jsonl'],
    })
    expect(code).toBe(1)
    expect(err.text()).toContain('no log found for session 123')
  })

  it('--session picks the log whose basename equals the id, in any slug dir', () => {
    const out = sink()
    const code = main(['--session', 'abc-123'], {
      stdout: out,
      stderr: sink(),
      discoverLogs: () => ['/logs/worktrees-7/abc-123.jsonl', '/logs/other.jsonl'],
      readFileSync: () => sessionLog('2026-08-25T10:00:00Z'),
    })
    expect(code).toBe(0)
    expect(out.text()).toContain('abc-123.jsonl')
  })

  it('exits 1 with a diagnostic when no bbm-portal log was discovered at all', () => {
    const err = sink()
    const code = main([], { stdout: sink(), stderr: err, discoverLogs: () => [] })
    expect(code).toBe(1)
    expect(err.text()).toContain('no bbm-portal session logs')
  })

  it('exits 2 on a bad argument', () => {
    expect(main(['--wat'], { stdout: sink(), stderr: sink() })).toBe(2)
  })
})
