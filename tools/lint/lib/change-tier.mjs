#!/usr/bin/env node
// Change tiers (#597): risk-proportional procedure per PR — Ship / Show / Ask.
// The rule and the procedure each tier buys live in `.claude/rules/change-tiers.md`;
// this module is its mechanical half and the one classifier every gate reads.
//
// The PR body DECLARES a tier (`Change-tier: Ship|Show|Ask — <reason>`); the
// changed-file set DETERMINES the minimum. An agent may raise the tier above
// the minimum, never lower it.
//
// Pattern source: ds-platform `tools/lint/lib/change-tier.ts` (#2584). Ported as
// plain `.mjs` because every bbm guard lib is `.mjs` run by bare `node`
// (docs/ci-guardrails.md §8) — no tsx in the guard toolchain. The path lists are
// bbm's own; ds-only machinery (spec `.feature` patch proofs, e2e run-selection
// modules, the email-copy allowlist) has no bbm counterpart and is not ported.
// One deliberate difference: bbm's Ship is prose only (owner, 2026-11-24 —
// «prose/typos/behaviour-free»), so a view-layer `*.tsx` / `*.css` floors at
// Show here, where ds lets a small presentational tweak ship.

import { stripNonEvidence, toPosix } from './guard.mjs'

/** @typedef {'ship' | 'show' | 'ask'} ChangeTier */
/**
 * @typedef {object} ChangeTierFile
 * @property {string} path
 * @property {string} [status]     `modified` | `added` | `removed` | `renamed` | …
 * @property {number} [additions]
 * @property {number} [deletions]
 * @property {string} [previousPath] rename source, when the listing reports one
 */

export const TIERS = /** @type {const} */ (['ship', 'show', 'ask'])
const ORDER = { ship: 0, show: 1, ask: 2 }

/** Changed non-test lines a Ship PR may carry. */
export const SHIP_LINE_CAP = 80

/**
 * Ask whatever the file is — tooling, CI, instructions, infra, dependencies,
 * config, schema migrations. A test under one of these is Ask too: a guard's
 * spec is part of the guard.
 */
const STRUCTURAL_ASK_RES = [
  /^(?:infra|tools|scripts|deploy|patches|\.github|\.claude|\.codex|\.agents)\//,
  /^design-source\//,
  /^(?:AGENTS|CLAUDE)\.md$/,
  /(?:^|\/)package\.json$/,
  /^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.nvmrc|renovate\.json|components\.json|test\.env)$/,
  /(?:^|\/)[^/]*\.config\.[^/]+$/,
  /(?:^|\/)tsconfig[^/]*\.json$/,
  /(?:^|\/)Dockerfile[^/]*$/,
  /(?:^|\/)docker-compose[^/]*$/,
  /(?:^|\/)\.env[^/]*$/,
  /(?:^|\/)(?:middleware|proxy|instrumentation)\.[^/]+$/,
  // Schema: Payload migrations and the whole platform DB package (its schema,
  // migrations, roles and seed — src/lib/platform/db/README.md).
  /^src\/migrations\//,
  /^src\/lib\/platform\/db\//,
  /^src\/payload-(?:types|generated-schema)\./,
]

/**
 * Ask when a non-test file changes here: auth / IdP, money (the finance
 * module), server endpoints and API contracts, the Payload content contract
 * (`.claude/rules/cms-content-contract.md`), security, specs and ADRs.
 */
const AREA_ASK_RES = [
  // auth / IdP — any `auth` path segment or name (`src/auth.ts`,
  // `authGate.ts`, `api/auth/**`) and any idp / zitadel path.
  /(?:^|\/)[^/]*auth(?!or)/i,
  /(?:^|[/._-])(?:idp|zitadel|oidc)/i,
  // money
  /^src\/lib\/(?:finance|finmodel)\//,
  /^src\/app\/(?:.*\/)?finance\//,
  // server endpoints, server actions, API
  /(?:^|\/)app\/(?:.*\/)?api\//,
  /(?:^|\/)route\.[cm]?[jt]sx?$/,
  /^src\/endpoints\//,
  /^src\/lib\/platform\/api\//,
  /(?:^|\/)actions\//,
  /(?:^|\/)(?:[^/]*[._-])?actions?[._-][^/]*$/i,
  // the Payload content contract
  /^src\/(?:collections|globals|fields|hooks)\//,
  // security
  /^src\/lib\/platform\/hostAllowlist\./,
  /^SECURITY\.md$/,
  // decisions
  /^docs\/(?:adr|specs)\//,
]

/** Ship is an ALLOWLIST: prose, the debt ledger, copy modules. */
const SHIP_RES = [
  /^docs\/.+\.mdx?$/,
  /^DEBT\.md$/,
  /(?:^|\/)README\.md$/,
  /^src\/(?:.*\/)?(?:copy\.ts|[^/]+-copy\.ts|copy\/[^/]+\.ts)$/,
]

