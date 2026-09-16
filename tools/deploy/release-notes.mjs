#!/usr/bin/env node
// bbm-portal — the aggregated PROD release digest (task 7.6, #137; port of
// ds-platform `tools/deploy/release-notes.mjs`).
//
//   pnpm deploy:notes --prev-sha <sha> --new-sha <sha> [--dry-run]
//
// ONE Russian, product-language post listing the «Product note (RU)» of every
// PR merged between the previously-deployed sha and the newly-deployed one.
//
// It is fired from CI by `.github/workflows/release-digest.yml` on
// `deployment_status: success` for the production environment — NOT by
// `deploy:prod`. That is not an accident: the deploy runs from the operator's
// workstation over SSH (spec §3 decision 13) and deliberately holds no repo
// secrets, so the webhook does not exist on that path. The deploy records a
// GitHub Deployment; CI, where the secret lives, reacts to it.
//
// The range is derived deterministically from git + PR data: commit subjects of
// `<prevSha>..<newSha>` → the LAST `(#N)` per subject (a squash merge appends
// the merged PR number) → `gh pr view` per PR. Notes go into the payload
// verbatim via `JSON.stringify({ text })` — no shell, no interpolation.
//
// Every skip is GREEN — a digest must never fail a deploy that succeeded:
//   webhook unset (and not --dry-run)   → log + skip
//   DELIVERY_ENV unset/unknown          → FAIL LOUDLY (the deploy path passes prod)
//   prev-sha missing/`none`/not hex     → log + skip (no range to compute)
//   prev-sha == new-sha                 → log + skip (redeploy)
//   `git log <range>` non-zero          → warn + skip (a bad/expired anchor)
//   zero product PRs in the range       → post the "технический релиз" line, naming
//                                         how many technical changes it carried
//   otherwise                           → post the aggregated digest, closed by a
//                                         line counting the changes that carry no
//                                         product note (#501)

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { envFooter, extractNote, noteIsReal } from '../ci/post-product-note.mjs'

const SHORT = 12
const HEX_RE = /^[0-9a-f]{7,40}$/i

/**
 * Merged PR numbers from git-log commit subjects. A squash-merge subject carries
 * the merged PR as the LAST `(#N)`: `"fix(gh): board:status (#132) (#141)"` is
 * PR #141 — an earlier `(#132)` is a reference inside the title, not the merge.
 * Deduped, order of first appearance. Pure.
 */
export function extractPrNumbers(subjects) {
  const seen = new Set()
  const out = []
  const re = /\(#(\d+)\)/g
  for (const subject of Array.isArray(subjects) ? subjects : []) {
    let last = null
    let m
    re.lastIndex = 0
    while ((m = re.exec(String(subject))) !== null) last = Number(m[1])
    if (last === null || seen.has(last)) continue
    seen.add(last)
    out.push(last)
  }
  return out
}

/**
 * «N технических изменений», declined for the count. Russian picks the form by the
 * LAST digit — except in the teens (11–14), which always take the genitive
 * plural. Pure, so the rendering below stays testable without gh.
 */
export function pluralizeTechnicalChanges(n) {
  const count = Number(n)
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} техническое изменение`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} технических изменения`
  }
  return `${count} технических изменений`
}

