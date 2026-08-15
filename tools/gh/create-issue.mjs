#!/usr/bin/env node
// bbm-portal — `pnpm issue:create`: the only path for creating an issue (#130).
//
// Why a wrapper instead of `gh issue create`:
//   • raw `gh issue create` accepts any set of fields, so malformed work reaches
//     the backlog before anyone notices. Validation here fails closed BEFORE the
//     first gh call: a taxonomy violation means no issue was created at all,
//     instead of creating one and repairing it afterwards;
//   • the board's «Item added → Todo» automation is delayed, so the item is added
//     explicitly, Todo is set explicitly, and a direct GraphQL node-id read
//     confirms the item (`item-list` has read lag for newly added rows).
//
// Canon: `.claude/skills/task-canon/SKILL.md` §2 + §7.
//
// Issue classification uses GitHub's NATIVE **Type** field (Bug/Feature/Task),
// per the owner's 2026-08-04 ruling: do not invent replacements for existing
// fields.
//
// Issue provenance has TWO dimensions that are easy to confuse (same owner
// ruling from 2026-08-04):
//   • `--channel` — HOW the issue entered the backlog, who put it in the tracker.
//     A closed list of four values stored as a `channel:*` label. It maintains order;
//   • `--source`  — WHAT WARRANTS the issue's existence. FREE text stored as the
//     first body line. This cannot be an enum: «bug report in Mattermost»,
//     «executive decision by the partners», «found while working on #124»,
//     «the application changed», «the mission changed» — the space is open, and
//     a closed list would collapse into «99% owner», which conveys nothing.
//
// Usage (a thin passthrough: after this wrapper consumes its control flags,
// everything else reaches `gh issue create` verbatim; its flags are not reinvented):
//   pnpm issue:create --title "<t>" --body-file <f> --type Task \
//     --channel agent --source "found while working on #130" \
//     --milestone "Platform: operations and hardening"
//   pnpm issue:create --no-todo --title …    # add to the board without touching Status
//
// Control flags (consumed here and NOT passed to gh): `--no-todo`, `--channel`,
// `--source`, `--body`/`--body-file` (the body is rebuilt).
//
// Exit codes: 0 = the issue was created, added to the board and confirmed;
// 1 = validation / gh / confirmation error.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CHANNEL_LABELS,
  FALLBACK_MILESTONE,
  ISSUE_TYPES,
  OWNER,
  PROJECT_NUMBER,
  PROJECT_TITLE,
  REPO,
  buildNodeQuery,
  buildStatusMutation,
  ghGraphqlResult,
  ghJson,
  ghResult,
  parseNodeReadback,
  resolveBoardStatusTarget,
} from './lib/gh.mjs'

const TAG = '[issue:create]'

// ── pure seams (unit-tested in tests/unit/gh-create-issue.spec.ts) ───────────

/**
 * Split argv into this wrapper's control flags and the passthrough to gh.
 * @returns {{ setTodo: boolean, passthrough: string[] }}
 */
export function partitionArgs(argv) {
  const passthrough = []
  let setTodo = true
  for (const a of argv ?? []) {
    if (a === '--no-todo') {
      setTodo = false
      continue
    }
    passthrough.push(a)
  }
  return { setTodo, passthrough }
}

/**
 * Read a flag value in every form accepted by gh: `--flag V`, `--flag=V`,
 * `-f V`, `-fV`. Returns EVERY value in order: a repeated flag is a signal too
 * (gh honours the last one, while the wrapper needs to notice the repetition).
 * @param {string[]|null|undefined} args
 * @param {string} longName
 * @param {string|null} [shortName]
 * @returns {string[]}
 */
export function flagValues(args, longName, shortName = null) {
  const values = []
  const list = args ?? []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (a === `--${longName}`) {
      values.push(list[i + 1] ?? '')
    } else if (a.startsWith(`--${longName}=`)) {
      values.push(a.slice(longName.length + 3))
    } else if (shortName && a === `-${shortName}`) {
      values.push(list[i + 1] ?? '')
    } else if (shortName && a.length > 2 && a.startsWith(`-${shortName}`) && !a.startsWith('--')) {
      values.push(a.slice(2))
    }
  }
  return values
}

