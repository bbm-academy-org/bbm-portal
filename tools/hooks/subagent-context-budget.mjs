#!/usr/bin/env node
// PreToolUse hook (`.*`): SUBAGENT context budget — a ROTATE directive at the
// soft tier, DENY of every non-hand-back tool at the hard tier (issue #588;
// ported from ds-platform `tools/hooks/subagent-context-budget.mjs`, their
// `#1374` / `#1376`, tiers from their `#2373`).
//
// Symptom → root cause: a dispatched agent keeps working long past the point
// where every further turn re-sends a huge context, and the only control was a
// prose rule in the owner's notes (~0.5M) that nothing enforced. The lead fence
// (`lead-context-budget.mjs`) cannot help: it acts on the LEAD's dispatches
// only, and a subagent's own size never reaches the lead until it returns.
//
// Contract:
//   - Acts ONLY inside a SUBAGENT: the payload carries `agent_id`. A lead call
//     has none ⇒ exit 0 silent (the lead has `lead-context-budget.mjs`).
//   - Measures the SUBAGENT's OWN transcript. `transcript_path` in a subagent's
//     PreToolUse payload is the LEAD's transcript; the child's is
//     `<dirname(transcript_path)>/<session_id>/subagents/agent-<agent_id>.jsonl`
//     (or an explicit `agent_transcript_path`). A path not under a `subagents/`
//     segment, or one that does not exist, is never measured — charging the
//     lead's size to a child would fence every agent from its first call.
//   - Context size = `lastAssistantContextTokens` from `context-budget.mjs` (one
//     parse, never a copy) over the file tail (`readTail`, `shared.mjs`).
//   - ≥ SOFT_THRESHOLD → `additionalContext` ROTATE directive: finish the atomic
//     step, WIP-commit, write the checkpoint file named in the message, return
//     with `ROTATE: <path>` as the first line. Re-emitted once per
//     SOFT_REPEAT_STEP of further growth (per-agent cadence state). No
//     `permissionDecision: "allow"` — this hook matches `.*`, and "allow" would
//     auto-approve whichever call happened to cross the tier.
//   - ≥ HARD_THRESHOLD → `permissionDecision: "deny"` on every tool except the
//     hand-back allow-list (`isAllowedUnderHardCap`): git inspect / add /
//     commit / push written in a plain ASCII alphabet with no quoting,
//     escaping or shell metacharacter at all (`HARD_CAP_ALPHABET_RE`) — no
//     force push, ref deletion, amend, hook skip or `--output` — and writing
//     the agent's own checkpoint file. Bash and PowerShell are both covered.
//   - `BBM_HOOKS_DISABLE=1` silences it like every other hook of the stack.
//   FAIL-OPEN: any parse / IO / logic error — and an unresolvable child
//   transcript — exits 0 with no output, like the rest of this stack
//   (`shared.mjs`). ds-platform emits a "telemetry unavailable" advisory there
//   instead; this repo's stack is silent on its own errors by contract.
//
// Codex is not wired (`tools/codex/hook-coverage.json`): a Codex child shares
// the parent's `session_id` and exposes no transcript this hook can attribute
// to it, so the ds-platform Codex branch is not ported.
//
// The tier numbers below are owned HERE; `docs/ci-guardrails.md` §6 and
// `tools/hooks/README.md` point at this file instead of restating them.

import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { lastAssistantContextTokens } from './context-budget.mjs'
import {
  hooksDisabled,
  isDirectRun,
  mainRepoRoot,
  norm,
  readHookPayload,
  readState,
  readTail,
  stateFilePath,
  writeState,
} from './shared.mjs'

/** Soft cap: the subagent is told to checkpoint and hand back (ROTATE).
 * Owner-tunable (owner decision, Anton, 2026-11-24, #588: 250K). */
export const SOFT_THRESHOLD = 250_000

/** Hard cap: every tool call is DENIED except the hand-back allow-list.
 * Owner-tunable (owner decision, Anton, 2026-11-24, #588: 350K). */
export const HARD_THRESHOLD = 350_000

/** After the first soft directive, re-emit once per this much extra context. */
export const SOFT_REPEAT_STEP = 25_000

/** Per-agent cadence state (gitignored by `/.claude/*-guard-state/`). */
export const STATE_DIR_REL = '.claude/subagent-budget-guard-state'

