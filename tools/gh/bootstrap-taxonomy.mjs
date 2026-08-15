#!/usr/bin/env node
// bbm-portal — `pnpm taxonomy:bootstrap`: idempotent taxonomy bootstrap (#130).
//
// What it bootstraps:
//   • four `channel:*` labels — the repo's only custom taxonomy, recording how
//     an issue entered the backlog because GitHub has no native field for it.
//     Issue class lives in native Type, while provenance is free text in the
//     body's `**Source:**` line (both per owner rulings from 2026-08-04);
//   • PERMANENT milestones (`PERMANENT_MILESTONES` in `./lib/gh.mjs`) — themes
//     that never close: «Platform: operations and hardening» as the fallback for
//     process/operations issues outside a product theme (canon §2), and
//     «Dependencies» for automated dependency-update PRs. Permanence is not
//     decoration: external callers reference such milestones by NAME
//     (`issue:create`) and NUMBER (`renovate.json`), while a closed theme's
//     number silently becomes stale;
//   • compares the NUMBER pinned in `renovate.json` with the live «Dependencies»
//     number and reports drift with a `⚠` line without editing the config;
//   • checks for org Issue Types Bug/Feature/Task. A repo cannot create them;
//     missing types are reported rather than repaired.
//
// Deliberate non-goal: delete nothing. Migration 7.2 decides the fate of default
// GitHub labels (`bug`, `enhancement`, `documentation`, `duplicate`, …) together
// with the issues that carry them. Deleting a label before migration strips
// information from the open backlog.
//
// The default is a DRY RUN that prints the plan and exits. Writes require an
// explicit `--apply`, so the lead can read the plan before anything changes.
//
// Exit codes: 0 = state matches the plan (or the plan was printed);
// 1 = gh failed while applying it.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import {
  CHANNEL_LABELS,
  DEPENDENCIES_MILESTONE,
  ISSUE_TYPES,
  PERMANENT_MILESTONES,
  OWNER,
  REPO,
  ghJson,
  ghResult,
} from './lib/gh.mjs'

const TAG = '[taxonomy:bootstrap]'

/**
 * Colour and description for each channel label; humans read the taxonomy too.
 * Channel answers «who put the issue in the tracker», NOT «what warrants its
 * existence»; the latter is free text in the body's `**Source:**` line.
 */
export const CHANNEL_LABEL_SPECS = [
  {
    name: 'channel:owner',
    color: '0e8a16',
    description: 'Channel: created or requested by the owner',
  },
  {
    name: 'channel:spec',
    color: '1d76db',
    description: 'Channel: opened mechanically from a spec or ADR (issue graph)',
  },
  {
    name: 'channel:retro',
    color: 'fbca04',
    description: 'Channel: came from a retro, /wrap or incident review',
  },
  {
    name: 'channel:agent',
    color: 'd4c5f9',
    description: 'Channel: agent initiative',
  },
]

// ── pure seams (unit-tested in tests/unit/gh-board-tools.spec.ts) ────────────

/**
 * Label plan: what to create, update (description/colour drift), or keep.
 * Deletes nothing; this tool has no delete path.
 * @param {{name:string,color?:string,description?:string}[]} existing
 * @returns {{create:object[], update:object[], keep:object[]}}
 */
export function planLabels(existing, specs = CHANNEL_LABEL_SPECS) {
  const byName = new Map((existing ?? []).map((l) => [l.name, l]))
  const create = []
  const update = []
  const keep = []
  for (const spec of specs) {
    const found = byName.get(spec.name)
    if (!found) {
      create.push(spec)
    } else if (
      (found.color ?? '').toLowerCase() !== spec.color.toLowerCase() ||
      (found.description ?? '') !== spec.description
    ) {
      update.push(spec)
    } else {
      keep.push(spec)
    }
  }
  return { create, update, keep }
}

/**
 * A permanent milestone spec is what creates the milestone, not GitHub's return
 * shape. `planMilestones` gives it a name: without this typedef, `@returns`
 * would widen to `object[]` and callers (including unit tests) would lose
 * `.title` under `noImplicitAny`.
 * @typedef {{title: string, description: string}} MilestoneSpec
 */

/**
 * Plan for PERMANENT milestones: which members of the set are missing. An
 * existing milestone in any state, including `closed`, is left alone; closing a
 * theme is an owner decision, not drift for tooling to revert.
 * @param {{title:string,state?:string}[]} existing
 * @param {MilestoneSpec[]} [specs]
 * @returns {{create: MilestoneSpec[], keep: MilestoneSpec[]}}
 */