/** A positive integer count, or 0 for anything else (absent, NaN, negative). */
function normalizeCount(technicalCount) {
  const n = Number(technicalCount ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * The aggregated `{ text }` for a non-empty note list. `notes` is
 * `{ note, title, url }[]`, already filtered to REAL notes. `technicalCount` is
 * how many merged PRs of the SAME range carried no product note; it is stated
 * as one line before the footer so three paragraphs are never read as three
 * shipped changes (#501). Zero — or a caller that passes no count at all —
 * renders exactly as before. The footer is always the last line. Pure.
 */
export function buildDigest({ notes, newSha, footer, technicalCount = 0 }) {
  const header = `## 🚀 Релиз на PROD\nЧто вошло в поставку (\`${newSha.slice(0, SHORT)}\`):`
  const blocks = notes.map(
    ({ note, title, url }) => `${note.trim()}\n[${(title ?? '').trim() || 'PR'}](${url})`,
  )
  const n = normalizeCount(technicalCount)
  if (n > 0) {
    blocks.push(
      `Плюс ${pluralizeTechnicalChanges(n)} (инфраструктура, проверки, ` +
        'документация) — на экране их не видно.',
    )
  }
  return { text: `${header}\n\n${blocks.join('\n\n')}\n\n${footer}` }
}

/**
 * The `{ text }` for a valid range that contained ZERO product notes. With a
 * `technicalCount` it also says HOW MUCH shipped anyway; at zero, or without the
 * parameter, it keeps the original bare sentence. Pure.
 */
export function buildTechnicalReleaseLine({ newSha, footer, technicalCount = 0 }) {
  const n = normalizeCount(technicalCount)
  const scale = n > 0 ? `${pluralizeTechnicalChanges(n)}, ` : ''
  return {
    text:
      '## 🚀 Релиз на PROD\n' +
      `Технический релиз (\`${newSha.slice(0, SHORT)}\`) — ${scale}пользовательских ` +
      'изменений в этой поставке нет.\n\n' +
      `${footer}`,
  }
}

function log(msg) {
  process.stdout.write(`[release-notes] ${msg}\n`)
}

/**
 * Compose the digest text for a range — the ONE seam both the Mattermost post
 * and any future consumer share. Returns `{ text, productCount, technicalCount }`,
 * or `null` on the legitimate green skip (a bad anchor whose `git log <range>`
 * fails). `technicalCount` counts the REAL PRs of the range — gh answered and the
 * JSON parsed — whose note is not real; a number that is no PR at all shipped
 * nothing and is not counted.
 * `footer` MUST be non-null (the caller validates DELIVERY_ENV first).
 */
export async function composeDigest({ prevSha, newSha, footer, cwd = process.cwd() }) {
  if (footer === null || footer === undefined) {
    throw new Error(
      `DELIVERY_ENV must be 'dev' or 'prod'; got ${JSON.stringify(
        process.env.DELIVERY_ENV ?? null,
      )}. Refusing to compose an unmarked release note.`,
    )
  }

  const logRes = spawnSync('git', ['log', '--format=%s', `${prevSha}..${newSha}`], {
    encoding: 'utf8',
    cwd,
  })
  if (logRes.status !== 0) {
    log(
      `⚠ \`git log ${prevSha.slice(0, SHORT)}..${newSha.slice(0, SHORT)}\` failed ` +
        `(anchor not in local history?) — skipping (green): ${(logRes.stderr || '').trim()}`,
    )
    return null
  }
  const subjects = (logRes.stdout || '').split(/\r?\n/).filter(Boolean)
  const prNums = extractPrNumbers(subjects)

  const notes = []
  let technicalCount = 0
  for (const n of prNums) {
    const r = spawnSync('gh', ['pr', 'view', String(n), '--json', 'number,title,url,body'], {
      encoding: 'utf8',
      cwd,
    })
    // Non-zero: the number is an issue ref rather than a PR, or a 404 — skip it.
    if (r.status !== 0) continue
    let pr
    try {
      pr = JSON.parse(r.stdout || '')
    } catch {
      continue
    }
    const note = extractNote(pr.body ?? '')
    if (!noteIsReal(note)) {
      technicalCount += 1
      continue
    }
    notes.push({ note, title: pr.title ?? '', url: pr.url ?? '' })
  }

  const payload =
    notes.length === 0
      ? buildTechnicalReleaseLine({ newSha, footer, technicalCount })
      : buildDigest({ notes, newSha, footer, technicalCount })
  return { text: payload.text, productCount: notes.length, technicalCount }
}

/** Parse `--flag value` / `--flag` from argv. Pure. */
export function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag)
    return i !== -1 ? argv[i + 1] : undefined
  }
  return {
    prevSha: get('--prev-sha'),
    newSha: get('--new-sha'),
    dryRun: argv.includes('--dry-run'),
  }
}

async function main() {
  const { prevSha, newSha, dryRun } = parseArgs(process.argv.slice(2))

  // A missing --new-sha is a caller error (the workflow always passes it).
  if (!newSha || !HEX_RE.test(newSha)) {
    throw new Error(
      `--new-sha must be a git sha (7-40 hex chars); got ${JSON.stringify(newSha ?? null)}.`,
    )
  }

  // env-only, no `.env.local` fallback: this runs in CI where the secret lives.
  if (!dryRun && !process.env.MATTERMOST_RELEASE_WEBHOOK_URL) {
    log('MATTERMOST_RELEASE_WEBHOOK_URL is not configured — skipping (green).')
    return
  }

  // No anchor → no range. Do NOT fabricate an all-history range here (that would
  // dump every product PR ever); the CALLER decides the inaugural baseline.
  // Checked BEFORE the DELIVERY_ENV fail-loud so a clean skip never goes red.
  if (!prevSha || prevSha === 'none' || !HEX_RE.test(prevSha)) {
    log('no previous anchor — cannot compute a range, skipping (green).')
    return
  }
  if (prevSha === newSha) {
    log('prev == new (redeploy of the same sha) — nothing entered, skipping (green).')
    return
  }

  const footer = envFooter(process.env.DELIVERY_ENV)
  const digest = await composeDigest({ prevSha, newSha, footer })
  if (!digest) return

  if (dryRun) {
    process.stdout.write(`${digest.text}\n`)
    return
  }

  const res = await fetch(process.env.MATTERMOST_RELEASE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: digest.text }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Mattermost webhook POST failed: ${res.status} ${res.statusText} ${detail.slice(0, 200)}`,
    )
  }
  log(
    `delivered the release digest (${res.status}; ${digest.productCount} product PR(s), ` +
      `${digest.technicalCount} technical).`,
  )
}

// Run only as the entry point — the pure seams stay importable without POSTing.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : ''
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`[release-notes] ${e?.stack ?? String(e)}\n`)
    process.exit(1)
  })
}
