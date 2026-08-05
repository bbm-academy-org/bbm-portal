#!/usr/bin/env node
// bbm-portal — `pnpm deploy:prod`: the fail-closed production deploy (task 7.6,
// #137). Port of the ds-platform pipeline (`tools/deploy/prod.mjs`, ADR-0012)
// adapted to this repo's SINGLE VPS — the pattern travels, the topology does not.
//
//   pnpm deploy:prod                    deploy origin/main
//   pnpm deploy:prod --dry-run          print every gate + remote script, touch nothing
//   pnpm deploy:prod --rollback <sha>   app-only rollback to a retained image
//   pnpm deploy:prod --skip-ci-check    escape hatch; warns loudly
//
// It formalizes the trusted channel `deploy/README.md` already described — it
// does not invent a new one. Architecture decision: spec §3 decision 13
// (revision -d) — a scripted SSH deploy from the workstation, CI passive. A CI
// build would need an image registry plus deploy keys in Actions, i.e. a wider
// secret perimeter, for no gain on one VPS with one deploy unit. The revisit
// triggers are written down there (a second deploy unit, Infisical, a second
// deploy operator).
//
// Pipeline:
//   pre-flight  clean tree · target = origin/main's sha · green CI for that sha
//   ship        git archive <sha> → ssh (no registry; the box has no git clone)
//   stack       build app+migrate → migrate → up -d      (migrate before serving)
//   caddy       compare the running bind mount with the shipped Caddyfile,
//               restart only if stale, then re-compare
//   verify      the RUNNING container carries bbm-portal-app:<sha>
//   retention   keep the last 3 sha-tagged app images (never the :local tag)
//   smoke       deploy:smoke --expect-sha <sha>          (both vhosts, over HTTPS)
//   release     cut release-YYYY.MM.DD-<n> at the deployed sha
//   record      GitHub Deployment(production, sha) + success  → fires the digest
//
// FAIL-CLOSED. It refuses a dirty tree, a sha whose CI is red or still running,
// and a box whose running container does not carry the deployed image. It stops
// at the FIRST red step and prints a rollback pointer — it never "fixes prod by
// hand", and it never cuts a release or records a Deployment for a deploy that
// did not pass its own gates. Idempotent: archive overwrite, `up -d`, and
// Payload's `migrate` are all no-ops when already current.
//
// Every decision lives in a pure exported seam; the pipeline itself is an
// ordered list of injected steps, so the abort behaviour is unit-tested without
// a VPS (tests/unit/deploy-prod.spec.ts). A real deploy is the owner's
// acceptance step, not something this repo's tests can perform.

import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createDeploymentRecord } from './deployment-record.mjs'
import { cutDeployRelease } from './release-tag.mjs'

// ── configuration ────────────────────────────────────────────────────────────

/** SSH alias of the single production box (`deploy/README.md` prerequisites). */
const PROD_SSH = process.env.BBM_PROD_SSH || 'portal-prod-tw'
const REMOTE_TREE = '~/bbm-portal'
const COMPOSE_DIR = `${REMOTE_TREE}/deploy`
const COMPOSE = 'docker compose -f docker-compose.prod.yml'
const APP_CONTAINER = 'bbm-portal-app-1'
const APP_IMAGE_REPO = 'bbm-portal-app'

/** Sha-tagged app images kept on the box — the fast rollback path. */
export const IMAGE_RETENTION = 3

/** The health URL the Deployment record points its `log_url` at. */
export const PROD_HEALTH_URL = 'https://cms.bbm.academy/api/health'

/** The pipeline's stage order — the doc, the code and the test share this list. */
export const DEPLOY_STAGES = [
  'preflight',
  'readPrevSha',
  'ship',
  'deployStack',
  'applyCaddy',
  'verifyRunningSha',
  'prune',
  'smoke',
  'cutRelease',
  'recordDeployment',
]

const SHA_RE = /^[0-9a-f]{7,40}$/i

// ── tiny console ─────────────────────────────────────────────────────────────

