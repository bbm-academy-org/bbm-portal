// bbm-portal — the epic product-layer predicate (#321).
//
// Why it exists: on 2026-08-24 epic #112 was decomposed straight from a technical
// consolidation spec, and the owner then corrected the framing — the portal is an
// internal corporate workspace, not an admin UI over two tables. The product
// layer for that epic had never been produced, and NOTHING MECHANICAL REQUIRED
// IT: the decomposition ran, seven sub-issues were filed, and the missing layer
// surfaced only through an owner correction in dialogue. Prose about the theme
// already exists, so the remedy is a deterministic check.
//
// The rule: an epic parent either NAMES its product layer (`docs/product/…`, the
// artifacts of `.claude/skills/author-product-spec/SKILL.md`) or carries an
// explicit RECORDED waiver. Deliberately satisfiable two ways — a hard "every
// epic needs a PRD" would be false (some epics are pure infrastructure), and a
// rule that is sometimes wrong gets routed around. The 2026-08-24 failure was not
// that a waiver was taken; it was that the question was never asked.
//
// The tail is part of the record — the same discipline the `Stage-B:` marker uses
// (`.claude/rules/design-process.md` §2). A bare «product-layer: waived» names
// nobody and no day, so it is an omission wearing a marker's clothes, not a
// decision.
//
// Two callers share this one predicate:
//   • `tools/gh/create-issue.mjs` — fail-closed at filing time on `--label epic`;
//   • `tools/gh/backlog-triage.mjs` — a flag row for the existing corpus, which is
//     never blocked or auto-edited.

import { isPlaceholder } from './text.mjs'

/** The canonical waiver line; printed verbatim in every failure message. */
export const WAIVER_FORM = 'product-layer: waived — <who waived it, YYYY-MM-DD>'

/** Where the product layer lives (`.claude/skills/author-product-spec/SKILL.md`). */
export const PRODUCT_DIR = 'docs/product'

/**
 * A `docs/product/<epic-slug>[/<file>]` reference. The `<epic-slug>` segment must
 * start with an alphanumeric, so the bare root (`docs/product/`) and the glob
 * used to DESCRIBE the rule (`docs/product/**`) do not count: talking about the
 * requirement is not satisfying it.
 */
const PRODUCT_PATH_RE = /docs\/product\/([A-Za-z0-9][A-Za-z0-9._-]*)(\/[A-Za-z0-9._-]*)?/g

/**
 * The waiver marker. Tolerates a list bullet, a blockquote marker and either dash
 * (em, en or ASCII), because a body is typed by hand as often as it is generated.
 */
const WAIVER_RE = /^[ \t]*(?:[-*>][ \t]*)*product-layer:[ \t]*waived[ \t]*(?:[—–-][ \t]*(.*))?$/im

/**
 * Text that only TALKS about the marker is never evidence — the same rule the
 * Stage-B lint applies: a fenced example and an HTML comment (the issue-template
 * instructions) are stripped before anything is read out of a body.
 */
export function stripNonEvidence(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
}

/**
 * Every `docs/product/…` path named in the body, first-occurrence order, deduped.
 * @param {string} body
 * @returns {string[]}
 */
export function productLayerPaths(body) {
  const seen = new Set()
  const out = []
  for (const m of stripNonEvidence(body).matchAll(PRODUCT_PATH_RE)) {
    const path = m[0]
    if (seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

/**
 * The waiver marker as recorded in the body.
 * @param {string} body
 * @returns {{line:string, tail:string|null, complete:boolean}|null} null when absent
 */
export function waiverRecord(body) {
  const m = WAIVER_RE.exec(stripNonEvidence(body))
  if (!m) return null
  const raw = (m[1] ?? '').trim()
  const tail = raw === '' || isPlaceholder(raw) ? null : raw
  return { line: m[0].trim(), tail, complete: tail !== null }
}

/**
 * Verdict for one epic body.
 * @param {string} body
 * @returns {{ok:boolean, kind:'path'|'waiver'|'waiver-incomplete'|'missing',
 *            paths:string[], waiver:{line:string,tail:string|null,complete:boolean}|null}}
 */
export function productLayerStatus(body) {
  const paths = productLayerPaths(body)
  const waiver = waiverRecord(body)
  // A named artifact wins over a waiver: if the layer exists, the waiver is moot.
  if (paths.length > 0) return { ok: true, kind: 'path', paths, waiver }
  if (waiver?.complete) return { ok: true, kind: 'waiver', paths, waiver }
  if (waiver) return { ok: false, kind: 'waiver-incomplete', paths, waiver }
  return { ok: false, kind: 'missing', paths, waiver: null }
}

/** The two cures, spelled out. Every failure message ends with this block. */
function cures() {
  return (
    `  Two cures — pick one:\n` +
    `    1. RUN PRODUCT DISCOVERY — the \`do-product-discovery\` skill\n` +
    `       (.claude/skills/do-product-discovery/SKILL.md) produces the epic brief\n` +
    `       ${PRODUCT_DIR}/<epic-slug>/brief.md plus one <NNN>-product.md per feature\n` +
    `       (.claude/skills/author-product-spec/SKILL.md). Then LINK the brief from the\n` +
    `       epic body — a file that exists but is not named here does not clear this gate.\n` +
    `    2. RECORD A WAIVER — some epics are pure infrastructure and honestly need no PRD.\n` +
    `       Put this line in the epic body, tail included:\n` +
    `         ${WAIVER_FORM}\n` +
    `       The tail is part of the record: it names the person who waived it and the day.\n` +
    `  Canon: .claude/skills/task-canon/SKILL.md §1 (epic).`
  )
}

/**
 * A single actionable error string, or null when the body clears the gate.
 * @param {string} body
 * @param {string} [subject] how the offending issue is named in the message
 * @returns {string|null}
 */
export function productLayerError(body, subject = 'an epic') {
  const status = productLayerStatus(body)
  if (status.ok) return null
  if (status.kind === 'waiver-incomplete') {
    return (
      `${subject} carries «${status.waiver?.line}» with no tail — that is an omission wearing a\n` +
      `  marker's clothes, not a decision. A waiver names WHO waived it and WHEN.\n` +
      cures()
    )
  }
  return (
    `${subject} must establish what it is FOR before it is decomposed: its body names no\n` +
    `  ${PRODUCT_DIR}/… artifact and carries no recorded waiver.\n` +
    cures()
  )
}
