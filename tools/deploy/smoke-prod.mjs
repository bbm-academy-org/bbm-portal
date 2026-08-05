#!/usr/bin/env node
// bbm-portal — production smoke (task 7.6, #137; port of ds-platform
// `tools/deploy/smoke-prod.mjs`, cut down to this repo's single-VPS surface).
//
//   pnpm deploy:smoke --expect-sha <sha>   full gate, run by `deploy:prod`
//   pnpm deploy:smoke                      liveness only (no sha assertion)
//   pnpm deploy:smoke --dry-run            print the checks, touch no network
//
// Why it exists: "the commands exited 0" is not a deploy. The old runbook
// proved a deploy by comparing a marker file's mtime with a container's Created
// timestamp — both facts about the BOX, neither about the code answering
// requests. This asks the live origins, over the real Caddy vhosts, from
// outside:
//
//   1-2. BOTH public vhosts report the expected sha at `/api/health`. A skipped
//        rebuild, a build that failed after the tree was shipped, or a container
//        that was never recreated all surface here as the OLD sha. Asking each
//        vhost separately is deliberate: `portal.bbm.academy` and
//        `cms.bbm.academy` are separate Caddy site blocks, and inferring one
//        from the other is exactly the assumption this exists to kill.
//   3-4. The CMS REST + admin surfaces answer, so an app that boots and then
//        500s on real work is not called a success.
//   5.   The platform surface is routable on the portal host (200, or a
//        redirect — the OIDC gate legitimately bounces an unauthenticated
//        probe to the IdP).
//   6.   The ADR-003 host allowlist still holds: `/p/*` on the CMS host must
//        404. A deploy that silently widened the surface is a failed deploy.
//
// Exit 0 only when every check passes. Every check RUNS even after one fails —
// the operator gets the whole picture in one pass, not a first-failure sliver.
//
// All decisions are pure functions over `{ status, body }` observations, so the
// matrix is unit-tested with no network (tests/unit/deploy-smoke.spec.ts).

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SHA_RE = /^[0-9a-f]{7,40}$/i
const DEFAULT_TIMEOUT_MS = 20000

export const CMS_ORIGIN = 'https://cms.bbm.academy'
export const PORTAL_ORIGIN = 'https://portal.bbm.academy'
export const HEALTH_PATH = '/api/health'

/** Gap between settle sweeps. */
export const SETTLE_INTERVAL_MS = 5000

/** `--expect-sha <sha>` / `--dry-run` / `--timeout-ms <n>` / `--settle-ms <n>`. Pure. */
export function parseSmokeArgs(argv) {
  const args = Array.isArray(argv) ? argv : []
  const valueOf = (flag) => {
    const i = args.indexOf(flag)
    return i === -1 ? undefined : args[i + 1]
  }
  const dryRun = args.includes('--dry-run')
  const timeoutRaw = valueOf('--timeout-ms')
  const timeoutMs = timeoutRaw === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutRaw)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { error: `--timeout-ms must be a positive number, got ${JSON.stringify(timeoutRaw)}` }
  }
  const settleRaw = valueOf('--settle-ms')
  const settleMs = settleRaw === undefined ? 0 : Number(settleRaw)
  if (!Number.isFinite(settleMs) || settleMs < 0) {
    return { error: `--settle-ms must be a non-negative number, got ${JSON.stringify(settleRaw)}` }
  }

  if (!args.includes('--expect-sha')) return { expectSha: null, dryRun, timeoutMs, settleMs }
  const expectSha = valueOf('--expect-sha')
  if (!expectSha || !SHA_RE.test(expectSha)) {
    return {
      error: `--expect-sha needs a git sha (7–40 hex chars), got ${JSON.stringify(expectSha ?? null)}`,
    }
  }
  return { expectSha: expectSha.toLowerCase(), dryRun, timeoutMs, settleMs }
}

/**
 * The check list. `expectSha` null → the two health checks degrade to liveness
 * (status 200) and assert no identity. Pure.
 */