/** Every `--label` / `-l` value, including comma-separated lists. */
export function collectLabels(args) {
  const out = []
  for (const raw of flagValues(args, 'label', 'l')) {
    for (const part of String(raw).split(',')) {
      const label = part.trim()
      if (label) out.push(label)
    }
  }
  return out
}

/** Whether passthrough carries `--repo`/`-R`; the board is repo-bound, so overrides are forbidden. */
export function hasRepoOverride(args) {
  return (args ?? []).some(
    (a) => a === '--repo' || a.startsWith('--repo=') || a === '-R' || a.startsWith('-R'),
  )
}

/** Short channel values: `--channel owner` == `--channel channel:owner`. */
export function normalizeChannel(value) {
  const v = String(value ?? '').trim()
  if (v === '') return ''
  return v.startsWith('channel:') ? v : `channel:${v}`
}

/**
 * Exactly one `channel:*` identifies how the issue entered the backlog. Accept
 * both `--channel owner` and `--label channel:owner`: callers use the wrapper
 * manually and from the skill, and the two representations must not diverge.
 */
export function channelError(args) {
  const taxonomy = CHANNEL_LABELS.join(' | ')
  const short = CHANNEL_LABELS.map((l) => l.slice('channel:'.length)).join('|')
  const found = [
    ...flagValues(args, 'channel').map(normalizeChannel),
    ...collectLabels(args).filter((l) => l.startsWith('channel:')),
  ].filter((v) => v !== '')
  const unique = [...new Set(found)]
  if (unique.length === 0) {
    return (
      `every issue has exactly one backlog-entry channel — pass --channel <${short}>. ` +
      `This is NOT provenance (that is free text in --source); it is who put the issue in the tracker.`
    )
  }
  if (unique.length > 1) {
    return `exactly ONE channel is allowed; received: ${unique.join(', ')} (taxonomy: ${taxonomy}).`
  }
  if (!CHANNEL_LABELS.includes(unique[0])) {
    return `unknown channel «${unique[0]}» — it must be one of: ${taxonomy}.`
  }
  return null
}

/** The single channel in argv (after validation). */
export function resolveChannel(args) {
  const found = [
    ...flagValues(args, 'channel').map(normalizeChannel),
    ...collectLabels(args).filter((l) => l.startsWith('channel:')),
  ].filter((v) => v !== '')
  return found[0] ?? null
}

/**
 * Required provenance is FREE text (owner ruling, 2026-08-04). It cannot be an
 * enum: «X's bug report in Mattermost», «the partners' executive decision from
 * 2026-07-30», «found while working on #124», «Payload 3.86 dependency update» —
 * the source space is open, and this context is the first thing an enum loses.
 */
export function sourceTextError(args) {
  const found = flagValues(args, 'source').map((v) => String(v).trim())
  if (found.length === 0 || found.every((v) => v === '')) {
    return (
      `every issue needs provenance — pass --source "<what warrants it>". ` +
      `Use free text, for example: «Anton's bug report in Mattermost, 2026-08-04», ` +
      `«executive decision by the partners», «found while working on #124», «2026-08-01 session retro».`
    )
  }
  if (found.length > 1) return `exactly ONE --source is allowed; received ${found.length}.`
  return null
}

/**
 * Tooling builds the `**Source:**` line instead of accepting one in the body;
 * otherwise two copies could exist and drift apart.
 */
export function sourceLineError(bodyText) {
  if (!/^\s*\*\*Source:\*\*/im.test(String(bodyText ?? ''))) return null
  return (
    'the body already contains a **Source:** line — do not write it manually; provenance is ' +
    'provided through --source and the wrapper adds the line first.'
  )
}

/** Final body: the Source line first, followed by the caller's text. */
export function composeBody(sourceText, bodyText) {
  return `**Source:** ${String(sourceText).trim()}\n\n${String(bodyText ?? '').trim()}\n`
}