/** Bytes of the child transcript tail that are parsed — bounded, because this
 * hook runs on EVERY tool call of every subagent. */
export const TAIL_BYTES = 512 * 1024

/** Filename-safe form of an opaque id. */
export function safeId(id) {
  return String(id || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_')
}

/** Cadence state file of one agent in one session. */
export function statePath(projectDir, sessionId, agentId) {
  return stateFilePath(projectDir, STATE_DIR_REL, `${safeId(sessionId)}-${safeId(agentId)}`)
}

/** `{ lastNotifiedAt }`; missing / corrupt / negative → 0 (fail-open). */
export function readCadence(path, readFile) {
  const s = readFile ? readState(path, readFile) : readState(path)
  const v = s.lastNotifiedAt
  return { lastNotifiedAt: Number.isFinite(v) && v >= 0 ? v : 0 }
}

/** Where rotation checkpoints are written: `<tmp>/claude-checkpoints`, never
 * inside the repo. Hooks receive no per-session scratchpad variable, so this is
 * a fixed location; the absolute path is injected verbatim into the directive,
 * so neither the agent nor the lead has to guess it. */
export function checkpointDir() {
  return resolve(tmpdir(), 'claude-checkpoints')
}

/** Resolved checkpoint path for one agent. */
export function checkpointPath(agentId) {
  return resolve(checkpointDir(), `checkpoint-${safeId(agentId)}.md`)
}

/**
 * The subagent's OWN transcript, or `null` when it cannot be established —
 * `null` ⇒ the caller stays silent.
 *
 * @param {Record<string, any>} payload
 * @param {(p: string) => boolean} [exists]
 */
export function resolveSubagentTranscript(payload, exists = existsSync) {
  const explicit = payload?.agent_transcript_path
  let candidate = typeof explicit === 'string' && explicit.trim() ? explicit : ''
  if (!candidate) {
    const transcriptPath = payload?.transcript_path
    const sessionId = payload?.session_id
    const agentId = payload?.agent_id
    if (typeof transcriptPath !== 'string' || !transcriptPath || !sessionId || !agentId) {
      return null
    }
    candidate = join(
      dirname(transcriptPath),
      safeId(sessionId),
      'subagents',
      `agent-${safeId(agentId)}.jsonl`,
    )
  }
  // For BOTH branches: a path not under a `subagents/` segment is somebody
  // else's transcript (the lead's, typically) — refuse to measure it.
  if (!/(^|[\\/])subagents[\\/]/.test(candidate)) return null
  return exists(candidate) ? candidate : null
}

/** The WHOLE alphabet a command may use above the hard cap: ASCII letters and
 * digits, the space, and `. _ / : = + -`. Everything else is refused outright —
 * every quoting / escaping character (`' " \` and the backtick), every
 * chaining / piping / redirection / substitution / glob / comment character
 * (`; & | < > $ ( ) { } [ ] * ? ! # ~ %`), PowerShell's splat (`@`) and array
 * (`,`) operators, tab / CR / LF, and any non-ASCII character (typographic
 * quotes, dashes, NBSP, lookalike letters).
 *
 * Why an ALLOW-list and no tokenizer (PR #590 review, blocker 3): Bash and
 * PowerShell quote differently — Bash reads `\"` as a literal `"` and treats
 * `“` as an ordinary letter, PowerShell groups on both — so any re-implemented
 * word split disagrees with one of them, and the flag it hides (`--amend`,
 * `--force`, `--receive-pack=<program>`) is the one that runs. With none of
 * those characters present, a space-split IS each shell's word split. The
 * price: a hand-back commit message is one unquoted word
 * (`git commit -am wip-checkpoint`) and a path uses forward slashes. */
const HARD_CAP_ALPHABET_RE = /^[A-Za-z0-9 ._/:=+-]+$/

/** Windows PowerShell 5.1 splits a single-dash native argument at its first dot
 * (`-u..` reaches git as `-u` `..`), so such a word is not one word in both
 * shells — refused rather than modelled. A `--long.x` word is passed whole. */
const HARD_CAP_DOT_SPLIT_RE = /^-[^-][^.]*\./

/** git verbs a subagent may still run above the hard cap: inspect, stage,
 * commit, push — the WIP-commit + hand-back path. */
const HARD_CAP_GIT_VERBS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'add',
  'commit',
  'push',
])

