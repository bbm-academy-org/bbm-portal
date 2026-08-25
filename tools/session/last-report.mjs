#!/usr/bin/env node
// bbm-portal — `pnpm session:last-report`: print the previous session's stage-6
// report instead of digging it out of the raw logs by hand.
//
// Why it exists: three consecutive sessions each burnt ~12 lead tool calls
// reconstructing «отчёт последней сессии» from `~/.claude/projects/**/*.jsonl`
// — globbing slugs, filtering agent logs, hand-decoding UTF-8. The dig is
// mechanical, so it is a script. (The *cure* is the wrap pasting the report as
// an issue comment so it has a URL — `.claude/skills/wrap/SKILL.md` phase 5;
// this tool is the fallback for every session that predates that habit.)
//
// What it does:
//   1. scans `~/.claude/projects/*bbm-portal*/*.jsonl` — EVERY slug, because a
//      session that enters a worktree re-slugs mid-flight and its tail lives in
//      `…--claude-worktrees-<N>`;
//   2. drops dispatched-agent / SDK logs with a POSITIVE test
//      (`"promptSource":"sdk"` / `"isSidechain":true` present → skip). The
//      inverted `grep -v` form is a no-op on multi-line logs and excludes
//      nothing — measured in `.claude/skills/wrap/SKILL.md` phase 0;
//   3. among the survivors takes the NEWEST by last timestamp whose trailing
//      assistant messages carry a stage-6 report, recognised by the two marker
//      lines the Stop gates read («Проверить глазами:», «Отклонения от
//      конвенций:» — `.claude/skills/report-task-outcome/SKILL.md`);
//   4. prints that message verbatim as UTF-8 (the encoding is set explicitly —
//      the default Windows console codepage turned past digs into mojibake).
//
// Flags: `--session <id>` pins one session (basename of the `.jsonl`, any
// slug); `--help` prints usage and exits 0 without touching the filesystem.
//
// Pure seams are exported and unit-tested in
// `tests/unit/session-last-report.spec.ts`; the entry-point guard keeps the
// import side-effect free.

import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Marker lines of the stage-6 report shape. One is enough to recognise it. */
export const REPORT_MARKERS = ['Проверить глазами:', 'Отклонения от конвенций:']

/**
 * Substrings that mark a log as a dispatched-agent / SDK log, not a session.
 * `"promptSource":"sdk"` is the one that actually fires here;
 * `"isSidechain":true` is SPECULATIVE future-proofing — it appears on 0 of the
 * 280 logs on this box, exactly as `.claude/skills/wrap/SKILL.md` phase 0
 * records. Do not read a passing exclusion as evidence that it matched.
 */
export const AGENT_LOG_MARKERS = ['"promptSource":"sdk"', '"isSidechain":true']

/** How many trailing assistant messages are searched for the report block. */
export const TAIL_MESSAGES = 40

export const USAGE = `pnpm session:last-report [--session <id>]

Prints the newest bbm-portal session's stage-6 final report, read from the
Claude Code session logs under ~/.claude/projects/*bbm-portal*/.

  --session <id>   pin one session by the basename of its .jsonl (any slug)
  --help           show this message
`

// ── argv ────────────────────────────────────────────────────────────────────

/** Parse argv into `{help, session}`; unknown flags are reported, not thrown. */
export function parseArgs(argv) {
  const out = { help: false, session: null, errors: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--session') {
      const value = argv[i + 1]
      if (!value || value.startsWith('-')) out.errors.push('--session needs an id')
      else {
        out.session = value.replace(/\.jsonl$/, '')
        i += 1
      }
    } else out.errors.push(`unknown argument: ${arg}`)
  }
  return out
}

// ── log discovery ───────────────────────────────────────────────────────────

/**
 * Every `*.jsonl` under every `~/.claude/projects/*bbm-portal*` directory.
 * Multi-slug on purpose: a worktree re-slug puts one session's segments in two
 * dirs, and globbing only the main slug drops exactly the part with the work.
 */
export function discoverLogs(projectsDir, deps = {}) {
  const list = deps.readdirSync ?? readdirSync
  let slugs
  try {
    slugs = list(projectsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const slug of slugs) {
    if (!slug.isDirectory() || !slug.name.includes('bbm-portal')) continue
    const dir = join(projectsDir, slug.name)
    let entries
    try {
      entries = list(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(join(dir, entry.name))
    }
  }
  return files
}

/**
 * A session log, not a dispatched-agent one. POSITIVE test: the agent markers
 * being PRESENT is what excludes. It must also carry human-shaped turns.
 */
export function isSessionLog(text) {
  if (AGENT_LOG_MARKERS.some((marker) => text.includes(marker))) return false
  return text.includes('"type":"user"')
}

// ── log parsing ─────────────────────────────────────────────────────────────

/** JSONL → entries, skipping unparseable lines (a live log may end mid-write). */
export function parseEntries(text) {
  const entries = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed))
    } catch {
      /* partial or corrupt line — the rest of the log is still usable */
    }
  }
  return entries
}