/**
 * Remove body flags and this wrapper's own flags from passthrough. The rebuilt
 * body reaches gh through a temporary file to avoid the Windows command-line
 * length limit, while gh knows nothing about `--channel`/`--source`.
 */
export function stripConsumedFlags(args) {
  const out = []
  const list = args ?? []
  const withValue = new Set(['--body', '-b', '--body-file', '-F', '--channel', '--source'])
  const prefixes = ['--body=', '--body-file=', '--channel=', '--source=']
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (withValue.has(a)) {
      i++ // consume the value
      continue
    }
    if (prefixes.some((p) => a.startsWith(p))) continue
    if (a.length > 2 && !a.startsWith('--') && (a.startsWith('-b') || a.startsWith('-F'))) continue
    out.push(a)
  }
  return out
}

/**
 * This repo has no `kind:*` labels: issue class lives in the native Type field
 * (owner ruling, 2026-08-04). An explicit error beats a silent skip; otherwise
 * habits carried over from ds-platform would create a second classification.
 */
export function kindLabelError(args) {
  const kinds = collectLabels(args).filter((l) => l.startsWith('kind:'))
  if (kinds.length > 0) {
    return (
      `kind:* labels were retired in this repo (${kinds.join(', ')}) — issue class is set through ` +
      `the native Type field: --type ${ISSUE_TYPES.join('|')}.`
    )
  }
  const sources = collectLabels(args).filter((l) => l.startsWith('source:'))
  if (sources.length > 0) {
    return (
      `source:* labels were retired (${sources.join(', ')}): provenance is free text in --source, ` +
      `and backlog-entry channel is --channel <owner|spec|retro|agent>.`
    )
  }
  return null
}

/** Exactly one valid `--type`. */
export function typeError(args) {
  const taxonomy = ISSUE_TYPES.join(' | ')
  const found = flagValues(args, 'type').map((v) => String(v).trim())
  if (found.length === 0) {
    return `every issue has exactly one native type — pass --type <type>, one of: ${taxonomy}.`
  }
  if (found.length > 1) {
    return `exactly ONE --type is allowed; received: ${found.join(', ')}.`
  }
  if (!ISSUE_TYPES.includes(found[0])) {
    return `unknown type «${found[0]}» — it must be one of: ${taxonomy} (org Issue Types).`
  }
  return null
}

/** A non-empty `--milestone`. */
export function milestoneError(args) {
  const found = flagValues(args, 'milestone', 'm')
    .map((v) => String(v).trim())
    .filter((v) => v !== '')
  if (found.length === 0) {
    return (
      `every issue needs a milestone — pass --milestone <theme>; the permanent fallback for ` +
      `process and operations work is «${FALLBACK_MILESTONE}».`
    )
  }
  return null
}

/**
 * A non-empty body. `--body-file` requires a file read, so the reader is
 * injected and tests can drive the gate without a filesystem.
 */
export function bodyError(args, readFile = (p) => readFileSync(p, 'utf8')) {
  const inline = flagValues(args, 'body', 'b')
  const files = flagValues(args, 'body-file', 'F')
  if (inline.length === 0 && files.length === 0) {
    return 'an issue needs a body — pass --body "<text>" or --body-file <file> (skeleton: .claude/skills/task-canon/SKILL.md §1).'
  }
  for (const value of inline) {
    if (String(value).trim() === '')
      return 'the issue body is empty (--body) — a task statement cannot be empty.'
  }
  for (const file of files) {
    let content
    try {
      content = readFile(String(file))
    } catch (e) {
      return `could not read body file «${file}»: ${e?.message ?? e}`
    }
    if (String(content).trim() === '') {
      return `body file «${file}» is empty — a task statement cannot be empty.`
    }
  }
  return null
}