/** Per verb, what the hand-back path never needs: rewriting history, deleting
 * remote refs, running a program (`--receive-pack` / `--exec` run locally for a
 * local remote), skipping hooks, writing an arbitrary file. `long` is matched as
 * git matches it — any unique abbreviation counts (`--forc`, `--amen`);
 * `short` letters are found inside a short-flag cluster (`-uf`) up to the first
 * letter in `shortArg`, which takes the rest of the cluster as its value
 * (`-mn` is the message "n"). */
const HARD_CAP_BANNED_FLAGS = {
  push: {
    long: [
      'force',
      'force-with-lease',
      'force-if-includes',
      'delete',
      'mirror',
      'prune',
      'receive-pack',
      'exec',
    ],
    short: 'fd',
    shortArg: 'o',
  },
  commit: { long: ['amend', 'no-verify'], short: 'n', shortArg: 'mFcCtuS' },
  diff: { long: ['output'], short: '', shortArg: '' },
  log: { long: ['output'], short: '', shortArg: '' },
  show: { long: ['output'], short: '', shortArg: '' },
}

function hasBannedFlag(verb, args) {
  const rules = HARD_CAP_BANNED_FLAGS[verb]
  if (!rules) return false
  let optionsDone = false
  for (const arg of args) {
    if (!optionsDone && arg === '--') {
      // After `--` nothing is an option, but a push refspec still is one.
      optionsDone = true
      continue
    }
    if (optionsDone) {
      if (verb === 'push' && /^[+:]/.test(arg)) return true
      continue
    }
    if (arg.startsWith('--')) {
      const name = arg.slice(2).split('=')[0]
      if (name && rules.long.some((banned) => banned.startsWith(name))) return true
      continue
    }
    if (/^-[^-]/.test(arg)) {
      for (const letter of arg.slice(1)) {
        if (rules.shortArg.includes(letter)) break
        if (rules.short.includes(letter)) return true
      }
      continue
    }
    // A push refspec that forces (`+src:dst`) or deletes (`:dst`).
    if (verb === 'push' && /^[+:]/.test(arg)) return true
  }
  return false
}

/**
 * The ONLY tools a subagent may still run above the hard cap.
 *
 * @param {string} toolName
 * @param {Record<string, any>} toolInput
 * @param {string | null} [agentId]
 */
export function isAllowedUnderHardCap(toolName, toolInput, agentId = null) {
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = String(toolInput?.command ?? '').trim()
    // The prefix must describe the WHOLE command, else `git status && pnpm
    // build`, PowerShell's `git status (pnpm build)` or a quote one shell reads
    // differently from the other (`-m\" --amend -m\"`) routes around the fence.
    if (!HARD_CAP_ALPHABET_RE.test(command)) return false
    const words = command.split(' ').filter(Boolean)
    if (words.some((word) => HARD_CAP_DOT_SPLIT_RE.test(word))) return false
    if (words[0] !== 'git') return false
    // `git -C <path>` is the form this repo mandates (`AGENTS.md` §4).
    const verbAt = words[1] === '-C' ? 3 : 1
    const verb = words[verbAt]
    if (!verb || !HARD_CAP_GIT_VERBS.has(verb)) return false
    return !hasBannedFlag(verb, words.slice(verbAt + 1))
  }
  if (toolName === 'Write') {
    const filePath = String(toolInput?.file_path ?? '')
    if (!filePath) return false
    if (agentId) return norm(resolve(filePath)) === norm(checkpointPath(agentId))
    return /^checkpoint-.+\.md$/.test(basename(filePath.replace(/\\/g, '/')))
  }
  return false
}

const CHECKPOINT_FIELDS =
  'done / remaining / files touched / branch + HEAD SHA / next command / open questions'

export function softMessage(contextTokens, path) {
  const k = Math.round(contextTokens / 1000)
  const soft = Math.round(SOFT_THRESHOLD / 1000)
  return (
    `Context ≈ ${k}K (soft cap ${soft}K, tools/hooks/subagent-context-budget.mjs). Finish the ` +
    `current atomic step only, WIP-commit on the branch with a one-word unquoted message ` +
    `(\`git commit -am wip-checkpoint\`), write \`${path}\` with: ` +
    `${CHECKPOINT_FIELDS}, then return ≤20 lines whose FIRST line is \`ROTATE: ${path}\`. ` +
    `The lead re-dispatches a fresh agent from the checkpoint. Do not start new exploration.`
  )
}

