#!/usr/bin/env node
// ui-tokens — the UI kit has ONE place where a colour value is written, and
// that place is the theme entry (#312, rewritten for the kit of #360).
//
// Canon: docs/ci-guardrails.md §5. Severity: WARN since 2026-08-26 (new-guard
// posture, §3). Earliest promotion 2026-09-23 under the §4 clauses.
//
// Why it exists: consolidation spec §11 parks «UI-линты и showcase» in the
// «Отложено» column behind ONE trigger — the start of `src/ui`. This guard is
// that trigger firing rather than the deferral being renewed silently.
//
// WHAT CHANGED IN #360, and why the rules are not the ones this file shipped
// with. The kit the guard was written against (#312) was a hand-written
// `--bbm-…` palette in `src/ui/tokens.css`, a `src/ui/tokens.ts` registry and a
// `/p/ui-kit` showcase that rendered it. The owner's Stage-A decision on
// 2026-08-26 replaced that kit with Tailwind v4 + the shadcn/ui neutral theme,
// and PR-1a deleted all three files. So:
//
//   - the SUBJECT moved from `src/ui/tokens.css` to `src/ui/theme.css`;
//   - the `--bbm-` namespace is gone — the theme's variables are shadcn's
//     unnamespaced ones (`--background`, `--border`, `--radius`, …);
//   - `registry-drift` is RETIRED, not re-pointed. There is no registry and no
//     showcase left for it to be about, and a rule kept alive past its subject
//     is a check that cannot fail while still reporting PASS.
//
// The rule that mattered survives, widened where the new kit needs it:
//
//   1. hardcoded-color — a colour literal ANYWHERE under `src/ui/**` other than
//      the theme entry, in `.css` AND in `.tsx`/`.ts`. The `.tsx` half is the
//      new half and it is the whole point: under Tailwind a value does not
//      escape the theme through a stylesheet any more, it escapes through
//      `className="bg-[#fafafa]"` or an inline `style`. A CSS-only scan would
//      leave the kit's actual failure mode unguarded — the kit ships exactly
//      one stylesheet today, and it is the exempt one.
//   2. unknown-variable — a `var(--…)` in a KIT stylesheet naming a variable
//      the theme entry does not declare. A mistyped custom property does not
//      error, it drops the whole declaration, and the surface just looks
//      slightly wrong.
//
// Scope stays the kit and not every stylesheet, for the reason it always did:
// spec 311 EARS-429 keeps the existing /p/okr and /p/hours bodies unreskinned
// in this epic, so policing their stylesheets would be this guard fighting a
// spec clause. Each surface joins the scope on its own first substantive touch,
// per the back-fill rule of .claude/rules/design-process.md §1.
//
// NARROWING RECORDED ON PURPOSE: `unknown-variable` used to run repo-wide over
// `src/**\/*.css`, which it could do because `--bbm-` was OUR namespace and any
// use of it was a reference to OUR palette. shadcn's variables are not
// namespaced, so a repo-wide scan would report every unrelated local custom
// property in okr.css / hours.css as an unknown token. Kit-scoped is the honest
// reading; the alternative (a prefix on the theme) would fork the kit from the
// upstream the owner chose to stand on. This also retires the known
// false-positive class the previous version carried into its promotion window.
//
// Deliberately NOT checked: raw `px`. Component source legitimately carries
// one-off geometry, and a px ban would be noise on day 0. Widening the rule is
// a substantive change and restarts the promotion clock (canon §4).
//
// Run: `pnpm lint:ui-tokens`. Findings: stderr + exit 1. Clean: stdout + exit 0.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isEntryPoint, reporter, repoRoot, runMain, walkFiles } from './lib/guard.mjs'

const TAG = 'ui-tokens'

/** The theme entry — the ONE file allowed to carry colour values. */
const THEME_CSS = 'src/ui/theme.css'
/** The kit's own source — the scope of the hardcoded-colour rule. */
const KIT_FILE_RE = /^src\/ui\/.*\.(css|tsx|ts)$/
/** The kit's own stylesheets — the scope of the unknown-variable rule. */
const KIT_CSS_RE = /^src\/ui\/.*\.css$/