const t0All = Date.now()
function step(msg) {
  console.log(`\n▶ ${msg}`)
}
function ok(msg, since) {
  const dt = since ? ` (${((Date.now() - since) / 1000).toFixed(1)}s)` : ''
  console.log(`  ✓ ${msg}${dt}`)
}
function die(msg, { rollbackHint } = {}) {
  console.error(`\n✗ DEPLOY FAILED: ${msg}`)
  if (rollbackHint) {
    console.error(
      '\n  The box was NOT hand-patched. To revert the app to the last-known-good\n' +
        '  sha (its image is still on the box — retention keeps the last ' +
        `${IMAGE_RETENTION}):\n` +
        '      pnpm deploy:prod --rollback <previous-sha>\n' +
        '  A bad MIGRATION is a different class: migrations are forward-only here,\n' +
        '  so rolling the app back does not roll the schema back — see the\n' +
        '  expand/contract canon in docs/runbooks/migrations-expand-contract.md.',
    )
  }
  process.exit(1)
}

// ── pure seams: pre-flight ───────────────────────────────────────────────────

/**
 * Reduce raw `gh api …/check-runs` rows to a verdict input: keep only the
 * LATEST run per check name (so a passing re-run beats an older failure), then
 * split into still-pending and concluded-bad. Pure.
 */
export function classifyCheckRuns(runs) {
  const rows = Array.isArray(runs) ? runs : []
  const latest = new Map()
  for (const r of rows) {
    if (!r || typeof r.name !== 'string') continue
    const ts = Date.parse(r.completed_at || r.started_at || '') || 0
    const prev = latest.get(r.name)
    if (!prev || ts >= prev._ts) latest.set(r.name, { ...r, _ts: ts })
  }
  const good = new Set(['success', 'neutral', 'skipped'])
  const pending = []
  const bad = []
  for (const r of latest.values()) {
    if (r.status !== 'completed') pending.push(r.name)
    else if (!good.has(r.conclusion)) bad.push(`${r.name}=${r.conclusion}`)
  }
  return { total: latest.size, pending, bad }
}

/**
 * The whole pre-flight decision, pure. Returns the sha that will ship plus the
 * errors that must abort and the warnings that must be printed.
 *
 * The target is ALWAYS `origin/main`'s sha, never local HEAD — un-pushed local
 * work therefore cannot reach prod. That is precisely why a divergent HEAD is a
 * warning rather than a hard failure: it lets the tool run from the branch that
 * introduces it while still shipping exactly origin/main.
 */
export function preflightVerdict({ dirty, head, originMain, checkRuns, skipCi = false }) {
  const errors = []
  const warnings = []

  if (dirty && String(dirty).trim()) {
    errors.push(
      `working tree is dirty — commit or stash first (a deploy ships committed main only):\n${dirty}`,
    )
  }
  if (!originMain || !SHA_RE.test(originMain)) {
    errors.push(`could not resolve origin/main to a sha (got ${JSON.stringify(originMain ?? null)})`)
  }
  if (head && originMain && head !== originMain) {
    warnings.push(
      `HEAD (${String(head).slice(0, 12)}) != origin/main (${String(originMain).slice(0, 12)}) — ` +
        'deploying origin/main, NOT your local HEAD.',
    )
  }

  if (skipCi) {
    warnings.push('--skip-ci-check: SKIPPING the green-CI gate (escape hatch)')
  } else {
    const ci = classifyCheckRuns(checkRuns)
    if (ci.total === 0) {
      errors.push(
        `no CI check-runs reported for ${String(originMain ?? '').slice(0, 12)} yet — wait for CI. ` +
          'The absence of a red check is not a green check.',
      )
    }
    if (ci.pending.length) errors.push(`CI is still running: ${ci.pending.join(', ')}`)
    if (ci.bad.length) errors.push(`CI is RED: ${ci.bad.join(', ')}`)
  }

  return { ok: errors.length === 0, sha: originMain, errors, warnings }
}