export function hardMessage(contextTokens, path) {
  const k = Math.round(contextTokens / 1000)
  const hard = Math.round(HARD_THRESHOLD / 1000)
  return (
    `Context ≈ ${k}K — hard cap ${hard}K reached (tools/hooks/subagent-context-budget.mjs). ` +
    `Every tool is denied except \`git status|diff|log|show|rev-parse|add|commit|push\` ` +
    `(no force push, ref deletion, --amend, --no-verify or --output) and writing \`${path}\`. ` +
    `The git command may use only letters, digits, spaces and . _ / : = + - — no quotes, ` +
    `backslashes, shell operators or non-ASCII; forward slashes in paths. WIP-commit on the ` +
    `branch as \`git commit -am wip-checkpoint\`, write the checkpoint with: ` +
    `${CHECKPOINT_FIELDS}. Return now: first line \`ROTATE: ${path}\`, ≤20 lines.`
  )
}

/**
 * Pure decision seam (unit-tested without FS or stdin).
 * - ≥ HARD, tool not allow-listed       → `{ action: 'deny' }`
 * - ≥ HARD, tool allow-listed           → `{ action: 'silent' }` (let it hand back)
 * - below SOFT                          → `{ action: 'silent' }`
 * - ≥ SOFT, first crossing / +STEP      → `{ action: 'soft', state }`
 * - ≥ SOFT, already notified this step  → `{ action: 'silent' }`
 * The returned `state` (when present) is what the caller persists.
 *
 * @param {{contextTokens?: number, toolName?: string, toolInput?: Record<string, any>, state?: {lastNotifiedAt?: number}, agentId?: string | null}} [args]
 * @returns {{action: 'silent'|'soft'|'deny', state?: {lastNotifiedAt: number}}}
 */
export function decide({
  contextTokens,
  toolName = '',
  toolInput = {},
  state,
  agentId = null,
} = {}) {
  const ctx = Number.isFinite(contextTokens) ? Number(contextTokens) : 0
  if (ctx >= HARD_THRESHOLD) {
    return isAllowedUnderHardCap(toolName, toolInput, agentId)
      ? { action: 'silent' }
      : { action: 'deny' }
  }
  if (ctx < SOFT_THRESHOLD) return { action: 'silent' }
  const last = Number.isFinite(state?.lastNotifiedAt) ? Number(state?.lastNotifiedAt) : 0
  if (last > 0 && ctx < last + SOFT_REPEAT_STEP) return { action: 'silent' }
  return { action: 'soft', state: { lastNotifiedAt: ctx } }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    if (!payload || typeof payload !== 'object') process.exit(0)
    const agentId = payload.agent_id
    // Not a subagent → not this hook's addressee.
    if (!agentId) process.exit(0)
    const transcriptPath = resolveSubagentTranscript(payload)
    if (!transcriptPath) process.exit(0)
    const contextTokens = lastAssistantContextTokens(readTail(transcriptPath, TAIL_BYTES))
    // Below the soft tier `decide()` is silent whatever the state says, so
    // skip resolving the cadence path — `mainRepoRoot()` spawns git, and this
    // hook runs on EVERY subagent tool call.
    if (!(contextTokens >= SOFT_THRESHOLD)) process.exit(0)
    const cadencePath = statePath(
      mainRepoRoot(payload.cwd || process.cwd()),
      payload.session_id,
      agentId,
    )
    const decision = decide({
      contextTokens,
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      state: readCadence(cadencePath),
      agentId,
    })
    if (decision.action === 'silent') process.exit(0)
    const path = checkpointPath(agentId)
    if (decision.action === 'deny') {
      const msg = hardMessage(contextTokens, path)
      process.stdout.write(
        JSON.stringify({
          systemMessage: msg,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: msg,
          },
        }),
      )
      process.exit(0)
    }
    writeState(cadencePath, decision.state)
    const msg = softMessage(contextTokens, path)
    process.stdout.write(
      JSON.stringify({
        systemMessage: msg,
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
      }),
    )
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: never wedge a legitimate tool call on a bug
  }
}

if (isDirectRun(import.meta.url)) main()