export function buildChecks({ expectSha }) {
  const sha = expectSha || null
  return [
    {
      kind: 'health',
      name: 'cms vhost reports the deployed sha',
      url: `${CMS_ORIGIN}${HEALTH_PATH}`,
      expectStatus: 200,
      expectSha: sha,
    },
    {
      kind: 'health',
      name: 'portal vhost reports the deployed sha',
      url: `${PORTAL_ORIGIN}${HEALTH_PATH}`,
      expectStatus: 200,
      expectSha: sha,
    },
    {
      kind: 'status',
      name: 'Payload REST answers',
      url: `${CMS_ORIGIN}/api/access`,
      expectStatus: 200,
    },
    {
      kind: 'status',
      name: 'Payload admin is served',
      url: `${CMS_ORIGIN}/admin`,
      expectStatus: 200,
    },
    {
      kind: 'status',
      name: 'platform surface routable on the portal host',
      url: `${PORTAL_ORIGIN}/p/hours`,
      expectStatus: 200,
      // The OIDC gate may bounce an unauthenticated probe to the IdP; both a
      // rendered page and a redirect prove the route exists and is gated.
      allowRedirect: true,
    },
    {
      kind: 'status',
      name: 'ADR-003 allowlist holds: /p/* 404s on the cms host',
      url: `${CMS_ORIGIN}/p/hours`,
      expectStatus: 404,
    },
  ]
}

/** True when `reported` is the expected sha or a git-style abbreviation of it. */
function shaMatches(expected, reported) {
  if (typeof reported !== 'string' || !SHA_RE.test(reported)) return false
  const a = expected.toLowerCase()
  const b = reported.toLowerCase()
  return a.startsWith(b) || b.startsWith(a)
}

/**
 * Verdict for one check against one observation `{ status, body }` (or
 * `{ error }` for a transport failure). Pure — this is the whole decision.
 *
 * @param {{ kind: string, name: string, url: string, expectStatus: number,
 *           expectSha?: string|null, allowRedirect?: boolean }} check
 * @param {{ status?: number, body?: string, error?: string }} observed
 * @returns {{ ok: boolean, name: string, url: string, kind: string, detail?: string }}
 */
export function evaluateCheck(check, observed) {
  const base = { name: check.name, url: check.url, kind: check.kind }
  if (observed?.error) {
    return { ...base, ok: false, detail: `request failed: ${observed.error}` }
  }
  const status = observed?.status
  const statusOk =
    status === check.expectStatus || (check.allowRedirect && status >= 300 && status < 400)
  if (!statusOk) {
    return {
      ...base,
      ok: false,
      detail: `HTTP ${status} (expected ${check.expectStatus}${check.allowRedirect ? ' or a redirect' : ''})`,
    }
  }
  if (check.kind !== 'health' || !check.expectSha) return { ...base, ok: true }

  let parsed
  try {
    parsed = JSON.parse(observed.body ?? '')
  } catch {
    return {
      ...base,
      ok: false,
      // A 200 whose body is not JSON is the classic proxy-error page: green
      // status, wrong origin. Never accept the status alone.
      detail: `response body is not JSON (${String(observed.body ?? '').slice(0, 60)})`,
    }
  }
  const reported = parsed?.sha ?? null
  if (reported === null) {
    return {
      ...base,
      ok: false,
      detail: 'the app reports no sha (sha: null) — the image was built without DEPLOY_SHA',
    }
  }
  if (!shaMatches(check.expectSha, reported)) {
    return {
      ...base,
      ok: false,
      detail: `serving ${String(reported).slice(0, 12)}, expected ${check.expectSha.slice(0, 12)}`,
    }
  }
  return { ...base, ok: true, detail: `sha ${String(reported).slice(0, 12)}` }
}

/** Aggregate verdicts. An EMPTY list is red — "nothing ran" is never a pass. */
export function summarize(results) {
  const list = Array.isArray(results) ? results : []
  const failed = list.filter((r) => !r.ok).length
  return { ok: list.length > 0 && failed === 0, failed, total: list.length }
}

/**
 * One line per check. Pure.
 * @param {{ ok: boolean, name: string, url: string, detail?: string }} result
 */
export function formatResultLine({ ok, name, url, detail }) {
  const mark = ok ? '✓' : '✗'
  const tail = detail ? ` — ${detail}` : ''
  return `  ${mark} ${name} [${url}]${tail}`
}

/** Real HTTP fetcher: never throws, returns `{ status, body }` or `{ error }`. */
function httpFetcher(timeoutMs) {
  return async (url) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      // `redirect: 'manual'` so a 302 stays a 302 — following the OIDC redirect
      // would report the IdP's status, not ours.
      const res = await fetch(url, { redirect: 'manual', signal: controller.signal })
      const body = await res.text().catch(() => '')
      return { status: res.status, body }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    } finally {
      clearTimeout(timer)
    }
  }
}

const defaultSleep = (ms) => new Promise((res) => setTimeout(res, ms))

