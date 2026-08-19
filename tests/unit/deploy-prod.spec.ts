import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  CHECKPOINT_DUMP_GLOB,
  CHECKPOINT_EXPECTED_DATABASES,
  CHECKPOINT_EXPECTED_DUMPS,
  CHECKPOINT_KEEPALIVE_S,
  CHECKPOINT_LOG,
  CHECKPOINT_SCRIPT,
  DEPLOY_STAGES,
  HOLD_STAGES,
  HOLD_NEXT_COMMANDS,
  REQUIRED_PROD_ENV_VARS,
  buildEnvPreflightScript,
  formatEnvPreflightFailure,
  STALL_BUDGET_CHECKPOINT_MS,
  IMAGE_RETENTION,
  NON_FATAL_STAGES,
  ROLLBACK_STAGES,
  buildCaddyComparisonScript,
  buildCaddyRestartScript,
  buildCheckpointScript,
  buildDeployScript,
  buildRetentionScript,
  buildShipCommand,
  buildVerifyScript,
  caddyNeedsRestart,
  classifyCheckRuns,
  formatCheckpointFailure,
  formatDryRunPlan,
  formatHoldNotice,
  parseRollbackSha,
  preflightVerdict,
  resolveMode,
  createStallWatchdog,
  formatStallMessage,
  runDeploy,
  runRollback,
  verifyVerdict,
} from '../../tools/deploy/prod.mjs'

/**
 * `pnpm deploy:prod` — the fail-closed pipeline (task 7.6, #137).
 *
 * The contract these tests pin down is not "the steps work" (that needs the
 * real box, and a real deploy is the owner's acceptance step) but "the script
 * REFUSES in every situation where continuing would leave prod in a state
 * nobody can describe":
 *
 *   • it never ships an uncommitted or un-pushed tree;
 *   • it never ships a sha whose CI is red or still running;
 *   • it never prints a success line the box does not back (the running
 *     container must carry the deployed image tag);
 *   • when a step goes red it stops THERE — no release tag, no Deployment
 *     record, no hand-patching — and points at the rollback.
 *
 * The pipeline is therefore expressed as an ordered list of injected steps, so
 * the abort behaviour itself is unit-testable without touching the VPS.
 */

const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

// ── pre-flight ───────────────────────────────────────────────────────────────

describe('classifyCheckRuns', () => {
  it('keeps only the LATEST run per check name — a green re-run beats an old red', () => {
    const runs = [
      {
        name: 'CI',
        status: 'completed',
        conclusion: 'failure',
        completed_at: '2026-08-05T10:00:00Z',
      },
      {
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-08-05T11:00:00Z',
      },
    ]
    expect(classifyCheckRuns(runs)).toEqual({ total: 1, pending: [], bad: [] })
  })

  it('treats neutral and skipped as good, everything else as bad', () => {
    const runs = [
      { name: 'a', status: 'completed', conclusion: 'neutral' },
      { name: 'b', status: 'completed', conclusion: 'skipped' },
      { name: 'c', status: 'completed', conclusion: 'cancelled' },
      { name: 'd', status: 'completed', conclusion: 'timed_out' },
    ]
    const res = classifyCheckRuns(runs)
    expect(res.bad).toEqual(['c=cancelled', 'd=timed_out'])
  })

  it('reports a still-running check as pending, not as green', () => {
    expect(classifyCheckRuns([{ name: 'CI', status: 'in_progress' }]).pending).toEqual(['CI'])
  })
})

describe('preflightVerdict', () => {
  const green = [{ name: 'CI', status: 'completed', conclusion: 'success' }]

  it('passes a clean tree on origin/main with green CI, and fixes the target sha', () => {
    const v = preflightVerdict({ dirty: '', head: SHA, originMain: SHA, checkRuns: green })
    expect(v.ok).toBe(true)
    expect(v.sha).toBe(SHA)
    expect(v.errors).toEqual([])
  })

  it('REFUSES a dirty tree — prod ships committed main, never local edits', () => {
    const v = preflightVerdict({
      dirty: ' M src/app.ts',
      head: SHA,
      originMain: SHA,
      checkRuns: green,
    })
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/dirty/i)
  })

  it('REFUSES a sha with no CI run at all — absence of red is not green', () => {
    const v = preflightVerdict({ dirty: '', head: SHA, originMain: SHA, checkRuns: [] })
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/no CI check-runs/i)
  })

  it('REFUSES red CI and REFUSES still-running CI', () => {
    expect(
      preflightVerdict({
        dirty: '',
        head: SHA,
        originMain: SHA,
        checkRuns: [{ name: 'CI', status: 'completed', conclusion: 'failure' }],
      }).ok,
    ).toBe(false)
    expect(
      preflightVerdict({
        dirty: '',
        head: SHA,
        originMain: SHA,
        checkRuns: [{ name: 'CI', status: 'queued' }],
      }).ok,
    ).toBe(false)
  })

  it('--skip-ci-check is an escape hatch that WARNS loudly rather than going quiet', () => {
    const v = preflightVerdict({
      dirty: '',
      head: SHA,
      originMain: SHA,
      checkRuns: [],
      skipCi: true,
    })
    expect(v.ok).toBe(true)
    expect(v.warnings.join(' ')).toMatch(/skip-ci-check/i)
  })

  it('a HEAD other than origin/main is a WARNING, and origin/main is what ships', () => {
    // Deliberate: the tool must be runnable from the very branch that
    // introduces it. What ships is always origin/main's sha, never local HEAD —
    // so un-pushed local work can not reach prod, which is what makes the
    // divergence safe to merely warn about.
    const v = preflightVerdict({ dirty: '', head: OTHER, originMain: SHA, checkRuns: green })
    expect(v.ok).toBe(true)
    expect(v.sha).toBe(SHA)
    expect(v.warnings.join(' ')).toMatch(/origin\/main/)
  })
})

// ── remote scripts ───────────────────────────────────────────────────────────