// ── pure seams: remote scripts ───────────────────────────────────────────────

/**
 * The remote half of the ship step. `tar -xz` is ADDITIVE: it overwrites but
 * never deletes, so a source file retired in the branch lingers on the box and
 * breaks the build (the trap `deploy/README.md` recorded on 2026-07-30). `src/`
 * is wiped first for that reason.
 *
 * `deploy/` is deliberately NOT wiped: the host-only `.env.prod`, `.env.postgres`
 * and `.env.preview` live there and exist nowhere else.
 */
export function buildShipCommand() {
  return `rm -rf ${REMOTE_TREE}/src && mkdir -p ${REMOTE_TREE} && tar -xz -C ${REMOTE_TREE}`
}

/**
 * Build the images, apply migrations, then bring the stack up — in that order,
 * because migrations are the schema SSOT and must land before the new app
 * serves traffic.
 *
 * Two traps this encodes, both learned on this box:
 *  • `migrate` builds from the SEPARATE `tooling` Dockerfile target, so a build
 *    of `app` alone leaves a stale tooling image and the migrate step becomes a
 *    SILENT no-op ("Done." with no "Migrating:" lines). Hence `build app migrate`
 *    plus `run --build`.
 *  • `docker compose run` attaches the container's stdin by default. Over an ssh
 *    channel that means it EATS the rest of this script and bash exits 0 —
 *    every following line silently skipped. Hence `</dev/null`.
 */
export function buildDeployScript(sha) {
  return `cd ${COMPOSE_DIR}
# Rewrite ONLY the DEPLOY_SHA line. This .env is compose's interpolation source;
# a clobbering '>' would wipe any other var a future change puts here.
{ { [ -f .env ] && grep -v '^DEPLOY_SHA=' .env; } || true; printf 'DEPLOY_SHA=%s\\n' '${sha}'; } > .env.next && mv .env.next .env
echo '-- build app + migrate (bbm-portal-app:${sha.slice(0, 12)}...) --'
${COMPOSE} build app migrate
echo '-- migrate (Payload; idempotent) --'
${COMPOSE} --profile tools run --build --rm migrate </dev/null
echo '-- migration ledger --'
${COMPOSE} exec -T postgres psql -U payload -d cms -c 'SELECT name, batch FROM payload_migrations ORDER BY id DESC LIMIT 5;'
echo '-- up -d --'
${COMPOSE} up -d
`
}

/**
 * Poll the box until the RUNNING app container carries the deployed image, or
 * give up. Polling (rather than one shot) covers the seconds between `up -d`
 * returning and the container actually being up after an image swap.
 */
export function buildVerifyScript(sha) {
  return `deadline=$(( $(date +%s) + 180 ))
while true; do
  image=$(docker inspect ${APP_CONTAINER} --format '{{.Config.Image}}' 2>/dev/null || echo absent)
  state=$(docker inspect ${APP_CONTAINER} --format '{{.State.Status}}' 2>/dev/null || echo absent)
  line="image=$image state=$state"
  if [ "$image" = "${APP_IMAGE_REPO}:${sha}" ] && [ "$state" = running ]; then
    echo "OK $line"; break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "TIMEOUT $line"; break
  fi
  sleep 5
done`
}

/** Verdict for the verify poll's output. Anything but a matching OK line is a
 *  failure: a success message the box does not back would be a lie. Pure. */
export function verifyVerdict(output, sha) {
  const line = String(output ?? '').trim()
  if (!line.startsWith('OK ')) return { ok: false, detail: line || '(no output)' }
  if (!line.includes(`image=${APP_IMAGE_REPO}:${sha}`)) return { ok: false, detail: line }
  return { ok: true, detail: line }
}

/**
 * Compare the shipped `Caddyfile` with the copy inside the RUNNING caddy
 * container. `docker cp` is daemon-side, so this assumes nothing about the
 * image containing a shell or a hash tool.
 */
