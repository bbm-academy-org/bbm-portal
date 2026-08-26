#!/usr/bin/env node
// ui-tokens — the UI kit's values come from the palette, and the palette has
// one source (#312).
//
// Canon: docs/ci-guardrails.md §5. Severity: WARN since 2026-08-26 (new-guard
// posture, §3). Earliest promotion 2026-09-23 under the §4 clauses.
//
// Why it exists: consolidation spec §11 parks «UI-линты и showcase» in the
// «Отложено» column behind ONE trigger — the start of `src/ui`. This guard is
// that trigger firing rather than the deferral being renewed silently.
//
// The rule is about a specific way a token layer dies. `src/ui/tokens.css` is
// derived, value by value, from the two owner-picked wireframes vendored in
// `design-source/` (that derivation is itself asserted, by
// tests/unit/ui-tokens.spec.ts). None of that survives a component stylesheet
// that writes `#fafafa` inline: the value is then correct today, unattributable
// tomorrow, and invisible to the next redesign. Three findings:
//
//   1. hardcoded-color — a colour literal in a KIT stylesheet other than
//      tokens.css. Scoped to `src/ui/**` on purpose: EARS-429 says the existing
//      /p/okr and /p/hours bodies are NOT restyled in this epic, so policing
//      their stylesheets would be this guard fighting a spec clause. Each
//      surface joins the scope on its own first substantive touch, per the
//      back-fill rule of .claude/rules/design-process.md §1.
//   2. unknown-token — a `var(--bbm-…)` ANYWHERE under `src/**\/*.css` naming a
//      token tokens.css does not declare. Repo-wide because the failure is
//      silent: a mistyped custom property does not error, it drops the whole
//      declaration, and the surface just looks slightly wrong.
//   3. registry-drift — `src/ui/tokens.ts`, the list the showcase renders,
//      disagreeing with what tokens.css declares, in either direction.
//
// KNOWN FALSE-POSITIVE CLASS, named here before the promotion window rather
// than discovered inside it: `unknown-token` reads any `var(--bbm-…)` under
// `src/**\/*.css` as a reference to the palette, so a surface stylesheet that
// DECLARES its own local `--bbm-…` custom property and then reads it back is
// reported even though it resolves fine. Nothing in the tree does that today.
// WARN absorbs it; before promotion to BLOCK (canon §4) the rule either drops
// findings whose token is declared in the SAME stylesheet, or the local
// property is renamed out of the `--bbm-` namespace, which is the honest fix —
// `--bbm-` is the palette's namespace and a local value borrowing it is the
// ambiguity, not the guard.
//
// Deliberately NOT checked: raw `px`. Component CSS legitimately carries
// one-off geometry, and a px ban would be noise on day 0. Widening the rule is
// a substantive change and restarts the promotion clock (canon §4).
//
// Run: `pnpm lint:ui-tokens`. Findings: stderr + exit 1. Clean: stdout + exit 0.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isEntryPoint, reporter, repoRoot, runMain, walkFiles } from './lib/guard.mjs'

const TAG = 'ui-tokens'

const TOKENS_CSS = 'src/ui/tokens.css'
const TOKENS_REGISTRY = 'src/ui/tokens.ts'
/** The kit's own stylesheets — the scope of the hardcoded-colour rule. */
const KIT_CSS_RE = /^src\/ui\/.*\.css$/
/** Every stylesheet under src/ — the scope of the unknown-token rule. */
const ANY_CSS_RE = /^src\/.*\.css$/

/**
 * Blank out CSS comments while KEEPING line numbers: a finding reports
 * `file:line`, so collapsing comments would misreport every line after one.
 * A comment may legitimately quote a design-source value («derived from #bbb»),
 * which is exactly why it must not be scanned.
 */
function blankComments(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** `--bbm-x: value` declarations of a stylesheet, in source order. */
export function declaredTokens(css) {
  const out = new Map()
  for (const m of blankComments(css).matchAll(/(--bbm-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim())
  }
  return out
}

/** Every `var(--bbm-…)` a stylesheet references. Non-`--bbm-` vars are none of our business. */
export function usedTokens(css) {
  const out = new Set()
  for (const m of blankComments(css).matchAll(/var\(\s*(--bbm-[a-z0-9-]+)/g)) out.add(m[1])
  return out
}

/**
 * Colour literals with their 1-based line numbers. Hex, `rgb(` and `hsl(` in
 * every form — the point is that a colour was written here at all, not which
 * notation was used. `transparent` and `currentColor` name no palette value and
 * are not literals in this sense.
 */
export function colorLiterals(css) {
  const out = []
  blankComments(css)
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)) {
        out.push({ line: i + 1, text: m[0] })
      }
    })
  return out
}