describe('buildShipCommand', () => {
  const cmd = buildShipCommand()

  it('extracts into a fresh sibling tree and swaps it in — never over the live tree', () => {
    // `tar -xz` is additive: extracting ONTO the box's tree can only overwrite
    // and add, so a file retired in the branch survives every deploy (the trap
    // deploy/README.md recorded on 2026-07-30, and the red deploy of 2026-08-18
    // that #264 came from). Extract-and-swap removes the class structurally.
    expect(cmd).toContain('tar -xz -C ~/bbm-portal.next')
    expect(cmd).toContain('mv ~/bbm-portal.next ~/bbm-portal')
    expect(cmd).not.toMatch(/tar -xz -C ~\/bbm-portal(?![.\w])/)
  })

  it('fails closed rather than swapping a tree without the host-only .env.prod', () => {
    expect(cmd).toContain('set -eu')
    // `cp -n` / `cp -an` is documented non-portable (coreutils >= 9 warns): the
    // copy names the host-only files instead of relying on no-clobber.
    expect(cmd).not.toMatch(/cp -[a-z]*n/)
    expect(cmd).toMatch(/deploy\/\.env\.prod/)
    expect(cmd).toMatch(/exit 1/)
    // The assert stands BEFORE the swap: a tree that would lose the env files
    // is never moved into place.
    expect(cmd.indexOf('.env.prod')).toBeLessThan(cmd.indexOf('mv ~/bbm-portal.next'))
  })

  // ── the same contract, executed ────────────────────────────────────────────
  //
  // The strings above pin the shape; the tests below run the command for real
  // against a fixture tree under a fake $HOME, because the invariant that
  // matters is behavioural: what the box HOLDS after the step, not what the
  // step says.

  const sandboxes: string[] = []
  afterAll(() => {
    for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true })
  })

  type Tree = Record<string, string>
  type ShipResult = {
    status: number | null
    stderr: string
    exists: (rel: string) => boolean
    read: (rel: string) => string
  }

  /**
   * Run the ship command the way the box runs it — the archive on stdin, the
   * previous tree in place — and report what `~/bbm-portal` holds afterwards.
   *
   * Returns null when the machine has no bash (the same graceful skip the
   * `bash -n` block uses), so the suite stays runnable off Linux.
   */
  function ship(onBox: Tree, archive: Tree, { corrupt = false } = {}): ShipResult | null {
    const root = mkdtempSync(join(tmpdir(), 'bbm-ship-'))
    sandboxes.push(root)
    const put = (base: string, tree: Tree) => {
      for (const [rel, body] of Object.entries(tree)) {
        const file = join(root, base, rel)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, body)
      }
    }
    put('bbm-portal', onBox)
    put('commit', archive)

    // A corrupt feed stands in for every way the delivery can break mid-flight
    // (a dropped ssh, a truncated archive): tar exits non-zero, and the box
    // must still hold the tree it had.
    const feed = corrupt ? "printf 'this is not a tar archive'" : 'tar -cz -C "$HOME/commit" .'
    const res = spawnSync('bash', ['-s'], {
      cwd: root,
      encoding: 'utf8',
      input: `export HOME="$PWD"\n${feed} | {\n${cmd}\n}\n`,
    })
    if (res.error) return null // no bash on this machine — skip rather than fail
    const at = (rel: string) => join(root, 'bbm-portal', rel)
    return {
      status: res.status,
      stderr: res.stderr,
      exists: (rel) => existsSync(at(rel)),
      read: (rel) => readFileSync(at(rel), 'utf8'),
    }
  }

  /** The top-level directories the archive really ships, asked of git itself —
   *  a hand-kept constant goes stale the first time a directory is added. */
  function shippedTopLevelDirs(): string[] | null {
    const res = spawnSync('git', ['ls-tree', '--name-only', '-d', 'HEAD'], { encoding: 'utf8' })
    if (res.error || res.status !== 0) return null
    return res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  }

  it('replaces EVERY shipped top-level directory — a retired file cannot survive', () => {
    const dirs = shippedTopLevelDirs()
    if (!dirs) return // no git here — skip rather than fail
    expect(dirs).toContain('src')
    expect(dirs).toContain('tools')
    expect(dirs).toContain('tests')

    const onBox: Tree = { DEPLOYED_SHA: 'obsolete marker\n', 'deploy/.env.prod': 'SECRET=1\n' }
    const archive: Tree = { 'deploy/docker-compose.prod.yml': 'name: bbm-portal\n' }
    for (const dir of dirs) {
      if (dir === 'deploy') continue
      onBox[`${dir}/retired-in-the-branch.ts`] = 'import "@/lib/gone"\n'
      archive[`${dir}/still-shipped.ts`] = 'export const ok = true\n'
    }

    const out = ship(onBox, archive)
    if (!out) return
    expect(out.stderr + String(out.status)).toBe('0')
    for (const dir of dirs) {
      if (dir === 'deploy') continue
      expect(`${dir} retired: ${out.exists(`${dir}/retired-in-the-branch.ts`)}`).toBe(
        `${dir} retired: false`,
      )
      expect(`${dir} shipped: ${out.exists(`${dir}/still-shipped.ts`)}`).toBe(
        `${dir} shipped: true`,
      )
    }
    // The repo ROOT is covered too — the obsolete marker file is gone.
    expect(out.exists('DEPLOYED_SHA')).toBe(false)
  })

  it('copies ONLY the host-only deploy/.env* — a shipped file is never a candidate', () => {
    const out = ship(
      {
        'deploy/.env.prod': 'DATABASE_URL=x\n',
        'deploy/.env.postgres': 'POSTGRES_USER=y\n',
        'deploy/.env.preview': 'PAYLOAD_PREVIEW_TOKEN=z\n',
        'deploy/.env': 'DEPLOY_SHA=older\n',
        'deploy/.env.prod.example': 'STALE=1\n',
        'deploy/docker-compose.prod.yml': 'name: old\n',
      },
      {
        'deploy/docker-compose.prod.yml': 'name: new\n',
        'deploy/Caddyfile': 'cms.bbm.academy\n',
        'deploy/.env.prod.example': 'DATABASE_URL=\n',
      },
    )
    if (!out) return
    // Also proves the carry-over is warning-free: `cp -n` is non-portable and
    // coreutils >= 9 says so on stderr, which is why the copy names its files.
    expect(out.stderr + String(out.status)).toBe('0')
    expect(out.read('deploy/.env.prod')).toBe('DATABASE_URL=x\n')
    expect(out.read('deploy/.env.postgres')).toBe('POSTGRES_USER=y\n')
    expect(out.read('deploy/.env.preview')).toBe('PAYLOAD_PREVIEW_TOKEN=z\n')
    // compose's own interpolation source, written on the box by buildDeployScript
    expect(out.read('deploy/.env')).toBe('DEPLOY_SHA=older\n')
    // Everything the commit ships is the commit's, untouched by the copy — the
    // `.example` is the sharp case: it matches `.env.*` but IS shipped.
    expect(out.read('deploy/docker-compose.prod.yml')).toBe('name: new\n')
    expect(out.read('deploy/Caddyfile')).toBe('cms.bbm.academy\n')
    expect(out.read('deploy/.env.prod.example')).toBe('DATABASE_URL=\n')
  })

  it('carries nothing rather than tripping over an unmatched glob', () => {
    // A box whose deploy/ holds no `.env.*` at all: the glob stays literal, and
    // the step must reach its own fail-closed assert, not die on the `for`.
    const out = ship({ 'deploy/.env': 'DEPLOY_SHA=older\n' }, { 'src/app.ts': 'new\n' })
    if (!out) return
    expect(out.status).not.toBe(0)
    expect(out.stderr).toContain('SHIP ABORTED')
  })

  it('refuses the swap when the new tree would carry no deploy/.env.prod', () => {
    const out = ship({ 'src/app.ts': 'old\n' }, { 'src/app.ts': 'new\n' })
    if (!out) return
    expect(out.status).not.toBe(0)
    // Fail-closed: the box still holds exactly the tree it had.
    expect(out.read('src/app.ts')).toBe('old\n')
  })

  it('leaves the box its current tree when the extract fails mid-flight', () => {
    const out = ship(
      { 'src/app.ts': 'old\n', 'deploy/.env.prod': 'DATABASE_URL=x\n' },
      { 'src/app.ts': 'new\n' },
      { corrupt: true },
    )
    if (!out) return
    expect(out.status).not.toBe(0)
    expect(out.read('src/app.ts')).toBe('old\n')
    expect(out.read('deploy/.env.prod')).toBe('DATABASE_URL=x\n')
  })
})