export function buildCaddyComparisonScript() {
  return `cd ${COMPOSE_DIR}
cid=$(${COMPOSE} ps -q caddy)
if [ -z "$cid" ]; then echo 'caddy=mismatch'; exit 0; fi
tmp=$(mktemp)
if docker cp "$cid:/etc/caddy/Caddyfile" "$tmp" >/dev/null 2>&1 && cmp -s Caddyfile "$tmp"; then
  echo 'caddy=match'
else
  echo 'caddy=mismatch'
fi
rm -f "$tmp"
`
}

/**
 * True when caddy must be restarted to pick up the shipped config. Unreadable
 * or unexpected output counts as STALE: fail-closed, because the cost of a
 * needless caddy restart is a sub-second blip and the cost of a missed one is
 * a vhost serving yesterday's config. Pure.
 *
 * (`up -d caddy` does NOT recreate the container for a bind-mounted config
 * change, and `caddy reload` answers "config is unchanged" — the trap
 * `deploy/README.md` documented. A restart is the only thing that works.)
 */
export function caddyNeedsRestart(comparisonOutput) {
  return !String(comparisonOutput ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .includes('caddy=match')
}

export function buildCaddyRestartScript() {
  return `cd ${COMPOSE_DIR}
${COMPOSE} restart caddy
`
}

/**
 * Keep the last N sha-tagged app images; the `:local` tag (a hand-run
 * `docker compose build` with no DEPLOY_SHA) is never pruned. Pure.
 */
export function buildRetentionScript(keep = IMAGE_RETENTION) {
  return `docker images ${APP_IMAGE_REPO} --format '{{.CreatedAt}}\\t{{.Tag}}' \\
  | { grep -v -P '\\tlocal$' || true; } \\
  | sort -r \\
  | awk -v k=${keep} -F'\\t' 'NR>k{print $2}' \\
  | while IFS= read -r tag; do
      [ -n "$tag" ] && docker rmi "${APP_IMAGE_REPO}:$tag" >/dev/null 2>&1 || true
    done
echo 'retained tags:'; docker images ${APP_IMAGE_REPO} --format '  {{.Tag}} ({{.CreatedAt}})'
`
}

/** Validate a `--rollback <sha>` argument. Pure. */
export function parseRollbackSha(arg) {
  if (typeof arg !== 'string' || !SHA_RE.test(arg)) {
    return { ok: false, error: `--rollback needs a git sha (7-40 hex chars), got: ${arg ?? '(none)'}` }
  }
  return { ok: true, sha: arg.toLowerCase() }
}

// ── ssh plumbing ─────────────────────────────────────────────────────────────

/**
 * Keepalive on EVERY ssh channel. Without it a half-open TCP connection (a NAT
 * flush, a Wi-Fi flap, a box-side reset the client never saw) hangs the deploy
 * silently forever — the local process just waits on a socket nobody will write
 * to. With it the channel dies LOUDLY after ~60s and the normal failure path runs.
 */
export function sshBaseArgs(host) {
  return ['-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', host]
}

/** Per-step no-output budgets for the inactivity watchdog. A `docker build` on
 *  a 2 vCPU box legitimately goes minutes between lines; nothing else does. */
export const STALL_BUDGET_BUILD_MS = 10 * 60 * 1000
export const STALL_BUDGET_DEFAULT_MS = 2 * 60 * 1000

/**
 * The loud STALLED message. A tripped watchdog proves only that the LOCAL
 * channel went quiet — the remote docker work may well have finished — so the
 * text routes the operator to a box-reality check before any re-run decision.
 */
export function formatStallMessage(label, budgetMs, host) {
  const mins = budgetMs / 60000
  const n = Number.isInteger(mins) ? String(mins) : mins.toFixed(1)
  return (
    `STALLED: ${label} — no output for ${n}m; the remote work MAY have completed.\n` +
    `  Check by hand before deciding: pnpm deploy:smoke\n` +
    `  (or: ssh ${host} docker ps)`
  )
}

/**
 * Inactivity watchdog: arms on creation, `touch()` on each chunk resets it,
 * `stop()` disarms for good. Fires `onStall` at most once. Pure timer logic.
 */
export function createStallWatchdog({ label, budgetMs, host, onStall }) {
  let timer = null
  let done = false
  const arm = () => {
    timer = setTimeout(() => {
      done = true
      timer = null
      onStall(formatStallMessage(label, budgetMs, host))
    }, budgetMs)
  }
  const disarm = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  arm()
  return {
    touch() {
      if (done) return
      disarm()
      arm()
    },
    stop() {
      done = true
      disarm()
    },
  }
}

// The remote command DRAINS the whole script first (`script=$(cat)`) and only
// then executes it. NEVER a bare `bash -s`: that reads the script from stdin
// incrementally, so any command which itself reads stdin swallows the rest of
// the script and bash exits 0 — silently skipping every following line.
// `--norc` inhibits the remote-shell rc heuristic (PS1 unbound under -u).
const REMOTE_BASH = 'script=$(cat); exec bash --norc -euo pipefail -c "$script"'

/** Run a bash script on the box over stdin, streaming its output live. */
function sshScript(host, script, { label, stallBudgetMs } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('ssh', [...sshBaseArgs(host), REMOTE_BASH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stalled = false
    const watchdog = createStallWatchdog({
      label: label || 'ssh',
      budgetMs: stallBudgetMs ?? STALL_BUDGET_DEFAULT_MS,
      host,
      onStall: (msg) => {
        stalled = true
        console.error(`\n✗ ${msg}`)
        child.kill()
        reject(new Error(msg))
      },
    })
    child.stdout.on('data', (d) => {
      watchdog.touch()
      process.stdout.write(d)
    })
    child.stderr.on('data', (d) => {
      watchdog.touch()
      process.stderr.write(d)
    })
    child.on('error', (e) => {
      watchdog.stop()
      reject(e)
    })
    child.on('close', (code) => {
      watchdog.stop()
      if (stalled) return
      if (code === 0) resolvePromise()
      else reject(new Error(`${label || 'ssh'} on ${host} exited ${code}`))
    })
    child.stdin.write(script)
    child.stdin.end()
  })
}

/** Capture a box command's stdout (small reads: inspect, compare, retention). */
function sshCapture(host, script) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('ssh', [...sshBaseArgs(host), REMOTE_BASH], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolvePromise(out.trim()) : reject(new Error(`ssh capture exited ${code}`)),
    )
    child.stdin.write(script)
    child.stdin.end()
  })
}

