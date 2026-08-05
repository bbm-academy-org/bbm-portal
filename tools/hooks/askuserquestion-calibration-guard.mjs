#!/usr/bin/env node
// PreToolUse guard on AskUserQuestion — CALIBRATION half (issue #134; ported
// from ds-platform tools/hooks/askuserquestion-calibration-guard.mjs).
//
// Division of labour with the sibling guard — read both before editing either:
//
//   askuserquestion-context-guard.mjs  BLOCK  Is the question ASKABLE at all?
//                                             (unanswered repeat; a short
//                                             question leaning on a bare `#N`.)
//   this file                          WARN   Given that it is asked, is it the
//                                             OWNER's question, and does the
//                                             copy read without decoding?
//
// The two never test the same thing: nothing here inspects question length,
// repetition or issue references — bare `#N` is deliberately absent from the
// jargon list below, because self-containment is the context guard's
// jurisdiction and a second verdict on it would just be noise.
//
// Symptom → root cause: the owner appoints the lead to DECIDE, not to relay
// choices back up (memory `design-decisions-to-owner-before-dispatch`,
// `orient-before-acting`). An OWNER-VISIBLE design / product-taste / product-scope
// choice — ≥2 defensible options where the answer changes what the owner ends up
// looking at — is a valid question. An engineering / architecture /
// impl-mechanism / token-cost / accuracy-vs-cost tradeoff is the LEAD's own call:
// present the candidates with pros/cons and a reasoned decision. Prose said this
// repeatedly and it kept recurring, so the reminder fires at the call site.
//
// A second lint runs over the owner-facing copy: undefined internal jargon (SHA,
// worktree, PAT, …) must be spelled out. The owner reads the dialog, they do not
// decode it.
//
// CLEAN QUESTIONS ARE SILENT (review PR #150, blocker 2). The ds-platform
// original emitted the classification paragraph on 100% of calls. Here that is
// wrong twice over: `systemMessage` renders in the OWNER's session, right where
// they are being asked something, so an unconditional banner is background noise
// on exactly the calls the owner is looking at — and a reminder that fires
// always trains its reader to skip it, the one failure a guard cannot survive.
// So the paragraph is now the PREAMBLE to a finding: no jargon hit, no
// restore-scope frame, no live-surface claim → no output at all. The findings
// are listed in the banner, so the reader sees what tripped it.
//
// SEVERITY (docs/ci-guardrails.md §6, decided 2026-08-05): WARN, PERMANENTLY,
// by design — not a promotion candidate. Blocking here would deny the owner a
// question that is already being asked, which is the opposite of what the guard
// wants. Its value is entirely in the reader seeing the calibration note.
//
// Contract: stdin — JSON PreToolUse ({session_id, cwd, tool_name, tool_input}).
// exit 0 + `systemMessage` on stdout = WARN; exit 0 with NO output = clean.
// Per the stack's convention (shared.mjs emitWarn, review PR #99) the payload
// carries NO `hookSpecificOutput.permissionDecision` — "allow" would
// pre-authorise the very call being flagged. FAIL-OPEN: any parse/logic error
// exits 0 with no output.

