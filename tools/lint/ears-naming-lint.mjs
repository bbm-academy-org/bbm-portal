#!/usr/bin/env node
// ears-naming — the FORMAT half of the EARS↔test contract (#157, guard tranche 2).
//
// Canon: docs/specs/README.md ("EARS — ADOPTED", clause form + the
// `it('EARS-3: …')` naming rule) and docs/ci-guardrails.md §8 (the guard
// contract). Companion: `ears-test-lint.mjs` owns the COVERAGE + ORPHAN
// directions — every clause has a test, and no test cites a clause that does not
// exist. This guard owns the third concern: a test that INTENDS to be an EARS
// test must spell the id the one canonical way, or the grep the canon promises
// («requirement ↔ test becomes a grep instead of a reading exercise») silently
// misses it.
//
// SCOPE — deliberately narrow. Only a title that ATTEMPTS the EARS prefix and
// gets it wrong is a finding. A plain unit test with no id is legitimate: the
// canon makes the clause the unit of REQUIREMENT testing, not of every test, so
// demanding an id everywhere would be the "high code coverage, low requirements
// coverage" anti-pattern — and a genuinely MISSING test is `ears-test`'s finding,
// not this one's. Flagged shapes: `ears-3:` (lowercase), `EARS3:` (no hyphen),
// `EARS-3` (no colon), `EARS 3:` (space for hyphen).
//
// Canonical prefix: `EARS-N:`, nested `EARS-N.M:`, compound `EARS-N/M:` (one test
// covering two sibling clauses), each optionally annotated `EARS-N (#issue):`.
//
// FILE SET: the product test tiers (`tests/**`) and colocated `src/**` tests.
// `tools/lint/guard-tests/**` is excluded on purpose — a guard spec quotes
// malformed titles as its own test DATA, so scanning it would turn the guard
// family's input into evidence about the repo (the class `lib/guard.mjs`'s
// FIXTURES_PREFIX note exists for), and guards are tooling that carries no EARS
// clause anyway. A single file may opt out with `ears-naming-ok: <reason>`.
//
// SEVERITY: WARN — `docs/ci-guardrails.md` §5, job in `.github/workflows/ci.yml`
// with `continue-on-error: true`. The script itself exits 1 on a finding (canon
// §4 clause 1: a guard that prints and exits 0 is a stub and is not promotable).
// Promotion per §4; the earliest date lives in §5's row and in the job's own
// `continue-on-error` comment, deliberately not restated here.
//
// WHAT THE ATTEMPT ANCHOR DOES AND DOES NOT MATCH (#447). It MATCHES a title
// opening with `ears` followed by a hyphen, colon, digit, or a space that is NOT
// the start of an English word — so all four misspellings the rule exists for
// (`ears-3:`, `EARS3:`, `EARS-3` with no colon, `EARS 3:`) are attempts. It does
// NOT match the word EARS used as prose: `describe('EARS adoption record', …)`,
// `it('EARS is adopted here', …)`. Nor a word merely BEGINNING with the letters
// (`earshot banner renders`) — that one is carried by the character class, not
// by the #447 lookahead. The prose class used to be a finding and was
// the declared FALSE-BLOCK that held this guard back from the 2026-09-02
// promotion sweep (#438); narrowing it closed the class, and the only fix it
// would have offered an author — renaming an honest English title to please a
// guard — is the dead end docs/ci-guardrails.md §3 clause 3(d) forbids.
// Being a regex over human text the guard still carries a non-empty
// false-positive class by construction, so it is NOT a §3 class-1 candidate: the
// §4 clean window does real work here rather than proving what is provable. A
// residual false positive is answered by the `ears-naming-ok:` opt-out.
//
// Ported from ds-platform `tools/lint/ears-naming-lint.ts` — same rule, adapted
// to this repo's `.mjs` guard plumbing, test layout and canon references.
//
// Run: `pnpm lint:ears-naming`. Findings: stderr + exit 1. Clean: stdout + exit 0.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  isEntryPoint,
  isFixturePath,
  reporter,
  repoRoot,
  runMain,
  walkFiles,
} from './lib/guard.mjs'