/** Ship the committed tree: `git archive <sha>` piped into the box's tar. The
 *  box has no git clone (org policy disables repo deploy keys), and there is no
 *  image registry — the archive IS the delivery channel. */
async function shipTree(sha) {
  const tmp = join(tmpdir(), `bbm-deploy-${sha.slice(0, 12)}.tar.gz`)
  await new Promise((resolvePromise, reject) => {
    const out = createWriteStream(tmp)
    const git = spawn('git', ['archive', '--format=tar.gz', sha])
    git.stdout.pipe(out)
    git.on('error', reject)
    out.on('error', reject)
    git.on('close', (c) =>
      c === 0 ? out.end(() => resolvePromise()) : reject(new Error(`git archive exited ${c}`)),
    )
  })
  try {
    await new Promise((resolvePromise, reject) => {
      const child = spawn('ssh', [...sshBaseArgs(PROD_SSH), buildShipCommand()], {
        stdio: ['pipe', 'inherit', 'inherit'],
      })
      child.on('error', reject)
      child.on('close', (c) =>
        c === 0 ? resolvePromise() : reject(new Error(`tar extract on the box exited ${c}`)),
      )
      createReadStream(tmp).pipe(child.stdin)
    })
  } finally {
    await rm(tmp, { force: true })
  }
}

// ── local git / gh ───────────────────────────────────────────────────────────