/** Token names quoted in `src/ui/tokens.ts`. Quoted, so prose can never arm one. */
export function registryNames(ts) {
  const src = String(ts).replace(/\/\*[\s\S]*?\*\//g, '')
  return [...src.matchAll(/'(--bbm-[a-z0-9-]+)'/g)].map((m) => m[1])
}

/**
 * The whole verdict, as a pure seam.
 *
 * @param {{
 *   tokensCss: string|null,
 *   registry: string[]|null,
 *   stylesheets: {rel: string, text: string}[],
 * }} input
 * @returns {{ findings: {kind: string, where: string, detail: string}[], skipped: boolean }}
 */
export function checkTokens({ tokensCss, registry, stylesheets }) {
  // A tree with no kit is nothing-to-check, not a clean pass. Stated as its own
  // outcome so a guard that lost its subject cannot report success.
  if (tokensCss == null || registry == null) return { findings: [], skipped: true }

  const declared = declaredTokens(tokensCss)
  const findings = []

  for (const { rel, text } of stylesheets) {
    if (KIT_CSS_RE.test(rel) && rel !== TOKENS_CSS) {
      for (const { line, text: literal } of colorLiterals(text)) {
        findings.push({
          kind: 'hardcoded-color',
          where: `${rel}:${line}`,
          detail: `${literal} — a colour the palette does not name. Add it to ${TOKENS_CSS} with the design-source selector it came from, or use the token that already carries it.`,
        })
      }
    }
    for (const name of usedTokens(text)) {
      if (!declared.has(name)) {
        findings.push({
          kind: 'unknown-token',
          where: rel,
          detail: `var(${name}) — ${TOKENS_CSS} declares no such token, so the declaration using it is silently dropped at runtime.`,
        })
      }
    }
  }

  const listed = new Set(registry)
  for (const name of declared.keys()) {
    if (!listed.has(name)) {
      findings.push({
        kind: 'registry-drift',
        where: TOKENS_REGISTRY,
        detail: `${name} is declared in ${TOKENS_CSS} but listed in no group — the showcase would not show it.`,
      })
    }
  }
  for (const name of listed) {
    if (!declared.has(name)) {
      findings.push({
        kind: 'registry-drift',
        where: TOKENS_REGISTRY,
        detail: `${name} is listed in a group but declared nowhere in ${TOKENS_CSS} — the showcase would render an empty swatch.`,
      })
    }
  }

  return { findings, skipped: false }
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()
  const read = (rel) =>
    existsSync(resolve(root, rel)) ? readFileSync(resolve(root, rel), 'utf8') : null

  const tokensCss = read(TOKENS_CSS)
  const registryTs = read(TOKENS_REGISTRY)
  const stylesheets = walkFiles(root, { include: (rel) => ANY_CSS_RE.test(rel) }).map((rel) => ({
    rel,
    text: readFileSync(resolve(root, rel), 'utf8'),
  }))

  const { findings, skipped } = checkTokens({
    tokensCss,
    registry: registryTs == null ? null : registryNames(registryTs),
    stylesheets,
  })

  if (skipped) {
    out.ok(`no ${TOKENS_CSS} in this tree — the UI kit is not present, nothing to check.`)
  }

  out.info(`scanned ${stylesheets.length} stylesheet(s) under src/`)
  if (findings.length === 0) {
    out.ok(
      `PASS — the kit's stylesheets carry no colour outside ${TOKENS_CSS}, every var(--bbm-…) ` +
        `resolves, and ${TOKENS_REGISTRY} lists exactly what is declared.`,
    )
  }

  for (const f of findings) out.finding(`${f.kind}  ${f.where}\n    ${f.detail}`)
  out.fail(
    `FAIL — ${findings.length} finding(s). The kit has ONE palette and it is derived from ` +
      'design-source/ (.claude/rules/design-process.md §1); a value written past it is correct ' +
      'today and unattributable tomorrow. Canon: docs/ci-guardrails.md §5.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