const TAG = 'ears-naming'

/**
 * The product test tiers. `tools/lint/guard-tests/**` is filtered separately (see
 * the header) because it lives under `tools/`, which this pattern already
 * excludes — the exclusion is expressed by the anchors, not by a negative match.
 */
export const TEST_FILE_RE = /^(?:tests|src)\/.*\.(?:spec|test)\.(?:ts|tsx)$/

/** A file-level opt-out. The reason is mandatory — a bare marker suppresses nothing. */
export const SUPPRESS_RE = /ears-naming-ok:\s*\S/

/** An `it(` / `test(` / `describe(` title — the first string-literal argument. */
const TITLE_RE = /\b(?:it|test|describe)\s*\(\s*(['"`])([\s\S]*?)\1/g

/**
 * A title that ATTEMPTS the EARS prefix: opens with `ears` followed by a hyphen,
 * space, colon or digit — so a word that merely BEGINS with the letters, like
 * "earshot banner renders", is not read as a botched id. The negative lookahead
 * excludes the other prose shape (#447): `EARS` followed by whitespace and a
 * LETTER is the English word used in a sentence — `describe('EARS adoption
 * record', …)` — not a botched id. `EARS 3:` survives it, because a DIGIT after
 * the space is an id, not a word; so do `EARS:` and `EARS-x:`, where no
 * whitespace follows `EARS` at all — the pin that keeps them findings rather
 * than silently exempt (see the spec's regression pins).
 */
export const ATTEMPT_RE = /^\s*ears(?!\s+[A-Za-z])[-\s:0-9]/i

/** The canonical prefix: uppercase, hyphen, flat/nested/compound id, optional `(#N)`, colon. */
export const CANONICAL_RE = /^\s*EARS-\d+(?:[./]\d+)*(?:\s*\(#\d+\))?:/

/** Strip JS/TS comments so a commented-out malformed example is not a finding. */
export function stripJsComments(src) {
  return String(src ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

/**
 * Every test title in `src` that attempts the EARS prefix and is not canonical.
 * Titles only — never arbitrary file text, so a fixture datum or an assertion
 * string is not mistaken for a traceability reference.
 *
 * @param {string} src
 * @returns {string[]}
 */
export function findMalformedTitles(src) {
  const out = []
  for (const m of String(src ?? '').matchAll(TITLE_RE)) {
    const title = m[2]
    if (ATTEMPT_RE.test(title) && !CANONICAL_RE.test(title)) out.push(title)
  }
  return out
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()
  const files = walkFiles(root, {
    include: (rel) => TEST_FILE_RE.test(rel) && !isFixturePath(rel),
  })

  const findings = []
  let scanned = 0
  for (const rel of files) {
    let raw
    try {
      raw = readFileSync(resolve(root, rel), 'utf8')
    } catch {
      continue // an unreadable file is not a naming finding
    }
    if (SUPPRESS_RE.test(raw)) continue
    scanned++
    for (const title of findMalformedTitles(stripJsComments(raw))) {
      findings.push({ file: rel, title: title.slice(0, 80) })
    }
  }

  if (findings.length === 0) {
    out.ok(`${scanned} test file(s) scanned; every EARS-prefixed title is canonical.`)
  }

  for (const f of findings) {
    out.finding(`${f.file}: "${f.title}"  ->  not the canonical \`EARS-N:\` shape`)
  }
  out.fail(
    `${findings.length} malformed EARS test-name(s). The canonical prefix is \`EARS-N:\` ` +
      '(nested `EARS-N.M:`, compound `EARS-N/M:`, optional ` (#issue)`) — docs/specs/README.md, ' +
      '"Clause form". Fix the prefix, or drop the EARS-looking prefix for a genuine non-EARS ' +
      'test. Reasoned file-level opt-out: `ears-naming-ok: <reason>`.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