/** Tests never raise the tier (outside the structural Ask paths). */
export function isTestPath(path) {
  const p = toPosix(path)
  return /\.(?:test|spec|e2e-spec)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\/|^tests\//.test(p)
}

export function isStructuralAskPath(path) {
  const p = toPosix(path)
  return STRUCTURAL_ASK_RES.some((re) => re.test(p))
}

/** True when a change to this (non-test) path needs at least Ask. */
export function isAskPath(path) {
  const p = toPosix(path)
  return isStructuralAskPath(p) || AREA_ASK_RES.some((re) => re.test(p))
}

/** A non-test path that may change under Ship. */
export function isShipPath(path) {
  const p = toPosix(path)
  return !isAskPath(p) && SHIP_RES.some((re) => re.test(p))
}

/**
 * The minimum tier a changed-file set requires, with the reasons for it.
 * `expectedCount` (the PR's own `changedFiles`) guards against classifying a
 * truncated listing: a mismatch, like an empty set, is Ask.
 *
 * @param {ChangeTierFile[]} files
 * @param {number} [expectedCount]
 * @returns {{ minimum: ChangeTier, reasons: string[], testOnly?: boolean }}
 */
export function classifyChangeTier(files, expectedCount) {
  const list = files ?? []
  if (!list.length) return { minimum: 'ask', reasons: ['no changed-file set to classify'] }
  if (expectedCount !== undefined && list.length !== expectedCount) {
    return {
      minimum: 'ask',
      reasons: [`incomplete changed-file set (${list.length} of ${expectedCount})`],
    }
  }
  const ask = []
  const show = []
  let code = 0
  let lines = 0
  for (const file of list) {
    const status = String(file.status ?? '').toLowerCase()
    const paths = [file.path, file.previousPath].filter(Boolean).map(toPosix)
    const structural = paths.filter(isStructuralAskPath)
    for (const p of structural) ask.push(`ask path: ${p}`)
    if (!structural.length && paths.every(isTestPath)) {
      if (status !== 'modified' && status !== 'added')
        show.push(`${status || 'unknown-status'} test: ${file.path}`)
      continue
    }
    code += 1
    for (const p of paths) if (!structural.includes(p) && isAskPath(p)) ask.push(`ask path: ${p}`)
    if (status !== 'modified') show.push(`${status || 'unknown-status'} file: ${file.path}`)
    if (!isShipPath(file.path)) show.push(`not a ship path (prose / copy): ${file.path}`)
    lines += (Number(file.additions) || 0) + (Number(file.deletions) || 0)
  }
  if (lines > SHIP_LINE_CAP) {
    show.push(`${lines} changed lines in non-test files (ship cap ${SHIP_LINE_CAP})`)
  }
  if (ask.length) return { minimum: 'ask', reasons: ask }
  if (show.length) return { minimum: 'show', reasons: show }
  if (!code) {
    return { minimum: 'ship', testOnly: true, reasons: [`test-only: ${list.length} test file(s)`] }
  }
  return { minimum: 'ship', reasons: [`${list.length} prose file(s), ${lines} line(s)`] }
}

const LINE_RE = /^[ \t>*_-]*change-tier[ \t]*:[ \t]*(.*?)[ \t]*$/gim
const VALUE_RE = /^\**(ship|show|ask)\**(?:[ \t]*[-–—:][ \t]*(.*))?$/i
const EMPTY_REASON_RE = /^(?:n\/?a|none|tbd|todo|xxx|\.\.\.|<.*>|_+|-+)?$/i

/**
 * The PR body's declaration. Text that only quotes the shape — HTML comments
 * (the PR template's own hints) and fenced blocks — is stripped first.
 *
 * `problem` is one of `missing` | `duplicate` | `malformed` | `no-reason`, or
 * `null` for a valid declaration. A Ship/Show line must say why (the claim
 * that the change is low-risk is the thing a reviewer checks); Ask needs no
 * reason, because it asks for nothing.
 *
 * @param {string} body
 * @returns {{ tier: ChangeTier | null, problem: string | null, raw: string[] }}
 */
export function parseDeclaration(body) {
  const text = stripNonEvidence(String(body ?? ''))
  const raw = [...text.matchAll(LINE_RE)].map((m) => m[1])
  if (!raw.length) return { tier: null, problem: 'missing', raw }
  if (raw.length > 1) return { tier: null, problem: 'duplicate', raw }
  const m = VALUE_RE.exec(raw[0])
  if (!m) return { tier: null, problem: 'malformed', raw }
  const tier = /** @type {ChangeTier} */ (m[1].toLowerCase())
  if (tier !== 'ask' && EMPTY_REASON_RE.test((m[2] ?? '').trim())) {
    return { tier, problem: 'no-reason', raw }
  }
  return { tier, problem: null, raw }
}

/** True when `declared` is at or above `minimum`. */
export function meetsMinimum(declared, minimum) {
  return ORDER[declared] >= ORDER[minimum]
}