export function planMilestones(existing, specs = PERMANENT_MILESTONES) {
  const byTitle = new Map((existing ?? []).map((m) => [m?.title, m]))
  const create = []
  const keep = []
  for (const spec of specs) {
    if (byTitle.has(spec.title)) keep.push(spec)
    else create.push(spec)
  }
  return { create, keep }
}

/**
 * Result of comparing the `renovate.json` pin with the live milestone number.
 * `status`: `ok` — pin matches; `drift` — pin points elsewhere (expected number
 * in `expected`); `unknown` — the milestone does not exist yet, so comparison is
 * impossible; `unpinned` — a valid config has no `milestone` key;
 * `unavailable` — the config could not be read or parsed.
 * @typedef {{status:'ok'|'drift'|'unknown'|'unpinned'|'unavailable', pinned:number|null,
 *            expected:number|null, title:string}} RenovatePinCheck
 */

/**
 * Compare the number pinned in `renovate.json` with the live permanent
 * milestone number. Renovate accepts a milestone only by NUMBER, while a
 * recreated theme silently gets a different number; hence this check (for why
 * the theme is permanent, see `PERMANENT_MILESTONES` in `./lib/gh.mjs`). This is
 * a REPORT: neither config nor milestone is edited here.
 * @param {{title:string,number?:number}[]} existing milestones returned by GitHub
 * @param {Record<string, unknown>|null|undefined} renovateConfig parsed renovate.json
 * @param {string} [title]
 * @returns {RenovatePinCheck}
 */
export function checkRenovateMilestonePin(
  existing,
  renovateConfig,
  title = DEPENDENCIES_MILESTONE,
) {
  const live = (existing ?? []).find((m) => m?.title === title)
  const expected = typeof live?.number === 'number' ? live.number : null
  if (renovateConfig === null || renovateConfig === undefined)
    return { status: 'unavailable', pinned: null, expected, title }
  const raw = renovateConfig.milestone
  if (raw === undefined || raw === null)
    return { status: 'unpinned', pinned: null, expected, title }
  const pinned = typeof raw === 'number' ? raw : null
  if (expected === null) return { status: 'unknown', pinned, expected: null, title }
  if (pinned === expected) return { status: 'ok', pinned, expected, title }
  return { status: 'drift', pinned, expected, title }
}

/** Missing org Issue Types. A repo cannot create them; it can only report them. */
export function missingIssueTypes(existing, required = ISSUE_TYPES) {
  const names = new Set((existing ?? []).map((t) => t?.name))
  return required.filter((t) => !names.has(t))
}

/**
 * Plan with one human-readable line per action.
 * @param {{labels:{create:object[],update:object[],keep:object[]},
 *          milestones:{create:MilestoneSpec[],keep:MilestoneSpec[]},
 *          missingTypes:string[], renovatePin?:RenovatePinCheck|null}} input
 * @returns {string[]}
 */
export function formatPlan({ labels, milestones, missingTypes, renovatePin = null }) {
  const lines = []
  for (const l of labels.create)
    lines.push(`CREATE label ${l.name} (#${l.color}) — ${l.description}`)
  for (const l of labels.update)
    lines.push(`UPDATE label ${l.name} (#${l.color}) — ${l.description}`)
  for (const l of labels.keep) lines.push(`already present: ${l.name}`)
  for (const m of milestones.create) lines.push(`CREATE milestone «${m.title}» — ${m.description}`)
  for (const m of milestones.keep) lines.push(`already present: milestone «${m.title}»`)
  for (const t of missingTypes) {
    lines.push(
      `⚠ org Issue Type «${t}» is missing — create it in ${OWNER}'s organization settings, not here`,
    )
  }
  if (renovatePin) {
    const pin = renovatePin.pinned === null ? '(not a number)' : `#${renovatePin.pinned}`
    const pinInParentheses = renovatePin.pinned === null ? pin : `(${pin})`
    if (renovatePin.status === 'ok') {
      lines.push(`already present: milestone pin «${renovatePin.title}» in renovate.json — ${pin}`)
    } else if (renovatePin.status === 'drift') {
      lines.push(
        `⚠ milestone pin «${renovatePin.title}» in renovate.json has drifted: pinned ${pin}, live #${renovatePin.expected}; ` +
          `renovate.json is edited manually and this tool only reports`,
      )
    } else if (renovatePin.status === 'unpinned') {
      lines.push(
        `⚠ renovate.json has no milestone key — theme «${renovatePin.title}» has no pinned number ` +
          `(live: ${renovatePin.expected === null ? 'theme not created yet' : `#${renovatePin.expected}`})`,
      )
    } else if (renovatePin.status === 'unavailable') {
      lines.push(
        `⚠ renovate.json could not be read or parsed — its assignees and milestone settings are unusable; ` +
          `fix the config before relying on theme «${renovatePin.title}»`,
      )
    } else {
      lines.push(
        `cannot check milestone pin «${renovatePin.title}» in renovate.json ${pinInParentheses}: the milestone itself does not exist yet`,
      )
    }
  }
  if (lines.every((l) => l.startsWith('already present'))) lines.push('no changes required')
  return lines
}

