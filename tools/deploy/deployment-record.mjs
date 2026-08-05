#!/usr/bin/env node
// bbm-portal — record a successful `deploy:prod` as a GitHub
// Deployment(production, sha) + a `success` status (task 7.6, #137; port of
// ds-platform `tools/deploy/deployment-record.mjs`).
//
// This record does double duty:
//
//   1. It is the durable answer to "what is on prod": before it, the only
//      answers were a marker file read back over SSH and the live app itself.
//      A future session can read the shipped digest + release tag from GitHub
//      without SSH access to the box.
//   2. Its `success` status is the EVENT that fires the Mattermost prod digest
//      (`.github/workflows/release-digest.yml`). This is the load-bearing half
//      of the spec §3 decision: the deploy runs from a workstation with the SSH
//      key and deliberately has NO repo secrets, so it cannot post to Mattermost
//      itself. It records a fact in GitHub; CI — where the webhook secret lives
//      — reacts to that fact. The channel needs no deploy credentials.
//
// Two seams:
//   • `buildDeploymentPayload(...)` — PURE, no I/O, no clock (the caller injects
//     `nowIso`). Assembles the two `gh api` request bodies.
//   • `createDeploymentRecord(...)` — the I/O seam. NON-FATAL by contract: it
//     never throws, returning `{ ok, deploymentId?, error? }`. It runs after the
//     box is already serving the new code, so a `gh` hiccup must never turn a
//     good deploy red.

import { spawnSync } from 'node:child_process'

const SHORT = 12
// GitHub caps a Deployment / deployment_status `description` at 140 chars.
const GH_DESCRIPTION_MAX = 140

/**
 * Strip astral-plane code points (> U+FFFF — emoji). GitHub's `description`
 * columns are legacy 3-byte `utf8` and reject 4-byte characters with a 422; the
 * digest's first line is `## 🚀 Релиз на PROD`, which trips it. Cyrillic is BMP
 * and survives — only surrogate pairs are dropped, and only from the
 * descriptions: `payload.notes` is a JSON column and keeps the emoji.
 */
function stripAstral(value) {
  return [...String(value ?? '')].filter((c) => c.codePointAt(0) <= 0xffff).join('')
}

/** Truncate to `max`, appending one ellipsis so the result is always ≤ max. */
function truncate(value, max) {
  const s = String(value ?? '')
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/** The first non-empty trimmed line of a block of text, or `''`. */
function firstNonEmptyLine(text) {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return ''
}

/**
 * Assemble the two `gh api` request bodies — PURE, no I/O.
 *
 * @param {object}      args
 * @param {string}      args.sha         deployed commit sha (the Deployment `ref`)
 * @param {string|null} args.previousSha  what this deploy REPLACED — the rollback
 *                                        pointer a later reader needs
 * @param {string|null} args.releaseTag  release tag shipped, or null (untagged)
 * @param {string|null} args.notesText   aggregated release-notes digest, or null/''
 * @param {string}      args.healthUrl   prod health URL (the status `log_url`)
 * @param {string}      args.nowIso      caller-injected ISO deploy timestamp
 * @param {string}     [args.task]       `deploy` (default) or `deploy:rollback`
 */
export function buildDeploymentPayload({
  sha,
  previousSha = null,
  releaseTag,
  notesText,
  healthUrl,
  nowIso,
  task = 'deploy',
}) {
  const shortSha = typeof sha === 'string' ? sha.slice(0, SHORT) : ''
  const tagLabel = releaseTag ?? '(untagged)'
  const notes = notesText ?? ''
  const statusSummary = firstNonEmptyLine(notes) || `release ${tagLabel}`

  return {
    deployment: {
      ref: sha,
      environment: 'production',
      // What KIND of deployment this is. GitHub's own default is `deploy`; we
      // always set it explicitly so a rollback is distinguishable in the API
      // rather than merely implied by absence.
      //
      // This field is load-bearing, not decorative: the `success` status of this
      // record is what fires the Mattermost release digest
      // (.github/workflows/release-digest.yml). A rollback record that looked
      // like a deploy record made CI re-announce «🚀 Релиз на PROD» for the very
      // release being rolled back TO — mid-incident, to the whole team. The
      // digest refuses any task but `deploy` (`shouldPost`).
      //
      // Note what is NOT faked to achieve that: the environment stays
      // `production` and the state stays `success`, because a rollback IS a
      // successful change to production. Corrupting the deploy record to silence
      // a notification would trade a wrong message for a wrong record.
      task,
      auto_merge: false,
      required_contexts: [],
      description: truncate(stripAstral(`release ${tagLabel} @ ${shortSha}`), GH_DESCRIPTION_MAX),
      payload: {
        releaseTag: releaseTag ?? null,
        notes,
        deployedAt: nowIso,
        // The rollback pointer: the sha this deploy replaced. Without it the
        // record says what is live but not what to go back to, and the answer
        // is otherwise only readable off the box's image tags.
        previousSha: previousSha ?? null,
      },
    },
    status: {
      state: 'success',
      log_url: healthUrl,
      environment: 'production',
      description: truncate(stripAstral(statusSummary), GH_DESCRIPTION_MAX),
    },
  }
}

/** POST a JSON body to a `gh api` path over stdin (safest for the nested
 *  `payload` object). Returns `{ ok, data?, error? }` — never throws. */
function ghApiPost(exec, path, body) {
  const r = exec('gh', ['api', '-X', 'POST', path, '--input', '-'], { input: JSON.stringify(body) })
  if (r.status !== 0) {
    // `gh api` writes the JSON error body — which NAMES the offending field — to
    // stdout, and only a short summary ("Validation Failed (HTTP 422)") to
    // stderr. Surface both, or the next validation failure is undiagnosable.
    const stderrLine = (r.stderr || '').trim().split(/\r?\n/)[0] ?? ''
    const stdoutBody = (r.stdout || '').trim().replace(/\s+/g, ' ')
    const detail = [stderrLine, stdoutBody].filter(Boolean).join(' | ').slice(0, 300)
    return { ok: false, error: `gh api ${path} exited ${r.status}: ${detail}` }
  }
  try {
    return { ok: true, data: JSON.parse(r.stdout || 'null') }
  } catch {
    return { ok: false, error: `gh api ${path}: response was not valid JSON` }
  }
}

/**
 * Create the GitHub Deployment + its success status. NON-FATAL: catches
 * everything and returns a result struct instead of throwing.
 *
 * @returns {{ ok: boolean, deploymentId?: number, error?: string }}
 */
export function createDeploymentRecord({
  sha,
  previousSha = null,
  releaseTag,
  notesText,
  healthUrl,
  task = 'deploy',
  cwd = process.cwd(),
  run,
}) {
  const exec =
    run ||
    ((cmd, args, opts = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', input: opts.input }))
  try {
    const { deployment, status } = buildDeploymentPayload({
      sha,
      previousSha,
      releaseTag,
      notesText,
      healthUrl,
      task,
      nowIso: new Date().toISOString(),
    })

    const created = ghApiPost(exec, 'repos/{owner}/{repo}/deployments', deployment)
    if (!created.ok) return { ok: false, error: created.error }

    const deploymentId =
      created.data && typeof created.data.id === 'number' ? created.data.id : null
    if (deploymentId === null) {
      return {
        ok: false,
        error: `deployment create returned no numeric id: ${JSON.stringify(created.data).slice(0, 200)}`,
      }
    }

    const marked = ghApiPost(exec, `repos/{owner}/{repo}/deployments/${deploymentId}/statuses`, status)
    if (!marked.ok) return { ok: false, deploymentId, error: marked.error }

    return { ok: true, deploymentId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