/** Assemble the body text from passthrough (for non-fatal skeleton checks). */
export function readBodyText(args, readFile = (p) => readFileSync(p, 'utf8')) {
  const parts = []
  for (const value of flagValues(args, 'body', 'b')) parts.push(String(value))
  for (const file of flagValues(args, 'body-file', 'F')) {
    try {
      parts.push(String(readFile(String(file))))
    } catch {
      /* bodyError reports this */
    }
  }
  return parts.join('\n')
}

/**
 * Canon §1 sections. Parsing tolerates heading depth: `pnpm issue:create`
 * writes `##`, while GitHub issue forms render fields as `###`. Both forms are
 * canonical, and the task parser must read both.
 */
export const CANON_SECTIONS = ['Context', 'Scope', 'Spec reference', 'Acceptance criteria', 'Notes']

export function hasSection(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^#{2,4}\\s*${escaped}\\s*$`, 'im').test(body ?? '')
}

export function hasSourceLine(body) {
  return /^\s*\*\*Source:\*\*/im.test(body ?? '') || hasSection(body, 'Source')
}

/**
 * Non-fatal remarks about the body skeleton. This is NOT a gate: canon §7 names
 * exactly four fail-closed conditions, and a fifth invented by tooling would
 * tighten the canon without the owner. An epic does not require
 * `Acceptance criteria`; its criterion is that all children are closed (§1).
 */
export function skeletonWarnings(body, labels = []) {
  const warnings = []
  const isEpic = (labels ?? []).includes('epic')
  if (!hasSourceLine(body)) warnings.push('missing **Source:** line (canon §1)')
  for (const section of CANON_SECTIONS) {
    if (section === 'Notes') continue
    if (section === 'Acceptance criteria' && isEpic) continue
    if (!hasSection(body, section)) warnings.push(`missing «${section}» section (canon §1)`)
  }
  return warnings
}

/**
 * Collapse repeated `--label` values: the channel arrives both as a `--channel`
 * flag and as a label, so the same `channel:*` would otherwise reach gh twice.
 * Preserve first-occurrence order and leave every other flag untouched.
 */
export function dedupeLabelFlags(args) {
  const out = []
  const seen = new Set()
  const list = args ?? []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    let raw = null
    let skipNext = false
    if (a === '--label' || a === '-l') {
      raw = list[i + 1]
      skipNext = true
    } else if (a.startsWith('--label=')) {
      raw = a.slice('--label='.length)
    } else {
      out.push(a)
      continue
    }
    if (skipNext) i++
    for (const part of String(raw ?? '').split(',')) {
      const label = part.trim()
      if (label === '' || seen.has(label)) continue
      seen.add(label)
      out.push('--label', label)
    }
  }
  return out
}

/** Whether `--assignee`/`-a` is already present. */
export function hasAssignee(args) {
  return flagValues(args, 'assignee', 'a').length > 0
}

/** Add `--assignee @me` when none is explicit. Never overwrite an explicit value. */
export function ensureAssigneeFlag(args) {
  const list = [...(args ?? [])]
  if (hasAssignee(list)) return list
  return [...list, '--assignee', '@me']
}

/**
 * Every gate in order. Report the first error only: listing five violations at
 * once does not help because callers still repair them one at a time.
 */
export function validationError(args, readFile) {
  if (hasRepoOverride(args)) {
    return (
      `--repo/-R is forbidden: the wrapper is pinned to ${REPO} because Project ` +
      `${PROJECT_NUMBER} is bound to that repo. Remove the flag.`
    )
  }
  return (
    channelError(args) ??
    sourceTextError(args) ??
    kindLabelError(args) ??
    typeError(args) ??
    milestoneError(args) ??
    bodyError(args, readFile) ??
    sourceLineError(readBodyText(args, readFile)) ??
    null
  )
}

/**
 * Add a hint to a `gh issue create` error when a taxonomy label is missing. The
 * wrapper is the only issue-creation path, but `channel:*` labels do not exist
 * before `taxonomy:bootstrap --apply`; without the hint the very first attempt
 * stops at an opaque «could not add label».
 * @param {string} stderr
 * @param {string[]} labels labels sent to gh
 * @returns {string}
 */