import { emitWarn, hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

/**
 * Internal jargon that must not reach owner-facing copy un-spelled-out. Matched
 * case-sensitively as whole tokens (not flanked by an ASCII alphanumeric, so
 * `SHA` matches and `SHALL` does not; hyphenated tokens match literally).
 *
 * Seeded from this repo's own vocabulary — the words that appear in session
 * prose and mean nothing outside it. Bare `#N` issue references are NOT here:
 * askuserquestion-context-guard.mjs owns that check.
 */
export const JARGON_TOKENS = [
  'SHA',
  'SSH',
  'PAT',
  'OIDC',
  'IdP',
  'worktree',
  'check-runs',
  'rebase',
  'squash',
]

/**
 * The fixed classification paragraph. It is the PREAMBLE of a banner that has at
 * least one finding to report — never emitted on its own (see the header note on
 * review PR #150).
 */
export function calibrationMessage() {
  return (
    '⚠ AskUserQuestion calibration (#134): before offloading this choice, classify it. ' +
    'OWNER-VISIBLE DESIGN / product taste / product scope — ≥2 defensible options where the ' +
    'answer changes what the owner ends up looking at — is a valid owner question, and per ' +
    'memory `design-decisions-to-owner-before-dispatch` it is asked BEFORE dispatch, not after. ' +
    'But ENGINEERING / architecture / impl-mechanism / token-cost / accuracy-vs-cost is the ' +
    "LEAD's OWN call: present the candidates WITH pros/cons and a reasoned decision, don't hand " +
    'the owner a blank multiple-choice (the owner corrects a wrong call, they do not make it for ' +
    'you). WARN-level only: never blocks.'
  )
}

/**
 * Collect every owner-facing copy string in an AskUserQuestion tool_input: each
 * question's `question` + `header`, and each option's `label` + `description`.
 * Shape-tolerant — missing / oddly-typed fields are skipped, never throw.
 */
export function collectCopy(toolInput) {
  const out = []
  const push = (v) => {
    if (typeof v === 'string' && v.trim()) out.push(v)
  }
  const questions = toolInput && Array.isArray(toolInput.questions) ? toolInput.questions : []
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue
    push(q.question)
    push(q.header)
    const options = Array.isArray(q.options) ? q.options : []
    for (const o of options) {
      if (!o || typeof o !== 'object') continue
      push(o.label)
      push(o.description)
    }
  }
  return out
}

/**
 * Literal whole-token scan of one copy string. A token matches when it is not
 * flanked by an ASCII alphanumeric on either side (so `SHA` fires but `SHALL` /
 * `hashSHA` do not). Case-sensitive.
 */
export function jargonHitsIn(text, tokens = JARGON_TOKENS) {
  const hits = []
  const s = String(text || '')
  for (const tok of tokens) {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`)
    if (re.test(s)) hits.push(tok)
  }
  return hits
}

/**
 * Detector A — a restore / remediation / undo / revert verb. RU stems
 * (восстанов/восстанав, откат, вернуть, вернём, верни) are matched so that the
 * correctness adjective «верный / верно» does NOT hit; «отмена» (a product
 * cancellation flow) is deliberately excluded.
 */
const RESTORE_VERB_RE =
  /(восстан[ао]в|откат|вернуть|верн[её]м|верни(?:те)?|remediat|\brestore|\brestoring\b|\bundo\b|\brevert|re-?instat|reinstat|rollback|roll\s+back)/i

/**
 * Detector A — a scope / extent cue: the signal that the restore verb is about
 * the SCOPE of undoing a mistake (a lead call), not a product feature that
 * merely mentions restoring (e.g. a password-recovery flow).
 *
 * NB: JS `\b` is ASCII-only (Cyrillic is not `\w`), so the RU cues carry no
 * `\b` — only the EN ones do.
 */
const RESTORE_SCOPE_CUE_RE =
  /(\bscope\b|объ[её]м|сколько|только|весь|всё|целиком|полност|частичн|how\s+much|\bentire\b|\bwhole\b|\bpartial|\bextent\b|\bonly\b|\bfull(?:y)?\b)/i

/**
 * Detector B — a reference to a live surface: a slash-route (`/p/hours`), a
 * source filename (`page.tsx`), or a surface noun (страница / page / endpoint /
 * route / маршрут / экран / screen).
 */
const SURFACE_REF_RE =
  /(?:(?:^|[\s("'«`>[])\/[a-zа-я][\w/-]*)|(?:\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|css|scss|json|ya?ml|md|vue|py|go|rs|sql|html?)\b)|(?:страниц|\bpage\b|endpoint|\broute\b|маршрут|экран|\bscreen\b|роут)/i

/**
 * Detector B — an asserted-state predicate binding a subject to a claimed state,
 * or a loaded state-noun (dump / дамп / stub / заглушк / сырой). Kept tight so a
 * product "which page do we route to" pick (no assertion) does not match. `это`
 * is deliberately NOT a predicate: it is indistinguishable from the
 * demonstrative «этой/этот» and would false-positive.
 */
const STATE_PREDICATE_RE =
  /(\bis\b|\bare\b|\bwas\b|\bwere\b|является|представляет\s+собой|\breturns?\b|\brenders?\b|содержит|\bstub\b|заглушк|\bdump\b|дамп|сыр(?:ой|ая|ое|ые))/i

