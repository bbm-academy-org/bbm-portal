#!/usr/bin/env node
// bbm-portal — fire the aggregated PROD release digest from CI on a successful
// production Deployment (task 7.6, #137; port of ds-platform
// `tools/ci/post-release-digest.mjs`, incl. their #975 inaugural-range fix).
//
// Why this indirection exists: `deploy:prod` ships from the operator's
// workstation over SSH (spec §3 decision 13) and deliberately carries no repo
// secrets, so the Mattermost webhook does not exist on that path. What the
// deploy CAN do is record a GitHub Deployment + `success` status — and that
// event fires `.github/workflows/release-digest.yml`, where the secret lives.
// This script is that workflow's thin resolver: it turns the deployment event
// into a `<prev-sha>..<new-sha>` range and delegates the render + POST to
// `tools/deploy/release-notes.mjs`, the ONE digest seam.
//
// Inputs, all from the workflow `env:` (never interpolated into a shell body):
//   STATE / ENVIRONMENT   the deployment_status guard
//   NEW_SHA               the just-deployed sha (or the dispatch target)
//   DELIVERY_ENV=prod, MATTERMOST_RELEASE_WEBHOOK_URL, GH_TOKEN, GH_REPO
//
// The prev-sha is the commit of the newest `release-*` tag that is a STRICT
// ancestor of new-sha (a tag AT new-sha is excluded, so re-running the digest
// for an already-tagged release still ranges from the PRIOR release). This makes
// the digest describe exactly the RELEASE it announces — the same range the
// GitHub Release's auto-generated notes cover.
//
// When NO prior release tag exists — bbm-portal's state before the first
// `deploy:prod` — the baseline is the repo-root commit, so the inaugural digest
// covers the full history, matching `--generate-notes` on the inaugural Release.
// ds's #975 was exactly this edge: they anchored on the previous DEPLOYMENT
// instead, and their first digest came out tooling-only because the prior deploy
// already carried all the product work. Ported deliberately, not assumed.
//
// NON-FATAL by contract: every error path logs and exits 0. A notification job
// must never turn a successful deploy's aftermath red; the pure resolver below
// is unit-tested, so a real regression is caught by the spec, not by CI noise.

import { spawn, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseReleaseTag } from '../deploy/release-tag.mjs'

const HEX_RE = /^[0-9a-f]{7,40}$/i

/**
 * The deployment_status guard, in JS (mirrors the workflow `if:`). Only a
 * `success` state on `production` for a `deploy` TASK posts. A manual dispatch
 * synthesises all three, so it flows through the same guard. Pure.
 *
 * The task predicate is the one that is easy to omit and expensive to omit.
 * `pnpm deploy:prod --rollback` records its own Deployment so GitHub stops
 * asserting the sha just taken off the box — and that record is, correctly, a
 * `success` status on `production`. Without this check it would fire
 * «Релиз на PROD», re-announcing the very release being rolled back TO, to the
 * whole team, mid-incident. The rollback record carries `task: 'deploy:rollback'`
 * and is refused here.
 *
 * @param {{ state?: string, environment?: string, task?: string }} evt
 * @returns {boolean}
 */
export function shouldPost({ state, environment, task } = {}) {
  // A MISSING task counts as `deploy` — GitHub's own API default — so a
  // Deployment created by any other means still gets its digest instead of
  // being silently dropped. Anything else is refused rather than guessed at.
  const kind = (task ?? '').trim() || 'deploy'
  return state === 'success' && environment === 'production' && kind === 'deploy'
}

/**
 * Pick the baseline from the candidate `release-*` tags (already filtered to
 * ancestors-or-equal of `newSha`) plus an injected repo-root sha. Pure.
 *
 * Winner: the STRICT-ancestor tag with the latest `release-YYYY.MM.DD-<n>` date,
 * then the highest same-day ordinal. No qualifying tag → the repo root. Neither
 * → null, which `release-notes.mjs` green-skips.
 *
 * @param {Array<{ tag?: string, sha?: string }>} candidateTags
 * @param {string}      newSha
 * @param {string|null} [repoRootSha]
 * @returns {string|null}
 */