function localCap(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) {
    throw new Error(
      `\`${cmd} ${args.join(' ')}\` exited ${r.status}: ${(r.stderr || r.stdout || '').trim()}`,
    )
  }
  return (r.stdout || '').trim()
}

/** Fetch the check-runs of a sha as an array of rows (never throws). */
function fetchCheckRuns(sha) {
  const repo = localCap('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
  const raw = localCap('gh', [
    'api',
    '--paginate',
    `repos/${repo}/commits/${sha}/check-runs`,
    '-q',
    '.check_runs[] | {name,status,conclusion,started_at,completed_at}',
  ])
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

// ── the pipeline ─────────────────────────────────────────────────────────────

/**
 * Run the ordered stages. Every stage is injected, so the fail-closed contract
 * — a red step aborts and NOTHING downstream runs, in particular no release tag
 * and no Deployment record — is unit-tested without a VPS.
 */
export async function runDeploy(steps) {
  const sha = await steps.preflight()
  const prevSha = await steps.readPrevSha()
  await steps.ship(sha)
  await steps.deployStack(sha)
  await steps.applyCaddy()
  await steps.verifyRunningSha(sha)
  await steps.prune()
  await steps.smoke(sha)
  await steps.cutRelease(sha)
  await steps.recordDeployment(prevSha, sha)
  return { sha, prevSha }
}

/** Spawn the smoke as its own process, so `pnpm deploy:smoke` and the pipeline
 *  run byte-identical checks. */
function runSmokeProcess(sha) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, 'smoke-prod.mjs'), '--expect-sha', sha],
      { stdio: 'inherit' },
    )
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`prod smoke RED (exit ${code}) — the new build is not serving correctly`)),
    )
  })
}