/**
 * Detector A verdict: any SINGLE copy string framing a restore/remediation
 * SCOPE decision — restore verb AND scope cue in the SAME string. Same-string
 * pairing keeps it conservative: «восстановление» in the question plus an
 * unrelated «только» in an option does NOT fire. Never throws.
 */
export function restoreScopeHit(copies) {
  try {
    const list = Array.isArray(copies) ? copies : []
    return list.some(
      (c) => typeof c === 'string' && RESTORE_VERB_RE.test(c) && RESTORE_SCOPE_CUE_RE.test(c),
    )
  } catch {
    return false
  }
}

/**
 * Detector B verdict: any SINGLE copy string asserting an unverified factual
 * claim about a live surface — surface reference AND asserted-state predicate in
 * the SAME string. Per-string pairing avoids false-pairing a surface noun in one
 * option with a predicate in another. Never throws.
 */
export function surfaceClaimHit(copies) {
  try {
    const list = Array.isArray(copies) ? copies : []
    return list.some(
      (c) => typeof c === 'string' && SURFACE_REF_RE.test(c) && STATE_PREDICATE_RE.test(c),
    )
  } catch {
    return false
  }
}

/** The finding names, in the order they are reported. */
export const FINDING_JARGON = 'jargon'
export const FINDING_RESTORE_SCOPE = 'restore-scope'
export const FINDING_SURFACE_CLAIM = 'surface-claim'

/**
 * Pure decision seam (unit-tested without FS / process): given the parsed
 * AskUserQuestion `tool_input`, return the sorted, de-duplicated jargon hits, the
 * two detector verdicts, the `findings` list — and `systemMessage`, which is
 * `null` when NOTHING fired.
 *
 * A clean question is silent (review PR #150): the classification paragraph is
 * the preamble of a banner that has something to report, not a greeting. The
 * banner names its findings up front, so the owner-facing line says what tripped
 * it before it says what to do about it. NEVER throws.
 */
export function evaluateAskUserQuestion(toolInput, tokens = JARGON_TOKENS) {
  const hitSet = new Set()
  let copies = []
  try {
    copies = collectCopy(toolInput)
    for (const copy of copies) {
      for (const hit of jargonHitsIn(copy, tokens)) hitSet.add(hit)
    }
  } catch {
    // fail-open: a jargon-scan bug must never turn into a thrown hook
  }
  const jargonHits = [...hitSet].sort()
  const restoreScope = restoreScopeHit(copies)
  const surfaceClaim = surfaceClaimHit(copies)

  const findings = []
  if (jargonHits.length > 0) findings.push(FINDING_JARGON)
  if (restoreScope) findings.push(FINDING_RESTORE_SCOPE)
  if (surfaceClaim) findings.push(FINDING_SURFACE_CLAIM)

  if (findings.length === 0) {
    return { systemMessage: null, findings, jargonHits, restoreScope, surfaceClaim }
  }

  let message = `${calibrationMessage()}\nFlagged: ${findings.join(', ')}.`
  if (jargonHits.length > 0) {
    message +=
      `\n⚠ jargon lint (#134): owner-facing copy contains undefined internal jargon — ` +
      `${jargonHits.join(', ')}. Spell it out: the owner reads the dialog, they do not decode it.`
  }
  if (restoreScope) {
    message +=
      `\n⚠ restore/remediation-scope (#134): this frames the SCOPE of restoring an erroneously ` +
      `deleted or broken artifact as an owner menu. Undoing your own mistake is the LEAD's call — ` +
      `do a minimal-diff, faithful, FULL restore and resolve it inline.`
  }
  if (surfaceClaim) {
    message +=
      `\n⚠ live-surface claim (#134): an option or question asserts an unverified state claim ` +
      `about a live surface (a route / page / endpoint). Verify it against SOURCE first — a wrong ` +
      `premise makes the whole question invalid.`
  }
  return { systemMessage: message, findings, jargonHits, restoreScope, surfaceClaim }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    if (payload.tool_name && payload.tool_name !== 'AskUserQuestion') process.exit(0)
    const { systemMessage } = evaluateAskUserQuestion(payload.tool_input)
    // Clean question → not a word. Only a flagged one gets the banner.
    if (systemMessage) emitWarn(systemMessage)
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: never disturb a real question on a guard bug
  }
}

if (isDirectRun(import.meta.url)) main()