export function resolvePrevSha(candidateTags, newSha, repoRootSha = null) {
  const candidates = Array.isArray(candidateTags) ? candidateTags : []
  let best = null
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue
    const { tag, sha } = c
    if (typeof sha !== 'string' || !sha) continue
    if (sha === newSha) continue // strict ancestor — exclude a tag AT new-sha
    const parsed = parseReleaseTag(tag)
    if (!parsed) continue
    if (
      best === null ||
      parsed.date > best.date ||
      (parsed.date === best.date && parsed.ordinal > best.ordinal)
    ) {
      best = { date: parsed.date, ordinal: parsed.ordinal, sha }
    }
  }
  if (best) return best.sha
  return typeof repoRootSha === 'string' && repoRootSha ? repoRootSha : null
}

/** argv for `release-notes.mjs`. A null baseline becomes the literal `none`. Pure. */
export function buildReleaseNotesArgs(prevSha, newSha) {
  return ['--prev-sha', prevSha || 'none', '--new-sha', newSha]
}

function log(msg) {
  process.stdout.write(`[release-digest] ${msg}\n`)
}

/**
 * Gather the resolver's inputs from git: `release-*` tags reachable from
 * `newSha` (each peeled to its commit), plus the repo-root commit. I/O seam;
 * throws on failure (the non-fatal main catches).
 */
function fetchPrevShaInputs(cwd, newSha) {
  const tagList = spawnSync('git', ['tag', '--list', 'release-*', '--merged', newSha], {
    encoding: 'utf8',
    cwd,
  })
  if (tagList.status !== 0) {
    throw new Error(
      `git tag --merged exited ${tagList.status}: ${(tagList.stderr || '').trim().slice(0, 200)}`,
    )
  }
  const tags = (tagList.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  const candidateTags = []
  for (const tag of tags) {
    const r = spawnSync('git', ['rev-list', '-n', '1', tag], { encoding: 'utf8', cwd })
    if (r.status === 0) {
      const sha = (r.stdout || '').trim()
      if (sha) candidateTags.push({ tag, sha })
    }
  }

  let repoRootSha = null
  const root = spawnSync('git', ['rev-list', '--max-parents=0', newSha], { encoding: 'utf8', cwd })
  if (root.status === 0) {
    const roots = (root.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    // Grafted histories can have several roots; the last line is the earliest.
    repoRootSha = roots.length ? roots[roots.length - 1] : null
  }

  return { candidateTags, repoRootSha }
}

/** Spawn release-notes.mjs with the resolved range and the inherited CI env. */
function postDigest(args) {
  return new Promise((resolvePromise) => {
    const script = fileURLToPath(new URL('../deploy/release-notes.mjs', import.meta.url))
    const child = spawn(process.execPath, [script, ...args], {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', (e) => {
      log(`⚠ release-notes.mjs failed to spawn: ${e.message}`)
      resolvePromise(1)
    })
    child.on('close', (code) => resolvePromise(code ?? 1))
  })
}

async function main() {
  const state = process.env.STATE
  const environment = process.env.ENVIRONMENT
  const newSha = process.env.NEW_SHA
  const task = process.env.TASK

  if (!shouldPost({ state, environment, task })) {
    log(
      `not a successful production deploy (state=${JSON.stringify(state ?? null)}, ` +
        `environment=${JSON.stringify(environment ?? null)}, task=${JSON.stringify(task ?? null)}) — nothing to post.`,
    )
    return
  }

  if (!newSha || !HEX_RE.test(newSha)) {
    log(`deployment sha is not a git sha (${JSON.stringify(newSha ?? null)}) — skipping (green).`)
    return
  }

  const cwd = process.cwd()
  let prevSha = null
  try {
    const { candidateTags, repoRootSha } = fetchPrevShaInputs(cwd, newSha)
    prevSha = resolvePrevSha(candidateTags, newSha, repoRootSha)
  } catch (e) {
    log(`⚠ could not resolve the previous release tag (${e.message}) — no baseline (green).`)
  }

  log(
    `posting the digest for ${prevSha ? `${prevSha.slice(0, 12)}..` : '(no baseline) '}${newSha.slice(0, 12)} …`,
  )
  const code = await postDigest(buildReleaseNotesArgs(prevSha, newSha))
  if (code !== 0) {
    log(`⚠ release-notes.mjs exited ${code} — the digest did not post, but this job stays green.`)
  }
}

// Run only as the entry point — the pure seams stay importable without I/O.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : ''
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main()
    .catch((e) => {
      process.stdout.write(
        `[release-digest] ⚠ unexpected error (staying green): ${
          e instanceof Error ? e.message : String(e)
        }\n`,
      )
    })
    .finally(() => process.exit(0))
}