/**
 * Run every check (no early exit within a sweep) and aggregate, optionally
 * re-probing the still-red checks until they settle or the budget runs out.
 *
 * Two properties matter and are both tested: a sweep never short-circuits on the
 * first failure (the operator sees the whole picture, not a sliver), and a retry
 * only re-probes what is still red (a passing check is not re-asked, so the log
 * stays readable and a flaky pass cannot be un-passed).
 *
 * `settleMs` is a WALL-CLOCK budget, not a sweep count. No new sweep starts once
 * it is spent; a sweep already in flight runs to completion, so the true worst
 * case is `settleMs` plus one sweep — a bound that matches what the docs promise.
 * (As a sweep count it did not: each sweep can burn 6x the HTTP timeout, making
 * "90 s" nearer 40 minutes against a blackholed host.)
 *
 * `fetcher`, `sleep` and `now` are injectable so the whole matrix — including
 * the deadline semantics — is unit-testable offline and instantly.
 *
 * @param {{ expectSha?: string|null,
 *           fetcher?: (url: string) => Promise<{ status?: number, body?: string, error?: string }>,
 *           timeoutMs?: number, settleMs?: number, intervalMs?: number,
 *           sleep?: (ms: number) => Promise<unknown>, now?: () => number,
 *           onRetry?: (attempt: number, redCount: number) => void }} [opts]
 */
export async function runSmoke({
  expectSha,
  fetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  settleMs = 0,
  intervalMs = SETTLE_INTERVAL_MS,
  sleep = defaultSleep,
  now = () => Date.now(),
  onRetry,
} = {}) {
  const get = fetcher || httpFetcher(timeoutMs)
  const checks = buildChecks({ expectSha })
  const results = new Array(checks.length).fill(null)
  const deadline = now() + Math.max(0, Number(settleMs) || 0)

  let attempt = 0
  for (;;) {
    attempt += 1
    for (let i = 0; i < checks.length; i++) {
      if (results[i] && results[i].ok) continue
      results[i] = evaluateCheck(checks[i], await get(checks[i].url))
    }
    if (results.every((r) => r.ok)) break
    // Start a new sweep only if the WAIT still fits inside the budget. The
    // budget is wall time, not a sweep count: a sweep can itself burn 6x the
    // HTTP timeout, so counting attempts made the real bound many times the
    // documented one.
    if (now() + intervalMs > deadline) break
    if (onRetry) onRetry(attempt, results.filter((r) => !r.ok).length)
    await sleep(intervalMs)
  }
  return { ...summarize(results), results, attempts: attempt }
}

function log(msg) {
  process.stdout.write(`${msg}\n`)
}

async function main() {
  const parsed = parseSmokeArgs(process.argv.slice(2))
  if (parsed.error) {
    process.stderr.write(`[deploy:smoke] ${parsed.error}\n`)
    process.exit(2)
  }

  if (parsed.dryRun) {
    log(`[deploy:smoke] dry run — ${parsed.expectSha ? `expecting sha ${parsed.expectSha.slice(0, 12)}` : 'liveness only'}:`)
    for (const check of buildChecks({ expectSha: parsed.expectSha })) {
      const want = check.expectSha
        ? `sha == ${check.expectSha.slice(0, 12)}`
        : `HTTP ${check.expectStatus}${check.allowRedirect ? ' or a redirect' : ''}`
      log(`  · ${check.name} [${check.url}] → ${want}`)
    }
    return
  }

  log(
    `[deploy:smoke] ${parsed.expectSha ? `expecting sha ${parsed.expectSha.slice(0, 12)}` : 'liveness only'}` +
      `${parsed.settleMs > 0 ? ` (settling up to ${Math.round(parsed.settleMs / 1000)}s)` : ''} …`,
  )
  const res = await runSmoke({
    expectSha: parsed.expectSha,
    timeoutMs: parsed.timeoutMs,
    settleMs: parsed.settleMs,
    onRetry: (attempt, redCount) =>
      log(`  … ${redCount} check(s) still red after sweep ${attempt} — retrying within the budget`),
  })
  for (const line of res.results) log(formatResultLine(line))
  if (!res.ok) {
    process.stderr.write(`[deploy:smoke] RED — ${res.failed}/${res.total} check(s) failed\n`)
    process.exit(1)
  }
  log(`[deploy:smoke] green — ${res.total}/${res.total} checks passed`)
}

// Run only as the entry point — the pure seams stay importable without network.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : ''
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`[deploy:smoke] ${e?.stack ?? String(e)}\n`)
    process.exit(1)
  })
}