/** Last timestamp in the log, as epoch ms; 0 when the log carries none. */
export function lastTimestamp(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const ts = Date.parse(entries[i]?.timestamp ?? '')
    if (!Number.isNaN(ts)) return ts
  }
  return 0
}

/** Plain-text bodies of the assistant turns, in order. */
export function assistantTexts(entries) {
  const out = []
  for (const entry of entries) {
    if (entry?.type !== 'assistant') continue
    const content = entry?.message?.content
    if (typeof content === 'string') {
      out.push(content)
      continue
    }
    if (!Array.isArray(content)) continue
    const text = content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    if (text.trim()) out.push(text)
  }
  return out
}

/**
 * The stage-6 report among the trailing assistant messages: the LAST one
 * carrying a marker line, preferring a message that carries both.
 */
export function findReport(texts) {
  const tail = texts.slice(-TAIL_MESSAGES)
  let single = null
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const text = tail[i]
    const hits = REPORT_MARKERS.filter((marker) => text.includes(marker))
    if (hits.length === REPORT_MARKERS.length) return text
    if (hits.length > 0 && single === null) single = text
  }
  return single
}

// ── selection ───────────────────────────────────────────────────────────────

/**
 * Newest session log (by last timestamp) that actually contains a report.
 * Returns `{file, report, at}` or `null`. It reads EVERY survivor and picks by
 * the log's own last timestamp — there is no early exit, and no mtime
 * pre-ordering: file mtime and the last in-log timestamp disagree often enough
 * (a re-slugged worktree segment, a log touched by a tool) that ordering by
 * mtime and stopping at the first hit would return the wrong session. ~2 s over
 * the whole corpus (280 logs / 291 MB measured), which is the price of being
 * right.
 */
export function selectReport(files, deps = {}) {
  const read = deps.readFileSync ?? readFileSync
  const candidates = []
  for (const file of files) {
    let text
    try {
      text = read(file, 'utf8')
    } catch {
      continue
    }
    if (!isSessionLog(text)) continue
    const entries = parseEntries(text)
    const report = findReport(assistantTexts(entries))
    if (!report) continue
    candidates.push({ file, report, at: lastTimestamp(entries) })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.at - a.at)
  return candidates[0]
}

/** Rendered output for a hit: a provenance header, then the report verbatim. */
export function render(hit) {
  const when = hit.at ? new Date(hit.at).toISOString() : 'unknown time'
  return `# last session report\n# ${hit.file}\n# last activity: ${when}\n\n${hit.report}\n`
}

// ── entry point ─────────────────────────────────────────────────────────────

/** Explicit UTF-8: the default console codepage on this box mangles Cyrillic. */
function write(stream, text) {
  stream.write(Buffer.from(text, 'utf8'))
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout ?? process.stdout
  const err = deps.stderr ?? process.stderr
  const args = parseArgs(argv)

  if (args.errors.length > 0) {
    write(err, `${args.errors.join('\n')}\n\n${USAGE}`)
    return 2
  }
  if (args.help) {
    write(out, USAGE)
    return 0
  }

  const projectsDir = deps.projectsDir ?? join(homedir(), '.claude', 'projects')
  let files = (deps.discoverLogs ?? discoverLogs)(projectsDir, deps)
  if (args.session) {
    // Basename EQUALITY, not a suffix test: `--session 123` must not also match
    // `abc-123.jsonl`. The id is the basename of the `.jsonl`, in any slug dir.
    files = files.filter((file) => basename(file) === `${args.session}.jsonl`)
    if (files.length === 0) {
      write(err, `no log found for session ${args.session} under ${projectsDir}\n`)
      return 1
    }
  }
  if (files.length === 0) {
    write(err, `no bbm-portal session logs under ${projectsDir}\n`)
    return 1
  }

  const hit = selectReport(files, deps)
  if (!hit) {
    write(
      err,
      `no stage-6 report found (looked for ${REPORT_MARKERS.map((m) => `«${m}»`).join(' / ')} in ${files.length} log(s))\n`,
    )
    return 1
  }
  write(out, render(hit))
  return 0
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) process.exitCode = main()
