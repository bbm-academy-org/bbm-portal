#!/usr/bin/env node
// bbm-portal — dev-stand DX launcher (portable, cross-platform).
//
// Backs the `pnpm dev:*` scripts. Reads the personal `.env.local`, picks a
// transport, and drives `docker compose` against the dev-stand (project
// `bbm-portal-dev`). The same `.env.local` is the single secret source for
// compose interpolation (POSTGRES_PASSWORD, IDP_SECRET_KEY, …). Two recipes are
// supported from one launcher:
//
//   - SSH recipe   (DEV_SSH_HOST set)  — syncs infra/dev-stand/ to the remote
//                                        box, ships .env.local there as the
//                                        compose `.env`, and runs `docker
//                                        compose` over the native ssh client.
//   - host-only    (DEV_SSH_HOST empty)— runs `docker compose` on the local
//                                        Docker daemon, passing the parsed
//                                        `.env.local` through the subprocess env.
//
// Thin port of the ds-platform launcher: only the commands the portal stand needs
// (up/down/status/logs/restart/config) — no ZFS snapshot/rollback or per-branch DB
// (this stand is Postgres + the Zitadel trio, no dataset topology to manage).

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const STAND_DIR = join(REPO_ROOT, 'infra', 'dev-stand')

const COMMANDS = ['up', 'down', 'status', 'logs', 'restart', 'config']

function fail(msg) {
  console.error(`dev: ${msg}`)
  process.exit(1)
}

function usage() {
  console.error(
    [
      'Usage: node tools/dev/run.mjs <command> [args]   (via `pnpm dev:<command>`)',
      '',
      '  up                 sync the contract + start the dev-stand (detached)',
      '  down               stop the dev-stand (volumes preserved)',
      '  status             list dev-stand containers',
      '  logs [service]     follow logs (all services, or one)',
      '  restart [service]  restart all services, or one',
      '  config             validate compose + required-secret interpolation (no up)',
    ].join('\n'),
  )
  process.exit(2)
}

// --- env -------------------------------------------------------------------

function loadEnv() {
  const candidates = [
    process.env.BBM_PORTAL_ENV_FILE,
    join(homedir(), '.bbm-portal', '.env.local'),
    join(STAND_DIR, '.env.local'),
  ].filter(Boolean)
  const file = candidates.find((p) => existsSync(p))
  if (!file) {
    fail(
      `no .env.local found. Looked in:\n  ${candidates.join('\n  ')}\n` +
        'Copy infra/dev-stand/.env.example to ~/.bbm-portal/.env.local and fill it in.',
    )
  }
  const env = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return { file, env }
}

// Resolve the active recipe config from .env.local. Memoised.
let cfgCache = null
function cfg() {
  if (cfgCache) return cfgCache
  const { file: envFile, env } = loadEnv()
  const sshHost = (env.DEV_SSH_HOST || '').trim()
  const remoteDir = (env.DEV_REMOTE_DIR || '~/bbm-portal-dev-stand').trim()
  // remoteDir is interpolated unquoted into a remote `rm -rf` — the leading `~`
  // must stay unquoted to expand, so constrain it hard: a `/`- or `~/`-rooted
  // path of safe characters only, no `..`, no spaces, no shell metacharacters.
  if (sshHost && (!/^~?\/[A-Za-z0-9._/-]+$/.test(remoteDir) || remoteDir.includes('..'))) {
    fail(
      'DEV_REMOTE_DIR must be a plain absolute or ~/ path — no spaces, no "..", ' +
        `no shell metacharacters: "${remoteDir}"`,
    )
  }
  cfgCache = {
    sshHost,
    remoteDir,
    useSudo: /^(1|true|yes)$/i.test((env.DEV_DOCKER_SUDO || '').trim()),
    envFile,
    serviceEnv: env,
  }
  return cfgCache
}

// --- shell helpers ---------------------------------------------------------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) fail(`could not spawn ${cmd}: ${r.error.message}`)
  return r.status ?? 1
}

// Single-quote a value for a POSIX remote shell.
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