export function enrichCreateError(stderr, labels) {
  const text = String(stderr ?? '')
  if (!/label/i.test(text)) return text
  const channels = (labels ?? []).filter((l) => String(l).startsWith('channel:'))
  if (channels.length === 0) return text
  return (
    `${text}\n  It looks like ${channels.join(', ')} does not exist in the repo yet. Bootstrap the ` +
    `taxonomy once: pnpm taxonomy:bootstrap (dry run) → pnpm taxonomy:bootstrap --apply`
  )
}

/** Created issue URL from `gh issue create` stdout. */
export function extractIssueUrl(stdout) {
  const m = (stdout ?? '').match(/https?:\/\/\S*\/issues\/(\d+)\b/)
  return m ? m[0] : null
}

/** Issue number from its URL. */
export function issueNumberFromUrl(url) {
  const m = (url ?? '').match(/\/issues\/(\d+)\b/)
  return m ? Number(m[1]) : null
}

// ── imperative part ─────────────────────────────────────────────────────────

function out(msg) {
  process.stdout.write(`${TAG} ${msg}\n`)
}

function die(msg) {
  process.stderr.write(`${TAG} ${msg}\n`)
  process.exit(1)
}

export const USAGE =
  `Usage: pnpm issue:create [--no-todo] --title "<t>" --body-file <f> \\\n` +
  `    --type ${ISSUE_TYPES.join('|')} --channel <owner|spec|retro|agent> \\\n` +
  `    --source "<what warrants it>" --milestone "<theme>"\n\n` +
  `  A thin wrapper around \`gh issue create\` (its flags pass through verbatim) that also\n` +
  `  adds the issue to the «${PROJECT_TITLE}» board (Project ${PROJECT_NUMBER}), sets Status=Todo,\n` +
  `  and confirms the item with a direct GraphQL read. --no-todo adds it without Status.\n\n` +
  `  Two provenance dimensions — do not confuse them:\n` +
  `    --channel  HOW the issue entered the backlog (who put it in the tracker) — a closed list\n` +
  `               stored as a channel:* label;\n` +
  `    --source   WHAT WARRANTS its existence — free text stored as the first body line,\n` +
  `               «**Source:**». Examples: «Anton's bug report in Mattermost, 2026-08-04»,\n` +
  `               «executive decision by the partners», «found while working on #124»,\n` +
  `               «Payload 3.86 dependency update».\n\n` +
  `  Required (fail-closed, BEFORE any gh call):\n` +
  `    • exactly one --channel: ${CHANNEL_LABELS.join(' | ')};\n` +
  `    • a non-empty --source (do not write **Source:** manually in the body);\n` +
  `    • exactly one --type: ${ISSUE_TYPES.join(' | ')} (native GitHub field);\n` +
  `    • a non-empty --milestone (fallback «${FALLBACK_MILESTONE}»);\n` +
  `    • a non-empty body (--body or --body-file), following canon §1's skeleton.\n` +
  `  The default assignee is @me. --repo/-R is forbidden.\n\n` +
  `  Bootstrap the taxonomy once: pnpm taxonomy:bootstrap --apply.\n` +
  `  Exit codes: 0 — issue created and confirmed on the board; 1 — error.\n`

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  if (argv.length === 0) {
    process.stderr.write(USAGE)
    process.exit(1)
  }

  const { setTodo, passthrough } = partitionArgs(argv)

  // 0. Gates — all before the first gh call. A violation means no issue was created.
  const error = validationError(passthrough)
  if (error) die(error)

  // Build the body here: the **Source:** line first, then the caller's text.
  // Send it through a temporary file instead of `--body` so a long body does
  // not hit the Windows command-line length limit.
  const channel = resolveChannel(passthrough)
  const sourceText = flagValues(passthrough, 'source')[0]
  const body = composeBody(sourceText, readBodyText(passthrough))
  for (const w of skeletonWarnings(body, [channel, ...collectLabels(passthrough)])) {
    process.stderr.write(`${TAG} remark (non-blocking): ${w}\n`)
  }

  const bodyDir = mkdtempSync(join(tmpdir(), 'bbm-issue-'))
  const bodyFile = join(bodyDir, 'body.md')
  writeFileSync(bodyFile, body, 'utf8')
  // Attach cleanup to 'exit', not try/finally: almost every exit here goes
  // through die() → process.exit, which does not execute finally.
  process.on('exit', () => {
    try {
      rmSync(bodyDir, { recursive: true, force: true })
    } catch {
      /* a temporary directory is not a reason to fail the command */
    }
  })

  const augmented = ensureAssigneeFlag(
    dedupeLabelFlags([
      ...stripConsumedFlags(passthrough),
      '--label',
      channel,
      '--body-file',
      bodyFile,
    ]),
  )

  // 1. Creation. Pin `--repo` AFTER passthrough: gh honours the last value, so
  //    even a leaked override cannot make the issue land outside this repo.
  out('creating the issue…')
  const created = ghResult(['issue', 'create', ...augmented, '--repo', REPO])
  if (!created.ok) die(enrichCreateError(created.error, collectLabels(augmented)))
  const url = extractIssueUrl(created.stdout)
  if (!url) die(`could not find the created issue URL in gh output:\n${created.stdout.trim()}`)
  const issueNumber = issueNumberFromUrl(url)
  if (!issueNumber) die(`could not parse the issue number from its URL: ${url}`)
  out(`created #${issueNumber} — ${url}`)

  // 2. Board placement — item-add returns the authoritative item id.
  const added = ghJson([
    'project',
    'item-add',
    PROJECT_NUMBER,
    '--owner',
    OWNER,
    '--url',
    url,
    '--format',
    'json',
  ])
  if (!added.ok) {
    die(
      `${added.error}\n  Issue #${issueNumber} WAS CREATED but is NOT on the board — add it manually: ` +
        `gh project item-add ${PROJECT_NUMBER} --owner ${OWNER} --url ${url}`,
    )
  }
  const itemId = added.data?.id
  if (!itemId) {
    die(
      `gh project item-add returned no item id (response: ${JSON.stringify(added.data)}); ` +
        `issue #${issueNumber} exists but is NOT on the board — add it manually.`,
    )
  }
  out(`added to the board — item ${itemId}`)

  // 3. Status=Todo — resolve ids LIVE (documented KNOWN values remain a
  //    cross-check) through the same function used by `board:status`.
  if (setTodo) {
    const target = resolveBoardStatusTarget(issueNumber, 'Todo')
    if (!target.ok) {
      die(`${target.error}\n  Repair manually: pnpm board:status ${issueNumber} Todo`)
    }
    for (const w of target.warnings) process.stderr.write(`${TAG} remark: ${w}\n`)
    const mutated = ghGraphqlResult(
      buildStatusMutation(target.projectId, target.itemId, target.fieldId, target.optionId),
    )
    if (!mutated.ok) {
      die(`${mutated.error}\n  Repair manually: pnpm board:status ${issueNumber} Todo`)
    }
    out('Status = Todo')
  }

  // 4. Confirmation through a direct node read (bypasses `item-list` read lag).
  const readback = ghGraphqlResult(buildNodeQuery(itemId))
  if (!readback.ok)
    die(`${readback.error}\n  Check manually: pnpm board:status ${issueNumber} Todo`)
  const check = parseNodeReadback(readback.data, issueNumber, { expectTodo: setTodo })
  if (!check.ok) {
    die(
      `board confirmation failed: ${check.reason} (item ${itemId}); ` +
        `repair it: pnpm board:status ${issueNumber} Todo`,
    )
  }

  out(
    `DONE — confirmed on the board.\n` +
      `  issue  = #${issueNumber}\n` +
      `  url    = ${url}\n` +
      `  item   = ${itemId}\n` +
      `  status = ${check.status ?? '(not set)'}`,
  )
  process.exit(0)
}

// Run main only on direct invocation; tests import pure seams without starting
// a single subprocess.
const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