/**
 * Blank out comments while KEEPING line numbers: a finding reports `file:line`,
 * so collapsing comments would misreport every line after one. Both comment
 * forms, because the kit is now `.tsx` as much as `.css` — and a comment may
 * legitimately quote a theme value («upstream paints this #fafafa»), which is
 * exactly why it must not be scanned.
 *
 * @param {string} text
 * @returns {string}
 */
function blankComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length))
}

/**
 * `--x: value` declarations of a stylesheet, in source order.
 *
 * @param {string} css
 * @returns {Map<string, string>}
 */
export function declaredVariables(css) {
  const out = new Map()
  for (const m of blankComments(css).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim())
  }
  return out
}

/**
 * Every `var(--…)` a stylesheet references.
 *
 * @param {string} css
 * @returns {Set<string>}
 */
export function usedVariables(css) {
  const out = new Set()
  for (const m of blankComments(css).matchAll(/var\(\s*(--[a-z0-9-]+)/g)) out.add(m[1])
  return out
}

/**
 * Colour literals with their 1-based line numbers. Hex plus every functional
 * notation the kit could reach for — the point is that a colour was written
 * here at all, not which notation was used. `oklch(` is in the list because the
 * shadcn theme is written in it, so it is the notation a copy-paste from the
 * theme would carry. `transparent` and `currentColor` name no theme value and
 * are not literals in this sense.
 *
 * @param {string} text
 * @returns {{line: number, text: string}[]}
 */
export function colorLiterals(text) {
  const out = []
  blankComments(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const m of line.matchAll(
        /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\(/g,
      )) {
        out.push({ line: i + 1, text: m[0] })
      }
    })
  return out
}

/**
 * The whole verdict, as a pure seam.
 *
 * @param {{
 *   themeCss: string|null,
 *   files: {rel: string, text: string}[],
 * }} input
 * @returns {{ findings: {kind: string, where: string, detail: string}[], skipped: boolean }}
 */
export function checkKit({ themeCss, files }) {
  // A tree with no kit is nothing-to-check, not a clean pass. Stated as its own
  // outcome so a guard that lost its subject cannot report success.
  if (themeCss == null) return { findings: [], skipped: true }

  const declared = declaredVariables(themeCss)
  const findings = []

  for (const { rel, text } of files) {
    if (rel === THEME_CSS) continue
    if (KIT_FILE_RE.test(rel)) {
      for (const { line, text: literal } of colorLiterals(text)) {
        findings.push({
          kind: 'hardcoded-color',
          where: `${rel}:${line}`,
          detail: `${literal} — a colour the theme does not name. Use the theme utility that already carries it (bg-background, text-muted-foreground, border-border …), or add the value to ${THEME_CSS} as a named variable.`,
        })
      }
    }
    if (KIT_CSS_RE.test(rel)) {
      for (const name of usedVariables(text)) {
        if (!declared.has(name)) {
          findings.push({
            kind: 'unknown-variable',
            where: rel,
            detail: `var(${name}) — ${THEME_CSS} declares no such variable, so the declaration using it is silently dropped at runtime.`,
          })
        }
      }
    }
  }

  return { findings, skipped: false }
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()
  const themePath = resolve(root, THEME_CSS)
  const themeCss = existsSync(themePath) ? readFileSync(themePath, 'utf8') : null

  const files = walkFiles(root, { include: (rel) => KIT_FILE_RE.test(rel) }).map((rel) => ({
    rel,
    text: readFileSync(resolve(root, rel), 'utf8'),
  }))

  const { findings, skipped } = checkKit({ themeCss, files })

  if (skipped) {
    out.ok(`no ${THEME_CSS} in this tree — the UI kit is not present, nothing to check.`)
  }

  out.info(`scanned ${files.length} kit file(s) under src/ui/`)
  if (findings.length === 0) {
    out.ok(
      `PASS — the kit carries no colour outside ${THEME_CSS}, and every var(--…) in a kit ` +
        'stylesheet resolves against it.',
    )
  }

  for (const f of findings) out.finding(`${f.kind}  ${f.where}\n    ${f.detail}`)
  out.fail(
    `FAIL — ${findings.length} finding(s). The kit has ONE theme and it is the standard ` +
      'shadcn/ui neutral theme the owner adopted on 2026-08-26 (#360); a value written past it ' +
      'is correct today and unattributable tomorrow. Canon: docs/ci-guardrails.md §5.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