// ── imperative part ─────────────────────────────────────────────────────────

function out(msg) {
  process.stdout.write(`${TAG} ${msg}\n`)
}

/**
 * Read and parse `renovate.json` from the repo root. An unreadable or malformed
 * config does not abort taxonomy bootstrap; `null` lets the pin check report
 * that state separately from a valid config with no `milestone` key.
 * @returns {Record<string, unknown>|null}
 */
function readRenovateConfig() {
  try {
    return JSON.parse(readFileSync(new URL('../../renovate.json', import.meta.url), 'utf8'))
  } catch {
    return null
  }
}

function die(msg) {
  process.stderr.write(`${TAG} ${msg}\n`)
  process.exit(1)
}

export const USAGE = `Usage: pnpm taxonomy:bootstrap [--apply]

  Idempotently brings ${REPO}'s taxonomy to canon §2:
    • four channel:* labels (${CHANNEL_LABELS.join(', ')});
    • permanent milestones (${PERMANENT_MILESTONES.map((m) => `«${m.title}»`).join(', ')})
      — themes that never close, so external callers can reference them by name
      and number;
    • checks for org Issue Types ${ISSUE_TYPES.join('/')} — a repo cannot create
      these organization settings, so missing types are reported.

  With no flags this is a DRY RUN: it prints the plan and exits. Only --apply writes.

  It deletes nothing and has no delete path: default GitHub labels are handled
  together with issue migration (task 7.2), because deleting a label first
  strips information from the open backlog.

  Exit codes: 0 — plan printed or applied; 1 — gh or usage error.
`

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  const apply = argv.includes('--apply')
  for (const a of argv) {
    if (a !== '--apply') {
      process.stderr.write(`${TAG} unknown flag «${a}»\n${USAGE}`)
      process.exit(1)
    }
  }

  const labelsRes = ghJson([
    'label',
    'list',
    '--repo',
    REPO,
    '--limit',
    '200',
    '--json',
    'name,color,description',
  ])
  if (!labelsRes.ok) die(labelsRes.error)
  const milestonesRes = ghJson(['api', `repos/${REPO}/milestones?state=all&per_page=100`])
  if (!milestonesRes.ok) die(milestonesRes.error)
  const typesRes = ghJson([
    'api',
    'graphql',
    '-f',
    `query={organization(login:"${OWNER}"){issueTypes(first:20){nodes{id name}}}}`,
  ])
  const orgTypes = typesRes.ok ? (typesRes.data?.data?.organization?.issueTypes?.nodes ?? []) : []

  const labels = planLabels(labelsRes.data)
  const milestones = planMilestones(milestonesRes.data)
  const missingTypes = missingIssueTypes(orgTypes)
  const renovatePin = checkRenovateMilestonePin(milestonesRes.data, readRenovateConfig())

  out(apply ? 'plan (applying):' : 'DRY RUN — plan (apply with `--apply`):')
  for (const line of formatPlan({ labels, milestones, missingTypes, renovatePin })) out(`  ${line}`)

  if (!apply) {
    out('nothing changed.')
    process.exit(0)
  }

  for (const spec of labels.create) {
    const res = ghResult([
      'label',
      'create',
      spec.name,
      '--repo',
      REPO,
      '--color',
      spec.color,
      '--description',
      spec.description,
    ])
    if (!res.ok) die(res.error)
    out(`created label ${spec.name}`)
  }
  for (const spec of labels.update) {
    const res = ghResult([
      'label',
      'edit',
      spec.name,
      '--repo',
      REPO,
      '--color',
      spec.color,
      '--description',
      spec.description,
    ])
    if (!res.ok) die(res.error)
    out(`updated label ${spec.name}`)
  }
  for (const spec of milestones.create) {
    const res = ghResult([
      'api',
      '--method',
      'POST',
      `repos/${REPO}/milestones`,
      '-f',
      `title=${spec.title}`,
      '-f',
      `description=${spec.description}`,
    ])
    if (!res.ok) die(res.error)
    out(`created milestone «${spec.title}»`)
  }

  out('DONE — taxonomy now matches the plan (nothing deleted).')
  process.exit(0)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