describe('buildDeployScript', () => {
  const script = buildDeployScript(SHA)

  it('records DEPLOY_SHA without clobbering other interpolation vars', () => {
    expect(script).toContain(`DEPLOY_SHA=%s\\n' '${SHA}'`)
    expect(script).toContain("grep -v '^DEPLOY_SHA=' .env")
  })

  it('rebuilds the migrate image too — a stale tooling image is a SILENT no-op', () => {
    expect(script).toMatch(/--profile tools run --build --rm migrate/)
  })

  it('never lets `compose run` eat the rest of the script from stdin', () => {
    expect(script).toContain('</dev/null')
  })

  it('migrates BEFORE the new app starts serving', () => {
    expect(script.indexOf('migrate')).toBeLessThan(script.indexOf('up -d'))
  })

  it('builds app AND migrate, then brings the stack up', () => {
    expect(script).toMatch(/docker compose -f docker-compose\.prod\.yml build app migrate/)
    expect(script).toMatch(/docker compose -f docker-compose\.prod\.yml up -d/)
  })

  // ── the platform database (#125) ───────────────────────────────────────────

  it('applies the PLATFORM migrations too — the `core` schema is deployed, not hand-run', () => {
    // The second database (spec 2026-08-04 §4) has its own pipeline. If the
    // deploy did not run it, `core` would only ever advance when somebody
    // remembered to — which is the state this task exists to end.
    expect(script).toContain('pnpm platform:migrate')
  })

  it('runs the platform migrations INSIDE the checkpoint-protected window', () => {
    // `checkpoint` is a whole stage earlier in the pipeline, and everything in
    // this script therefore runs after it. The ordering below is what makes that
    // true of the platform migrate as well — it must not be bolted onto a later
    // stage where no fresh dump protects it.
    expect(DEPLOY_STAGES.indexOf('checkpoint')).toBeLessThan(DEPLOY_STAGES.indexOf('deployStack'))
    expect(script.indexOf('pnpm platform:migrate')).toBeLessThan(script.indexOf('up -d'))
  })

  it('reads the platform migration ledger from the `core` schema, not payload_migrations', () => {
    expect(script).toContain('core.__drizzle_migrations')
    expect(script).toContain('payload_migrations')
  })
})

// ── the cutover seam: `--hold-before-up` (#256, spec 124 EARS-13) ────────────

describe('buildDeployScript --hold-before-up', () => {
  const held = buildDeployScript(SHA, { holdBeforeUp: true })

  it('EARS-13: holds the stack BEFORE `up -d`, so no traffic meets an empty `core`', () => {
    // The cutover's whole ordering constraint (spec 124 EARS-13: checkpoint →
    // migrate → seed → import + verification → only then traffic) has no seam
    // in the normal pipeline, where `deployStack` migrates and brings the stack
    // up in ONE remote script. Holding is that seam.
    expect(held).not.toContain('up -d')
    expect(buildDeployScript(SHA)).toContain('up -d')
  })

  it('still builds the images and advances BOTH migration ledgers', () => {
    // A hold that skipped the migration would leave nothing for the window's
    // data step to write into: the schema must exist before it runs.
    expect(held).toMatch(/build app migrate/)
    expect(held).toContain('pnpm platform:migrate')
    expect(held).toContain('core.__drizzle_migrations')
    expect(held).toContain('payload_migrations')
  })

  it('writes DEPLOY_SHA exactly as the unheld script does', () => {
    // The re-run that brings traffic up builds the same tag; a divergence here
    // would make the held build unusable and cost a rebuild inside the window.
    expect(held).toContain(`DEPLOY_SHA=%s\\n' '${SHA}'`)
  })

  it('is the ONLY difference — everything before `up -d` is byte-identical', () => {
    const full = buildDeployScript(SHA)
    expect(full.startsWith(held)).toBe(true)
    expect(full.slice(held.length).trim()).toBe(
      "echo '-- up -d --'\ndocker compose -f docker-compose.prod.yml up -d",
    )
  })
})

describe('formatHoldNotice / HOLD_STAGES', () => {
  it('EARS-27: names the verify verdict the operator must read before traffic', () => {
    const notice = formatHoldNotice({ sha: SHA, prevSha: OTHER })
    expect(notice).toContain('platform:hours:verify')
    expect(notice).toContain('VERDICT: identical')
  })

  it('prints the next commands in window order: seed → verify → traffic', () => {
    // The import step went with the import command itself (#256): it ran once, on
    // 2026-08-18, and `core` has been the master since. What a held run still
    // offers is the idempotent seed and the read-only verdict.
    const notice = formatHoldNotice({ sha: SHA, prevSha: OTHER })
    const order = ['platform:member:seed', 'platform:hours:verify']
    let at = -1
    for (const needle of order) {
      const i = notice.indexOf(needle)
      expect(i).toBeGreaterThan(at)
      at = i
    }
    // The last step is the re-run WITHOUT the flag — the only thing that brings
    // traffic up. An operator who reads only this block must still finish.
    expect(notice.indexOf('pnpm deploy:prod')).toBeGreaterThan(at)
    expect(HOLD_NEXT_COMMANDS.at(-1)?.command).toBe('pnpm deploy:prod')
  })

  it('EARS-25: offers the rollback while the hold is in force', () => {
    // Nothing serves the new image yet, so the previous image is still a
    // complete answer for the APP. The notice says so rather than leaving the
    // operator to remember it inside the window — and, since #256, says equally
    // plainly that the /p/hours cutover itself is past its rollback window.
    const notice = formatHoldNotice({ sha: SHA, prevSha: OTHER })
    expect(notice).toContain(`--rollback ${OTHER.slice(0, 12)}`)
  })

  it('says plainly that prod still serves the previous image', () => {
    expect(formatHoldNotice({ sha: SHA, prevSha: OTHER })).toMatch(/previous image/i)
  })

  it('degrades honestly when the previous sha could not be read', () => {
    const notice = formatHoldNotice({ sha: SHA, prevSha: null })
    expect(notice).toContain('--rollback <previous sha>')
  })

  it('points at the runbook that owns the full procedure', () => {
    expect(formatHoldNotice({ sha: SHA, prevSha: OTHER })).toContain(
      'docs/runbooks/hours-core-cutover.md',
    )
  })

  it('HOLD_STAGES is a prefix of DEPLOY_STAGES ending at deployStack', () => {
    // Held is a TRUNCATION of the pipeline, not a different one: every stage it
    // runs is the same stage in the same order. A stage inserted before
    // `deployStack` therefore cannot silently skip the held path.
    expect(DEPLOY_STAGES.slice(0, HOLD_STAGES.length)).toEqual(HOLD_STAGES)
    expect(HOLD_STAGES.at(-1)).toBe('deployStack')
  })
})

