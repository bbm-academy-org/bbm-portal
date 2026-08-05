#!/usr/bin/env node
// bbm-portal — deliver a merged PR's «Product note (RU)» section to Mattermost
// (task 7.6, #137; port of ds-platform `tools/ci/post-product-note.mjs`).
//
// Driven by `.github/workflows/product-note-mattermost.yml` on a merged
// `pull_request` into main. The PR body, title and URL arrive through the
// process ENV — never interpolated into a shell string — so a `$(...)` or a
// backtick in a body cannot be executed, and the webhook JSON is built with
// `JSON.stringify`.
//
// This file also owns the extraction seams the aggregated PROD digest reuses
// (`tools/deploy/release-notes.mjs`), so a note can never read one way in the
// per-PR post and another way in the release digest.
//
// Behaviour:
//   webhook unset               → log + skip (green; the channel isn't wired yet)
//   note is `none`/absent/blank → log + skip (green; an internal-only PR)
//   DELIVERY_ENV unset/unknown  → FAIL LOUDLY (exit 1) — the environment marker
//                                 is the point, so an unmarked post is impossible
//   otherwise                   → POST the note, the linked PR title, the footer
//
// Order matters (and is deliberate): the DELIVERY_ENV check runs AFTER the skips,
// so a legitimate "nothing to say" PR stays green rather than going red on a
// missing marker — while every message that IS posted always carries one.
//
// ── Adaptation from ds ───────────────────────────────────────────────────────
// ds additionally gates on a product-kind PR LABEL (`feature`|`bug`). bbm-portal
// PRs carry no labels at all, and the repo has no such taxonomy — its labels are
// `channel:*` + `epic`/`consolidation`, and the Type lives on the ISSUE, not the
// PR (`.claude/skills/task-canon/SKILL.md`). Porting the gate would have meant
// inventing a label taxonomy nobody maintains, i.e. a second source of truth
// that drifts silently. Here the NOTE is the gate: write one and it ships to the
// channel, write `none` and nothing does.
//
// ── Relationship to the `product-note` CI guard (task 7.5, #136) ─────────────
// The `## Product note (RU)` section itself is 7.5's, not this task's: it and
// `tools/lint/product-note-lint.mjs` (which makes the section non-optional on a
// render-surface PR) landed with #136. This module deliberately does NOT add a
// competing section — it consumes THAT one, and
// tests/unit/release-notes.spec.ts pins the template's literal shape so a move
// on that side breaks a test here rather than silently posting nothing.
//
// The two readers keep different thresholds ON PURPOSE. The guard demands ≥40
// characters — an AUTHORING standard, applied when the note is written. Delivery
// accepts anything that is not `none`/blank/placeholder, because the guard ships
// as WARN: a short note that a reviewer nonetheless merged must still reach the
// channel. Refusing to deliver what a human accepted would hide it with no
// signal anywhere. Converging the two extractions onto one import is worth doing
// once both are on main — noted rather than done blind across branches.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HEADING_RE = /^#{1,6}\s*product\s+note\b[^\n]*$/im
// Capture stops at the FIRST of: the next ATX heading, a markdown thematic break
// (`---`/`***`/`___`, incl. spaced variants), or end of body. Anchored on a line
// boundary so a `---` divider does not let the English summary bleed in.
const SECTION_STOP_RE =
  /\n(?:#{1,6}\s|[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$)/m
const MARKER_RE = /^[ \t>*-]*product[- ]note\s*:\s*(.*)$/im
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g
const NONE_RE = /^none[.!]?$/i
const PLACEHOLDER_RE = /^(n\/?a|tbd|todo|xxx|\.\.\.|<.*>|_+|-+)$/i

/**
 * Service-marker lines that must never reach a delivered note. When the note is
 * the LAST section of a body, the capture runs to end-of-body and swallows the
 * PR's process tail (commit trailers, the Claude Code attribution, the session
 * link Mattermost would unfurl into a preview card). Whole matching LINES go;
 * real note text is preserved verbatim, so prose that merely mentions "Claude"
 * mid-sentence is untouched.
 */
const SERVICE_LINE_RES = [
  /claude\.ai\/code/i,
  /generated with.*claude\s+code/i,
  /^[ \t>*-]*co-authored-by\s*:/i,
  /^[ \t>*-]*claude-session\s*:/i,
  /^[ \t>*-]*author:\s*(claude|codex|human)\s*$/i,
]

/** Remove whole service-marker lines and collapse the blank runs they leave. */
export function stripServiceMarkers(text) {
  if (!text) return ''
  return text
    .split(/\r?\n/)
    .filter((line) => !SERVICE_LINE_RES.some((re) => re.test(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** The «Product note (RU)» section body, or null when there is no such heading. */
function sectionBody(body) {
  const h = body.match(HEADING_RE)
  if (h?.index === undefined || h.index === null) return null
  const rest = body.slice(h.index + h[0].length)
  const next = rest.search(SECTION_STOP_RE)
  return next === -1 ? rest : rest.slice(0, next)
}

/**
 * The note text, with HTML comments and service-marker lines stripped — the
 * sanitizer runs INSIDE the extraction so both delivery paths inherit it. A note
 * that is only service lines sanitizes to '' and flows into the `noteIsReal`
 * green skip.
 */
export function extractNote(body) {
  if (!body) return ''
  const section = sectionBody(body)
  if (section !== null) return stripServiceMarkers(section.replace(HTML_COMMENT_RE, '')).trim()
  const marker = body.match(MARKER_RE)
  if (marker) return stripServiceMarkers((marker[1] ?? '').replace(HTML_COMMENT_RE, '')).trim()
  return ''
}

/** True when this is a REAL note — not `none`, blank, or a leftover placeholder. */
export function noteIsReal(note) {
  const firstLine = String(note ?? '')
    .split(/\r?\n/)
    .find((l) => l.trim().length > 0)
  const v = (firstLine ?? '').trim()
  if (v.length === 0) return false
  if (NONE_RE.test(v)) return false
  if (PLACEHOLDER_RE.test(v)) return false
  return String(note).trim().length >= 8
}

/**
 * The mandatory environment footer. A merge into main only means the change is
 * ON main — this repo deploys manually, so it is NOT on prod yet, and saying so
 * explicitly is the whole reason the marker exists.
 */
const ENV_FOOTERS = {
  dev: '🧪 Среда: main — смержено; на проде появится со следующим релизом.',
  prod: '🚀 Среда: PROD — выкачено на продакшен.',
}

/** Footer for a DELIVERY_ENV value, or null for unset/unknown (→ fail loudly). */
export function envFooter(deliveryEnv) {
  const key = (deliveryEnv ?? '').trim().toLowerCase()
  return ENV_FOOTERS[key] ?? null
}

/** The Mattermost `{ text }` payload: note, linked PR title, footer last. */
export function buildPayload(note, prTitle, prUrl, footer) {
  const title = (prTitle ?? '').trim() || 'PR'
  const text = `${String(note).trim()}\n\n[${title}](${prUrl})\n\n${footer}`
  return { text }
}

function log(msg) {
  process.stdout.write(`[product-note] ${msg}\n`)
}

async function main() {
  const webhook = process.env.MATTERMOST_RELEASE_WEBHOOK_URL
  const body = process.env.PR_BODY ?? ''
  const prTitle = process.env.PR_TITLE ?? ''
  const prUrl = process.env.PR_URL ?? ''

  if (!webhook) {
    log('MATTERMOST_RELEASE_WEBHOOK_URL is not configured — skipping delivery (green).')
    return
  }

  const note = extractNote(body)
  if (!noteIsReal(note)) {
    log('no real «Product note (RU)» in the PR body (`none`/absent) — nothing to deliver (green).')
    return
  }

  const footer = envFooter(process.env.DELIVERY_ENV)
  if (footer === null) {
    throw new Error(
      `DELIVERY_ENV must be 'dev' or 'prod' to mark the environment; got ${JSON.stringify(
        process.env.DELIVERY_ENV ?? null,
      )}. Refusing to post an unmarked product note.`,
    )
  }

  const payload = buildPayload(note, prTitle, prUrl, footer)
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Mattermost webhook POST failed: ${res.status} ${res.statusText} ${detail.slice(0, 200)}`,
    )
  }
  log(`delivered the product note to Mattermost (${res.status}).`)
}

// Run only as the entry point — the pure seams stay importable without POSTing.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : ''
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`[product-note] ${e?.stack ?? String(e)}\n`)
    process.exit(1)
  })
}