/** The real, box-touching stages. */
function productionSteps() {
  return {
    async preflight() {
      step('Pre-flight: clean tree · target = origin/main · green CI for that sha')
      const dirty = localCap('git', ['status', '--porcelain'])
      localCap('git', ['fetch', 'origin', 'main'])
      const head = localCap('git', ['rev-parse', 'HEAD'])
      const originMain = localCap('git', ['rev-parse', 'origin/main'])
      const skipCi = process.argv.includes('--skip-ci-check')
      let checkRuns = []
      if (!skipCi) {
        try {
          checkRuns = fetchCheckRuns(originMain)
        } catch (e) {
          die(`could not query CI check-runs via gh: ${e.message}`)
        }
      }
      const verdict = preflightVerdict({ dirty, head, originMain, checkRuns, skipCi })
      for (const w of verdict.warnings) console.log(`  ⚠ ${w}`)
      if (!verdict.ok) die(verdict.errors.join('\n  '))
      ok(`will deploy origin/main @ ${verdict.sha.slice(0, 12)}`)
      return verdict.sha
    },

    // The previously-deployed sha, read off the RUNNING image tag — the box is
    // its own deploy record, no marker file. Non-fatal: the digest range is the
    // only consumer, and a missing anchor must never block a deploy.
    async readPrevSha() {
      try {
        const img = await sshCapture(
          PROD_SSH,
          `docker inspect ${APP_CONTAINER} --format '{{.Config.Image}}' 2>/dev/null || echo absent`,
        )
        const m = img.trim().match(new RegExp(`^${APP_IMAGE_REPO}:([0-9a-f]{7,40})$`, 'i'))
        const prev = m ? m[1] : null
        console.log(`  ↩ previously deployed: ${prev ? prev.slice(0, 12) : 'none / untagged'}`)
        return prev
      } catch (e) {
        console.log(`  ⚠ could not read the previous sha (${e.message}) — digest range disabled.`)
        return null
      }
    },

    async ship(sha) {
      step(`Ship origin/main @ ${sha.slice(0, 12)} → ${PROD_SSH}`)
      const t = Date.now()
      await shipTree(sha)
      ok('tree extracted on the box', t)
    },

    async deployStack(sha) {
      step('Box: build app+migrate → migrate → up -d')
      const t = Date.now()
      await sshScript(PROD_SSH, buildDeployScript(sha), {
        label: 'stack deploy',
        stallBudgetMs: STALL_BUDGET_BUILD_MS,
      })
      ok('images built, migrations applied, stack up', t)
    },

    async applyCaddy() {
      step('Caddy: does the running container serve the shipped Caddyfile?')
      const before = await sshCapture(PROD_SSH, buildCaddyComparisonScript())
      if (!caddyNeedsRestart(before)) {
        ok('the running mount already matches — no restart')
        return
      }
      console.log('      shipped Caddyfile differs from the running mount — restarting caddy')
      await sshScript(PROD_SSH, buildCaddyRestartScript(), { label: 'caddy restart' })
      const after = await sshCapture(PROD_SSH, buildCaddyComparisonScript())
      if (caddyNeedsRestart(after)) {
        die('caddy still does not serve the shipped Caddyfile after a restart', {
          rollbackHint: true,
        })
      }
      ok('caddy runs the shipped config')
    },

    async verifyRunningSha(sha) {
      step('Verify the RUNNING container carries the deployed image')
      const out = await sshCapture(PROD_SSH, buildVerifyScript(sha))
      console.log(`      ${out}`)
      const verdict = verifyVerdict(out, sha)
      if (!verdict.ok) {
        die(
          `the running container does NOT carry ${APP_IMAGE_REPO}:${sha.slice(0, 12)}:\n` +
            `  ${verdict.detail}\n` +
            '  A success line here would be a lie — treating this deploy as FAILED.',
          { rollbackHint: true },
        )
      }
      ok(`${APP_CONTAINER} runs ${APP_IMAGE_REPO}:${sha.slice(0, 12)}`)
    },

    async prune() {
      step(`Image retention (keep the last ${IMAGE_RETENTION} sha tags)`)
      await sshScript(PROD_SSH, buildRetentionScript(), { label: 'retention' })
      ok('old images pruned')
    },

    async smoke(sha) {
      step('Prod smoke (--expect-sha, both vhosts over HTTPS)')
      await runSmokeProcess(sha)
      ok('prod smoke green')
    },

    // Non-fatal by contract from here on: prod is already serving the new code.
    async cutRelease(sha) {
      step('Cut the release at the deployed sha')
      const res = cutDeployRelease({ targetSha: sha, cwd: process.cwd() })
      if (res.cut) ok(`release ${res.tag} cut at ${sha.slice(0, 12)}`)
      else console.log(`  ↷ no release cut (${res.reason})`)
      return res
    },

    async recordDeployment(prevSha, sha) {
      step('Record the deploy as a GitHub Deployment (this fires the digest)')
      let releaseTag = null
      try {
        const arr = JSON.parse(
          localCap('gh', ['release', 'list', '--limit', '1', '--json', 'tagName']) || '[]',
        )
        releaseTag = arr?.[0]?.tagName ?? null
      } catch (e) {
        console.log(`  ⚠ could not resolve the latest release tag (recording untagged): ${e.message}`)
      }
      const res = createDeploymentRecord({
        sha,
        releaseTag,
        // The digest text itself is composed in CI from the deployment event
        // (tools/ci/post-release-digest.mjs) — the workstation has no webhook.
        notesText: '',
        healthUrl: PROD_HEALTH_URL,
        cwd: process.cwd(),
      })
      if (res.ok) ok(`GitHub Deployment recorded (#${res.deploymentId})`)
      else console.log(`  ⚠ could not record the Deployment (deploy already succeeded): ${res.error}`)
    },
  }
}