describe('buildVerifyScript / verifyVerdict', () => {
  it('asks the box for the running container’s image tag and state', () => {
    const script = buildVerifyScript(SHA)
    expect(script).toContain('bbm-portal-app-1')
    expect(script).toContain('{{.Config.Image}}')
    expect(script).toContain(`bbm-portal-app:${SHA}`)
  })

  it('accepts only an OK line naming the deployed image', () => {
    expect(verifyVerdict(`OK image=bbm-portal-app:${SHA} state=running`, SHA).ok).toBe(true)
  })

  it('REFUSES a timeout, an absent container, or the previous image', () => {
    expect(verifyVerdict(`TIMEOUT image=bbm-portal-app:${OTHER} state=running`, SHA).ok).toBe(false)
    expect(verifyVerdict('TIMEOUT image=absent state=absent', SHA).ok).toBe(false)
    expect(verifyVerdict('', SHA).ok).toBe(false)
    // A success line the box does not back would be a lie — the whole point.
    expect(verifyVerdict(`OK image=bbm-portal-app:${OTHER} state=running`, SHA).ok).toBe(false)
  })
})

describe('caddyNeedsRestart', () => {
  it('restarts when the running mount differs from the shipped Caddyfile', () => {
    // `up -d caddy` does NOT pick up a bind-mounted config change and
    // `caddy reload` reports "config is unchanged" — the runbook's trap.
    expect(caddyNeedsRestart('caddy=mismatch')).toBe(true)
  })

  it('does not restart when they already match', () => {
    expect(caddyNeedsRestart('caddy=match')).toBe(false)
  })

  it('treats unreadable output as stale — fail-closed, not fail-quiet', () => {
    expect(caddyNeedsRestart('')).toBe(true)
    expect(caddyNeedsRestart('docker: command not found')).toBe(true)
  })
})

describe('buildRetentionScript', () => {
  it('keeps the last N sha tags and never prunes the :local fallback', () => {
    const script = buildRetentionScript()
    expect(script).toContain('bbm-portal-app')
    expect(script).toContain(String(IMAGE_RETENTION))
    expect(script).toMatch(/grep -v/)
    expect(script).toContain('local')
  })

  it('treats "nothing to prune" as success, not as a failed deploy', () => {
    // Under `set -o pipefail` a grep that filters every line exits 1.
    expect(buildRetentionScript()).toContain('|| true')
  })
})

// ── pre-migrate checkpoint (#156) ────────────────────────────────────────────