// Push infra/dev-stand/ to the remote box (staged + atomic swap), then provision
// the compose `.env` from the local secret source. Only `up` and `config` call
// this. The tarball is unpacked into a staging dir and swapped in only once fully
// extracted, so a mid-transfer failure leaves the live dir (and any running
// container's :ro bind mounts) untouched.
//
// The tarball packs git-tracked infra/dev-stand/ only — `.env` is gitignored and
// absent there — so we re-provision the `.env` from `.env.local` after the swap:
// docker compose auto-loads it from the project dir, so the same single local
// secret file drives the remote stack.
function syncToRemote() {
  const { sshHost, remoteDir, envFile } = cfg()
  const tar = spawnSync('tar', ['-czf', '-', '-C', STAND_DIR, '.'], {
    stdio: ['inherit', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  })
  if (tar.error) fail(`could not spawn tar: ${tar.error.message}`)
  if (tar.status !== 0) fail('packing infra/dev-stand/ failed')

  const stage = `${remoteDir}.stage`
  const unpack =
    `rm -rf ${stage} && mkdir -p ${stage} && tar -xzf - -C ${stage} && ` +
    `rm -rf ${remoteDir} && mv ${stage} ${remoteDir}`
  const push = spawnSync('ssh', [sshHost, unpack], {
    input: tar.stdout,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (push.error) fail(`could not spawn ssh: ${push.error.message}`)
  if (push.status !== 0) fail('syncing infra/dev-stand/ to the remote box failed')

  // Ship the local `.env.local` verbatim as the remote compose `.env` (raw bytes:
  // preserves quoting/comments; secrets, ports and transport keys stay one source
  // of truth on the trusted box). DEV_* keys in it are inert for compose (it reads
  // `.env` for interpolation only). Write to a temp then `mv` so an interrupted
  // transfer never leaves a half-written `.env` for the next `compose` to read.
  const envPush = spawnSync(
    'ssh',
    [sshHost, `cat > ${remoteDir}/.env.tmp && mv ${remoteDir}/.env.tmp ${remoteDir}/.env`],
    { input: readFileSync(envFile), stdio: ['pipe', 'inherit', 'inherit'] },
  )
  if (envPush.error) fail(`could not spawn ssh: ${envPush.error.message}`)
  if (envPush.status !== 0) fail('provisioning the remote compose .env failed')
}

// Run a `docker compose <sub...>` invocation against the active recipe. The SSH
// recipe runs against the already-synced remote dir (only up/config re-sync).
function compose(sub, { tty = false } = {}) {
  const { sshHost, remoteDir, useSudo, serviceEnv } = cfg()
  if (sshHost) {
    // Quote every arg for the remote POSIX shell so multi-word args arrive as one
    // argv element rather than word-split by ssh's implicit shell.
    const remote = `cd ${remoteDir} && ${useSudo ? 'sudo ' : ''}docker compose -f compose.core.yml ${sub
      .map(shq)
      .join(' ')}`
    return run('ssh', tty ? ['-t', sshHost, remote] : [sshHost, remote])
  }
  // Host-only has no remote `.env` to auto-load, so feed the parsed `.env.local`
  // through the subprocess env for compose interpolation. Skip blank values so a
  // commented-out template key does not clobber a real one in the caller's shell.
  const composeEnv = { ...process.env }
  for (const [k, v] of Object.entries(serviceEnv)) if (v !== '') composeEnv[k] = v
  return run('docker', ['compose', '-f', 'compose.core.yml', ...sub], {
    cwd: STAND_DIR,
    env: composeEnv,
  })
}

// Compose vars referenced without a default — `${VAR}`, not `${VAR:-x}` — are the
// required ones. Parsed from the contract so the list tracks compose.core.yml.
function requiredComposeVars() {
  const text = readFileSync(join(STAND_DIR, 'compose.core.yml'), 'utf8')
  const required = new Set()
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)([:-]?[-?][^}]*)?\}/g)) {
    if (!m[2]) required.add(m[1]) // no `:-default` / `:?err` suffix → required
  }
  return [...required]
}

// Dry-validate the resolved compose config without starting anything. Ships the
// contract + `.env` first, like `up`, so the SSH recipe validates real remote
// inputs. `config --quiet` catches schema/`${VAR}` syntax errors — but compose
// substitutes a blank for a missing required var and still exits 0, so we assert
// the required vars resolve non-empty up front (the empty-secret failure).
function cmdConfig() {
  const { sshHost, serviceEnv } = cfg()
  const missing = requiredComposeVars().filter((k) => !(serviceEnv[k] || '').trim())
  if (missing.length)
    fail(
      `compose .env is missing required value(s): ${missing.join(', ')} — ` +
        'fill them in your .env.local (see infra/dev-stand/.env.example).',
    )
  if (sshHost) syncToRemote()
  const code = compose(['config', '--quiet'])
  if (code === 0) console.log('dev:config: compose config valid — required variables resolved.')
  return code
}

function cmdUp() {
  if (cfg().sshHost) syncToRemote()
  return compose(['up', '-d'])
}

function dispatch(cmd, rest) {
  switch (cmd) {
    case 'up':
      return cmdUp()
    case 'down':
      return compose(['down'])
    case 'status':
      return compose(['ps'])
    case 'logs':
      return compose(['logs', '-f', ...rest])
    case 'restart':
      return compose(['restart', ...rest])
    case 'config':
      return cmdConfig()
    default:
      return usage()
  }
}

const [cmd, ...rest] = process.argv.slice(2)
if (!cmd || !COMMANDS.includes(cmd)) usage()
process.exit(dispatch(cmd, rest))