/** `--dry-run`: run the LOCAL gates for real, then print the remote plan. */
async function dryRun() {
  const steps = productionSteps()
  const sha = await steps.preflight()
  console.log(`\n▶ DRY RUN — nothing below is executed (target ${sha.slice(0, 12)})`)
  console.log(`\n[ship] ssh ${PROD_SSH} '${buildShipCommand()}'  < git archive ${sha.slice(0, 12)}`)
  console.log(`\n[deployStack]\n${buildDeployScript(sha)}`)
  console.log(`[applyCaddy]\n${buildCaddyComparisonScript()}`)
  console.log(`[verifyRunningSha]\n${buildVerifyScript(sha)}`)
  console.log(`\n[prune]\n${buildRetentionScript()}`)
  console.log(`[smoke] node tools/deploy/smoke-prod.mjs --expect-sha ${sha}`)
  console.log('[cutRelease] release-YYYY.MM.DD-<n> at the deployed sha')
  console.log('[recordDeployment] gh api POST repos/{owner}/{repo}/deployments (+ success status)')
  console.log('\n✓ dry run complete — the pre-flight gates above are the real ones.')
}

/** App-only rollback: `up -d` a retained image. No rebuild, no migrate, no DB. */
async function rollback(shaArg) {
  const parsed = parseRollbackSha(shaArg)
  if (!parsed.ok) die(parsed.error)
  let sha
  try {
    sha = localCap('git', ['rev-parse', '--verify', `${parsed.sha}^{commit}`])
  } catch {
    die(`cannot resolve ${parsed.sha} to a commit in the local repo`)
  }

  step(`App-only rollback → ${APP_IMAGE_REPO}:${sha.slice(0, 12)}`)
  const present = await sshCapture(
    PROD_SSH,
    `if docker image inspect ${APP_IMAGE_REPO}:${sha} >/dev/null 2>&1; then echo PRESENT; else echo MISSING; fi`,
  )
  if (!present.includes('PRESENT')) {
    die(
      `${APP_IMAGE_REPO}:${sha.slice(0, 12)} is not on the box (pruned by retention?).\n` +
        '  Roll FORWARD instead: get that commit onto origin/main and run `pnpm deploy:prod`.',
    )
  }
  ok('the target image is still on the box')

  step('Box: up -d the previous tag (no rebuild, no migrate, no DB touch)')
  await sshScript(
    PROD_SSH,
    `cd ${COMPOSE_DIR}
{ { [ -f .env ] && grep -v '^DEPLOY_SHA=' .env; } || true; printf 'DEPLOY_SHA=%s\\n' '${sha}'; } > .env.next && mv .env.next .env
${COMPOSE} up -d app
`,
    { label: 'rollback up' },
  )

  step('Verify the RUNNING container carries the rollback image')
  const out = await sshCapture(PROD_SSH, buildVerifyScript(sha))
  console.log(`      ${out}`)
  if (!verifyVerdict(out, sha).ok) die(`rollback did not take: ${out}`)

  step('Prod smoke (--expect-sha)')
  await runSmokeProcess(sha)

  console.log(
    `\n✓ ROLLBACK OK — the app is back on ${sha.slice(0, 12)}.` +
      '\n  The DATABASE was not touched. Migrations here are forward-only, so an app' +
      '\n  rollback only works while the older code still runs against the newer' +
      '\n  schema — which is exactly what the expand/contract canon buys' +
      '\n  (docs/runbooks/migrations-expand-contract.md).',
  )
}

async function main() {
  if (process.argv.includes('--dry-run')) {
    await dryRun()
    return
  }
  const rbIdx = process.argv.indexOf('--rollback')
  if (rbIdx !== -1) {
    await rollback(process.argv[rbIdx + 1])
    return
  }
  const { sha } = await runDeploy(productionSteps())
  console.log(
    `\n✓ DEPLOY OK — origin/main @ ${sha.slice(0, 12)} is live` +
      ` (${((Date.now() - t0All) / 1000).toFixed(1)}s total).`,
  )
  console.log(`  Verify over HTTP:  curl -s ${PROD_HEALTH_URL}`)
}

// Run main only when invoked directly, so the pure seams import cleanly in tests.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = resolve(fileURLToPath(import.meta.url))
if (invokedPath && invokedPath === selfPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => die(err?.stack || err?.message || String(err), { rollbackHint: true }))
}