describe('buildCheckpointScript', () => {
  const script = buildCheckpointScript(SHA)

  it('runs the backup script the `bbm` ops repo installed on the box', () => {
    expect(CHECKPOINT_SCRIPT).toBe('/home/deploy/portal-backup/backup-portal.sh')
    expect(script).toContain(`bash ${CHECKPOINT_SCRIPT}`)
    // rclone is a user-local binary (~/.local/bin) — not on a non-interactive
    // ssh PATH. The ops script self-heals this for itself; our own rclone call
    // needs the same treatment.
    expect(script).toContain('export PATH="$HOME/.local/bin:$PATH"')
  })

  it('REFUSES when the script is absent — a missing checkpoint is not "no changes"', () => {
    // The whole value of this stage is that it fails BEFORE the migrate. A box
    // where the ops repo never installed (or someone removed) the script must
    // abort the deploy, not sail past it silently.
    expect(script).toMatch(/\[ ! -f/)
    expect(script).toMatch(/exit 1/)
    expect(script.indexOf('exit 1')).toBeLessThan(script.indexOf(`bash ${CHECKPOINT_SCRIPT}`))
  })

  it('keeps the channel talking while the script runs silently', () => {
    // The ops script does `exec >> "$LOG" 2>&1`: the ssh channel gets ZERO bytes
    // for the whole run. Without a heartbeat the inactivity watchdog degenerates
    // into a hard wall-clock timeout that would `child.kill()` a backup
    // mid-flight and fail a deploy that was fine.
    expect(script).toMatch(new RegExp(`sleep ${CHECKPOINT_KEEPALIVE_S}`))
    expect(script).toMatch(/\[checkpoint\].*running/)
    expect(script).toMatch(/kill "?\$keepalive/)
    expect(script).toMatch(/trap /)
    // …and the budget is stated explicitly rather than inherited, with room for
    // several missed beats.
    expect(STALL_BUDGET_CHECKPOINT_MS).toBeGreaterThan(CHECKPOINT_KEEPALIVE_S * 1000 * 3)
  })

  it('ASSERTS a fresh dump artifact — exit 0 is not proof a dump exists', () => {
    // `[ -f <script> ]` plus exit 0 also passes for a zero-byte script. The
    // stage's whole claim is "a fresh dump exists before we migrate", so it
    // checks the artifact's mtime, not the exit code.
    expect(script).toMatch(new RegExp(`-name '${CHECKPOINT_DUMP_GLOB.replace('*', '\\*')}'`))
    expect(script).toMatch(/-mmin -\d+/)
    expect(script).toMatch(/no fresh dump/i)
  })

  // ── two databases, one checkpoint (#125) ───────────────────────────────────

  it('pins EVERY fresh dump, not just the newest one', () => {
    // Until #125 the box produced exactly one artifact and this stage pinned
    // `… | sort | tail -1`. The `platform` database makes that a silent
    // half-checkpoint: the newest file wins and the other database's dump is
    // dropped on the floor. The glob is therefore database-agnostic and the pin
    // is a LOOP.
    expect(CHECKPOINT_DUMP_GLOB).toBe('*.sql.gz')
    expect(script).not.toMatch(/\|\s*tail -1/)
    expect(script).toMatch(/while .*read/)
  })

  it('names the cross-repo dependency instead of dumping anything itself', () => {
    // `backup-portal.sh` belongs to the `bbm` ops repo and today dumps `cms`
    // only; extending it to `platform` is tracked there. This stage must not
    // grow its own pg_dump — it would become a second, drifting implementation
    // of the backup contract.
    expect(script).not.toContain('pg_dump')
    expect(script).toContain('bbm')
  })

  it('WARNS, loudly and by name, about a database the box did not dump', () => {
    // Loose on purpose: prod carries no `platform` dump until the bbm-side
    // change lands, and hard-failing here would block every deploy in the
    // meantime. A named warning is the honest middle — the deploy proceeds, and
    // nobody can later claim the gap was invisible.
    expect(CHECKPOINT_EXPECTED_DATABASES).toEqual(['cms', 'platform'])
    for (const database of CHECKPOINT_EXPECTED_DATABASES) {
      expect(script).toContain(database)
    }
    expect(script).toMatch(/WARNING/)
  })

  it('decides coverage PER DATABASE, never by counting files', () => {
    // Review finding: counting `pinned -lt 2` claims databases but measures
    // files, so any second fresh *.sql.gz — a manual dump, a retry artifact, a
    // future `zitadel` dump — silences the warning while `platform` is still
    // uncovered. That is the exact gap the warning exists to expose.
    expect(script).not.toMatch(/\$pinned["' ]*-lt/)
    for (const { database, markers } of CHECKPOINT_EXPECTED_DUMPS) {
      expect(script).toContain(`covered_${database}`)
      for (const marker of markers) expect(script).toContain(marker)
    }
  })

  it('says the coverage is matched by FILENAME, not verified against the server', () => {
    // The dump→database naming contract belongs to the ops repo; until it is
    // fixed there, a filename match is a heuristic and must read as one.
    expect(script).toMatch(/filename/i)
    expect(script).toContain('bbm#112')
  })

  it('PINS the dump under a per-deploy S3 key so the nightly cannot overwrite it', () => {
    // `backup-portal.sh` names its artifact by calendar DAY
    // (postgres-YYYYMMDD.sql.gz) and pushes it to a flat key, so the 23:30 UTC
    // nightly — or a second deploy the same day — overwrites the checkpoint that
    // protected this migration. Copying it to a distinct key is what makes the
    // recovery point outlive the day.
    expect(script).toContain('rclone copyto')
    expect(script).toContain('checkpoints/pre-migrate-')
    expect(script).toContain(SHA.slice(0, 12))
    expect(script).toMatch(/date -u \+%Y%m%dT%H%M%SZ/)
    // Same remote and credentials file the ops repo's own restore-portal.sh uses.
    expect(script).toContain('twcs:')
    expect(script).toContain('.s3-backup.env')
    expect(script).toMatch(/set -a; \. /)
  })

  it('never echoes a credential', () => {
    // The env file carries account-level S3 keys. The script prints the KEY it
    // pinned (useful) and nothing that came out of the env file.
    expect(script).not.toMatch(/echo[^\n]*\$S3_/)
    expect(script).not.toContain('S3_ACCESS_KEY')
    expect(script).not.toContain('S3_SECRET')
  })
})

describe('formatCheckpointFailure', () => {
  it('states that nothing was migrated and points at the `bbm` runbook', () => {
    const msg = formatCheckpointFailure('checkpoint on portal-prod-tw exited 1')
    expect(msg).toMatch(/checkpoint on portal-prod-tw exited 1/)
    expect(msg).toMatch(/NOTHING was migrated/i)
    // The script and its cron are owned by the `bbm` ops repo — this repo points
    // there rather than restating the procedure (path is the contract).
    expect(msg).toContain('bbm')
    expect(msg).toContain('infra/portal/README.md')
  })

  it('names the log the reason is actually in', () => {
    // `exec >> "$LOG" 2>&1` inside the ops script means the ssh channel carries
    // no diagnostics at all: without this path the operator gets "exited 1" and
    // nothing else.
    expect(formatCheckpointFailure('exited 1')).toContain(CHECKPOINT_LOG)
    expect(CHECKPOINT_LOG).toBe('/home/deploy/portal-backup/data/backup.log')
  })
})

describe('every generated remote script is valid bash', () => {
  // These strings are executed on the box by `bash --norc -euo pipefail -c`, so
  // a syntax error is discovered mid-deploy and nowhere else. Cheap to prevent:
  // the checkpoint stage now contains a `while read` + here-string, the first
  // non-trivial control flow in this family.
  const scripts: Array<[string, string]> = [
    ['buildShipCommand', buildShipCommand()],
    ['buildEnvPreflightScript', buildEnvPreflightScript()],
    ['buildCheckpointScript', buildCheckpointScript(SHA)],
    ['buildDeployScript', buildDeployScript(SHA)],
    ['buildDeployScript --hold-before-up', buildDeployScript(SHA, { holdBeforeUp: true })],
    ['buildVerifyScript', buildVerifyScript(SHA)],
    ['buildCaddyComparisonScript', buildCaddyComparisonScript()],
    ['buildCaddyRestartScript', buildCaddyRestartScript()],
    ['buildRetentionScript', buildRetentionScript()],
  ]

  it.each(scripts)('%s parses under `bash -n`', (_name, script) => {
    const res = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })
    if (res.error) return // no bash on this machine — skip rather than fail
    expect(res.stderr.trim()).toBe('')
    expect(res.status).toBe(0)
  })
})

describe('buildEnvPreflightScript / formatEnvPreflightFailure', () => {
  const script = buildEnvPreflightScript()

  it('requires the connection strings the `migrate` service reads from .env.prod', () => {
    expect(REQUIRED_PROD_ENV_VARS).toContain('DATABASE_URL')
    expect(REQUIRED_PROD_ENV_VARS).toContain('PLATFORM_DATABASE_URL')
    for (const name of REQUIRED_PROD_ENV_VARS) expect(script).toContain(name)
  })

  it('matches an assignment at line start — a mention in a comment is not a value', () => {
    expect(script).toMatch(/grep -q ['"]\^/)
    expect(script).toContain('.env.prod')
  })

  it('fails the step rather than reporting a state it did not verify', () => {
    expect(script).toMatch(/exit 1/)
    expect(script).toMatch(/-f .*\.env\.prod|! -f/)
  })

  it('the abort names the remedy and states nothing was touched', () => {
    const msg = formatEnvPreflightFailure('PLATFORM_DATABASE_URL missing')
    expect(msg).toContain('PLATFORM_DATABASE_URL missing')
    expect(msg).toMatch(/nothing was shipped|NOTHING/i)
    expect(msg).toContain('deploy/.env.prod')
    expect(msg).toContain('deploy/README.md')
  })
})

describe('formatDryRunPlan', () => {
  const plan = formatDryRunPlan(SHA)

  it('prints the checkpoint plan like every other remote step', () => {
    expect(plan).toContain('[checkpoint]')
    expect(plan).toContain(CHECKPOINT_SCRIPT)
  })

  it('shows the env preflight first among the remote steps', () => {
    expect(plan).toContain('[verifyRemoteEnv]')
    expect(plan.indexOf('[verifyRemoteEnv]')).toBeLessThan(plan.indexOf('[ship]'))
  })

  it('shows the checkpoint before the stack — the order it really runs in', () => {
    expect(plan.indexOf('[checkpoint]')).toBeGreaterThan(plan.indexOf('[ship]'))
    expect(plan.indexOf('[checkpoint]')).toBeLessThan(plan.indexOf('[deployStack]'))
  })
})

// ── rollback ─────────────────────────────────────────────────────────────────

describe('formatDryRunPlan --hold-before-up', () => {
  const plan = formatDryRunPlan(SHA, { holdBeforeUp: true })

  it('shows the HELD stack script and stops the plan there', () => {
    expect(plan).toContain('[deployStack]')
    expect(plan).not.toContain('[smoke]')
    expect(plan).not.toContain('[applyCaddy]')
  })

  it('EARS-27: ends with what the operator does next, verdict included', () => {
    expect(plan).toContain('platform:hours:verify')
    expect(plan).toContain('VERDICT: identical')
  })
})

describe('parseRollbackSha', () => {
  it('accepts a sha and rejects a ref name', () => {
    expect(parseRollbackSha(SHA)).toMatchObject({ ok: true, sha: SHA })
    expect(parseRollbackSha('main').ok).toBe(false)
    expect(parseRollbackSha(undefined).ok).toBe(false)
    expect(parseRollbackSha('').ok).toBe(false)
  })
})

// ── the fail-closed contract ─────────────────────────────────────────────────

describe('runDeploy — stops at the first red step and records nothing', () => {
  function stubs(overrides: Record<string, unknown> = {}) {
    const order: string[] = []
    const make = (name: string) =>
      vi.fn(async () => {
        order.push(name)
      })
    const steps = {
      preflight: vi.fn(async () => {
        order.push('preflight')
        return SHA
      }),
      readPrevSha: vi.fn(async () => {
        order.push('readPrevSha')
        return OTHER
      }),
      verifyRemoteEnv: make('verifyRemoteEnv'),
      ship: make('ship'),
      checkpoint: make('checkpoint'),
      deployStack: make('deployStack'),
      applyCaddy: make('applyCaddy'),
      verifyRunningSha: make('verifyRunningSha'),
      prune: make('prune'),
      smoke: make('smoke'),
      cutRelease: make('cutRelease'),
      recordDeployment: make('recordDeployment'),
      log: () => {},
      ...overrides,
    }
    return { steps, order }
  }

  it('runs the stages in the documented order on the happy path', async () => {
    const { steps, order } = stubs()
    await runDeploy(steps)
    expect(order).toEqual([
      'preflight',
      'readPrevSha',
      'verifyRemoteEnv',
      'ship',
      'checkpoint',
      'deployStack',
      'applyCaddy',
      'verifyRunningSha',
      'smoke',
      'cutRelease',
      'recordDeployment',
      'prune',
    ])
  })

  it('EARS-13: --hold-before-up stops after deployStack and brings nothing up', async () => {
    const { steps, order } = stubs()
    const res = await runDeploy(steps, { holdBeforeUp: true })
    expect(order).toEqual(HOLD_STAGES)
    expect(res.held).toBe(true)
    // Everything downstream of the hold would either serve the new image or
    // assert that it serves correctly. Neither is true yet.
    expect(steps.applyCaddy).not.toHaveBeenCalled()
    expect(steps.verifyRunningSha).not.toHaveBeenCalled()
    expect(steps.smoke).not.toHaveBeenCalled()
    expect(steps.cutRelease).not.toHaveBeenCalled()
    expect(steps.recordDeployment).not.toHaveBeenCalled()
    expect(steps.prune).not.toHaveBeenCalled()
  })

  it('EARS-13: the held run passes the flag down to the stack stage', async () => {
    const { steps } = stubs()
    await runDeploy(steps, { holdBeforeUp: true })
    expect(steps.deployStack).toHaveBeenCalledWith(SHA, { holdBeforeUp: true })
  })

  it('EARS-13: still checkpoints before it migrates, held or not', async () => {
    const { steps, order } = stubs()
    await runDeploy(steps, { holdBeforeUp: true })
    expect(order.indexOf('checkpoint')).toBeLessThan(order.indexOf('deployStack'))
  })

  it('prints the next commands when it holds, and nothing when it does not', async () => {
    const heldLog: string[] = []
    const { steps: heldSteps } = stubs({ log: (m: string) => heldLog.push(m) })
    await runDeploy(heldSteps, { holdBeforeUp: true })
    expect(heldLog.join('\n')).toContain('VERDICT: identical')

    const plainLog: string[] = []
    const { steps: plainSteps } = stubs({ log: (m: string) => plainLog.push(m) })
    await runDeploy(plainSteps)
    expect(plainLog.join('\n')).not.toContain('VERDICT: identical')
  })

  it('an unheld re-run is the FULL pipeline again — that is how traffic comes up', async () => {
    // The documented cutover ends with a plain `pnpm deploy:prod`. It repeats
    // every stage: preflight, ship, a SECOND checkpoint (pinned under its own
    // key, overwriting nothing), both migrations (idempotent ledgers), then
    // `up -d`. Nothing about the held run marks the box as half-deployed.
    const { steps, order } = stubs()
    const res = await runDeploy(steps)
    expect(order).toEqual(DEPLOY_STAGES)
    expect(res.held).toBeFalsy()
  })

  it('prunes AFTER the smoke — destructive housekeeping never precedes the proof', async () => {
    const { steps, order } = stubs()
    await runDeploy(steps)
    expect(order.indexOf('smoke')).toBeLessThan(order.indexOf('prune'))
  })

  it('checkpoints the database BEFORE the stage that migrates it', async () => {
    // #156 acceptance: `deploy:prod` takes (or verifies) a checkpoint before
    // running migrations. Ordered after `ship` so the box already carries the
    // tree, and before `deployStack` — the stage that applies the migration.
    const { steps, order } = stubs()
    await runDeploy(steps)
    expect(order.indexOf('checkpoint')).toBeGreaterThan(order.indexOf('ship'))
    expect(order.indexOf('checkpoint')).toBeLessThan(order.indexOf('deployStack'))
    expect(DEPLOY_STAGES.indexOf('checkpoint')).toBe(DEPLOY_STAGES.indexOf('deployStack') - 1)
    // The sha names the recovery point it pins, so it must reach the stage.
    expect(steps.checkpoint).toHaveBeenCalledWith(SHA)
  })

  // ── the box's env contract (#125, review blocker 2) ────────────────────────

  it('verifies the box env BEFORE anything on the box is touched', async () => {
    // The `migrate` service gets PLATFORM_DATABASE_URL from `deploy/.env.prod`,
    // which is host-only and will not carry it until an operator adds it. Under
    // `bash -euo pipefail` the platform-migrate line would then abort the stack
    // stage AFTER the checkpoint and Payload's migration and BEFORE `up -d` —
    // a failed deploy of the repo's own fail-closed pipeline, needing an
    // operator on the box to recover. So the check runs before `ship`: nothing
    // is shipped, nothing is dumped, nothing is migrated.
    const { steps, order } = stubs()
    await runDeploy(steps)
    expect(order.indexOf('verifyRemoteEnv')).toBeLessThan(order.indexOf('ship'))
    expect(order.indexOf('verifyRemoteEnv')).toBeLessThan(order.indexOf('checkpoint'))
    expect(DEPLOY_STAGES.indexOf('verifyRemoteEnv')).toBeLessThan(DEPLOY_STAGES.indexOf('ship'))
  })

  it('a missing var on the box aborts before the tree is even shipped', async () => {
    const { steps, order } = stubs({
      verifyRemoteEnv: vi.fn(async () => {
        order.push('verifyRemoteEnv')
        throw new Error('PLATFORM_DATABASE_URL missing from deploy/.env.prod')
      }),
    })
    await expect(runDeploy(steps)).rejects.toThrow('PLATFORM_DATABASE_URL')
    expect(order).toEqual(['preflight', 'readPrevSha', 'verifyRemoteEnv'])
    expect(steps.ship).not.toHaveBeenCalled()
    expect(steps.checkpoint).not.toHaveBeenCalled()
    expect(steps.deployStack).not.toHaveBeenCalled()
  })

  it('a failing checkpoint aborts — nothing migrates without a fresh dump', async () => {
    // Fail-closed, and fatal by contract: this stage sits above the
    // "prod is proven serving" line precisely because it protects the migrate.
    const { steps } = stubs({
      checkpoint: vi.fn(async () => {
        throw new Error('checkpoint on portal-prod-tw exited 1')
      }),
    })
    await expect(runDeploy(steps)).rejects.toThrow(/checkpoint/i)
    expect(steps.deployStack).not.toHaveBeenCalled()
    expect(steps.applyCaddy).not.toHaveBeenCalled()
    expect(steps.smoke).not.toHaveBeenCalled()
    expect(steps.cutRelease).not.toHaveBeenCalled()
    expect(steps.recordDeployment).not.toHaveBeenCalled()
  })

  it.each(NON_FATAL_STAGES)(
    'a failing `%s` does NOT fail a deploy already serving',
    async (stage) => {
      // Everything after the smoke runs when prod is already verified serving the
      // new image. Image retention in particular is housekeeping: a host without
      // `grep -P`, or a pipefail exit from a filter that matched nothing, must
      // never print DEPLOY FAILED for a deploy that succeeded.
      const { steps } = stubs({
        [stage]: vi.fn(async () => {
          throw new Error(`${stage} blew up`)
        }),
      })
      await expect(runDeploy(steps)).resolves.toMatchObject({ sha: SHA })
    },
  )

  it('a failing cutRelease still lets the Deployment record (and the digest) happen', async () => {
    const { steps } = stubs({
      cutRelease: vi.fn(async () => {
        throw new Error('gh release create 403')
      }),
    })
    await runDeploy(steps)
    expect(steps.recordDeployment).toHaveBeenCalled()
    expect(steps.prune).toHaveBeenCalled()
  })

  it('DEPLOY_STAGES is that same order — the doc and the code cannot drift', () => {
    const { steps, order } = stubs()
    return runDeploy(steps).then(() => expect(order).toEqual(DEPLOY_STAGES))
  })

  it('a RED smoke aborts: no release tag, no Deployment record', async () => {
    // This is acceptance criterion 2 of #137. Prod is running the new code at
    // this point — "no half-state" means the pipeline does not go on to declare
    // a release nobody validated, and does not hand-patch the box. The operator
    // is left with one decision: roll back, or fix forward.
    const { steps } = stubs({
      smoke: vi.fn(async () => {
        throw new Error('prod smoke RED')
      }),
    })
    await expect(runDeploy(steps)).rejects.toThrow(/smoke/i)
    expect(steps.cutRelease).not.toHaveBeenCalled()
    expect(steps.recordDeployment).not.toHaveBeenCalled()
  })

  it('a failed verify aborts BEFORE the smoke and before any record', async () => {
    const { steps } = stubs({
      verifyRunningSha: vi.fn(async () => {
        throw new Error('running container does not carry the deployed sha')
      }),
    })
    await expect(runDeploy(steps)).rejects.toThrow(/deployed sha/)
    expect(steps.smoke).not.toHaveBeenCalled()
    expect(steps.prune).not.toHaveBeenCalled()
    expect(steps.cutRelease).not.toHaveBeenCalled()
    expect(steps.recordDeployment).not.toHaveBeenCalled()
  })

  it('a failed pre-flight ships NOTHING', async () => {
    const { steps } = stubs({
      preflight: vi.fn(async () => {
        throw new Error('working tree is dirty')
      }),
    })
    await expect(runDeploy(steps)).rejects.toThrow(/dirty/)
    expect(steps.ship).not.toHaveBeenCalled()
    expect(steps.deployStack).not.toHaveBeenCalled()
  })

  it('threads the previous sha AND the actual release result into the record', async () => {
    // `readPrevSha` was dead code while the record re-derived everything itself.
    // The previous sha is the rollback pointer a later reader needs, and the
    // release comes from the cut that just ran — not from a fresh `gh release
    // list`, which names the wrong tag whenever the cut was skipped.
    const release = { cut: true, tag: 'release-2026.08.05-1', reason: 'x' }
    const { steps } = stubs({ cutRelease: vi.fn(async () => release) })
    await runDeploy(steps)
    expect(steps.recordDeployment).toHaveBeenCalledWith({ prevSha: OTHER, sha: SHA, release })
  })

  it('records even when the release cut returned nothing to record', async () => {
    const { steps } = stubs({
      cutRelease: vi.fn(async () => ({ cut: false, reason: 'empty range' })),
    })
    await runDeploy(steps)
    expect(steps.recordDeployment).toHaveBeenCalledWith({
      prevSha: OTHER,
      sha: SHA,
      release: { cut: false, reason: 'empty range' },
    })
  })
})

describe('runRollback — an app swap, not a schema change', () => {
  function stubs(overrides: Record<string, unknown> = {}) {
    const order: string[] = []
    const make = (name: string) =>
      vi.fn(async () => {
        order.push(name)
      })
    const steps = {
      resolveTarget: vi.fn(async () => {
        order.push('resolveTarget')
        return SHA
      }),
      readPrevSha: vi.fn(async () => {
        order.push('readPrevSha')
        return OTHER
      }),
      ensureImagePresent: make('ensureImagePresent'),
      swapImage: make('swapImage'),
      verifyRunningSha: make('verifyRunningSha'),
      smoke: make('smoke'),
      recordRollback: make('recordRollback'),
      // Present so the assertion below is about behaviour, not about a typo:
      // if a future edit wires the checkpoint into the rollback path, this spy
      // records it.
      checkpoint: make('checkpoint'),
      log: () => {},
      ...overrides,
    }
    return { steps, order }
  }

  it('takes NO checkpoint — a rollback runs no migration to protect', async () => {
    const { steps } = stubs()
    await runRollback(steps)
    expect(steps.checkpoint).not.toHaveBeenCalled()
    expect(ROLLBACK_STAGES).not.toContain('checkpoint')
    // …because it runs no migrating stage either: `up -d app` on a retained
    // image, no rebuild, no `migrate`, no DB touch.
    expect(ROLLBACK_STAGES).not.toContain('deployStack')
  })

  it('runs its stages in the documented order', async () => {
    const { steps, order } = stubs()
    await runRollback(steps)
    expect(order).toEqual(ROLLBACK_STAGES)
  })

  it('a red smoke aborts the rollback before any record is written', async () => {
    const { steps } = stubs({
      smoke: vi.fn(async () => {
        throw new Error('prod smoke RED')
      }),
    })
    await expect(runRollback(steps)).rejects.toThrow(/smoke/i)
    expect(steps.recordRollback).not.toHaveBeenCalled()
  })

  it('records the rollback with the sha it REPLACED as the previous one', async () => {
    const { steps } = stubs()
    await runRollback(steps)
    expect(steps.recordRollback).toHaveBeenCalledWith({ prevSha: OTHER, sha: SHA })
  })

  it('a failing record does not fail a rollback that already took', async () => {
    const { steps } = stubs({
      recordRollback: vi.fn(async () => {
        throw new Error('gh api 403')
      }),
    })
    await expect(runRollback(steps)).resolves.toMatchObject({ sha: SHA })
  })
})

describe('createStallWatchdog / formatStallMessage', () => {
  it('fires once past the budget, and the message routes to a box-reality check', () => {
    // A tripped watchdog proves the LOCAL channel went quiet — not that the
    // remote docker build failed. Telling the operator to verify before
    // re-running or rolling back is the whole point of the wording.
    vi.useFakeTimers()
    try {
      const seen: string[] = []
      const wd = createStallWatchdog({
        label: 'stack deploy',
        budgetMs: 1000,
        host: 'portal-prod-tw',
        onStall: (m: string) => seen.push(m),
      })
      vi.advanceTimersByTime(1500)
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatch(/STALLED: stack deploy/)
      expect(seen[0]).toMatch(/deploy:smoke/)
      // Never twice — one loud line, not a stream.
      wd.touch()
      vi.advanceTimersByTime(5000)
      expect(seen).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('output resets the timer — a slow but talking build is not a stall', () => {
    vi.useFakeTimers()
    try {
      const seen: string[] = []
      const wd = createStallWatchdog({
        label: 'stack deploy',
        budgetMs: 1000,
        host: 'h',
        onStall: (m: string) => seen.push(m),
      })
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(900)
        wd.touch()
      }
      expect(seen).toHaveLength(0)
      wd.stop()
      vi.advanceTimersByTime(10000)
      expect(seen).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('names the budget in minutes', () => {
    expect(formatStallMessage('x', 10 * 60 * 1000, 'h')).toContain('no output for 10m')
  })
})

// ── flag precedence (#260 review, BLOCKER) ───────────────────────────────────

describe('resolveMode — which pipeline a command line asks for', () => {
  it('--dry-run wins over everything: a preview never touches prod', () => {
    // The regression this pins: `--rollback <sha> --dry-run` ran the REAL
    // rollback, whose third stage rewrites `deploy/.env` and `up -d app` on
    // production — no prompt, no confirmation. A flag whose whole contract is
    // "touch nothing" must be read before any flag that acts.
    expect(resolveMode(['--dry-run'])).toMatchObject({ mode: 'dry-run' })
    expect(resolveMode(['--dry-run', '--hold-before-up'])).toMatchObject({
      mode: 'dry-run',
      holdBeforeUp: true,
    })
  })

  it('refuses --dry-run together with --rollback instead of silently picking one', () => {
    // Both orders, because an operator's muscle memory decides the order and a
    // silent winner is exactly what made the blocker invisible.
    for (const argv of [
      ['--rollback', 'a'.repeat(40), '--dry-run'],
      ['--dry-run', '--rollback', 'a'.repeat(40)],
    ]) {
      const verdict = resolveMode(argv)
      expect(verdict.mode).toBe('refuse')
      expect(verdict.error).toMatch(/--dry-run/)
      expect(verdict.error).toMatch(/--rollback/)
    }
  })

  it('refuses --rollback together with --hold-before-up — opposite operations', () => {
    const verdict = resolveMode(['--rollback', 'a'.repeat(40), '--hold-before-up'])
    expect(verdict.mode).toBe('refuse')
    expect(verdict.error).toMatch(/--hold-before-up/)
  })

  it('reads the rollback argument as the token after the flag', () => {
    expect(resolveMode(['--rollback', SHA])).toMatchObject({ mode: 'rollback', rollbackArg: SHA })
  })

  it('a bare invocation is the full deploy, and --hold-before-up truncates it', () => {
    expect(resolveMode([])).toMatchObject({ mode: 'deploy', holdBeforeUp: false })
    expect(resolveMode(['--hold-before-up'])).toMatchObject({
      mode: 'deploy',
      holdBeforeUp: true,
    })
  })

  it('ignores flags it does not know (--skip-ci-check is read elsewhere)', () => {
    expect(resolveMode(['--skip-ci-check'])).toMatchObject({ mode: 'deploy' })
  })
})

describe('formatHoldNotice — the compose verbs allowed while held', () => {
  const notice = formatHoldNotice({ sha: SHA, prevSha: OTHER })

  it('forbids bringing ANY service up while the hold is in force', () => {
    // `deploy/.env` already names the new sha and the new image is built, so
    // `up -d preview` (a documented recipe in deploy/README.md) starts `app`
    // with it — `preview` and `caddy` both `depends_on: app`. That is the exact
    // state the hold exists to prevent, one unrelated command away.
    expect(notice).toMatch(/no `docker compose up -d`/i)
    expect(notice).toMatch(/preview/)
    expect(notice).toMatch(/caddy/)
  })

  it('names the only two compose verbs the window uses', () => {
    expect(notice).toContain('--profile tools run --rm')
    expect(notice).toContain('exec -T postgres')
  })
})
