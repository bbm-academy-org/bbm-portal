#!/usr/bin/env node
// PreToolUse guard on the Playwright-MCP file-writing tools (issue #134; ported
// from ds-platform tools/hooks/screenshot-path-guard.mjs, where it landed as a
// BLOCK after 18 stray PNGs / 5.8 MB accumulated in the repo root).
//
// TODO(#136): severity canon promotion — this guard ships as WARN (exit 0 +
// systemMessage) per the 7.3 rule that a newly ported hook does not start out
// blocking. In ds-platform it is exit 2. The detection logic below is the
// blocking one, untouched; only the emission is downgraded.
//
// Mechanism the guard encodes — the MCP server resolves a caller-supplied
// `filename` against ITS OWN cwd, which is the repository root, and only then
// checks access:
//
//   resolvedName = path.resolve(workspace, fileName);   // workspace = cwd
//   await checkFile(options, resolvedName, { origin: "llm" });
//
//   function outputDir(options) {                       // playwright-core 0.0.78,
//     if (options.config.outputDir) …                   // packages/playwright-core/
//     if (isSystemDirectory(cwd) || !isWritable(cwd))   //   src/tools/backend/context.ts
//       return path.join(os.tmpdir(), ".playwright-mcp");
//     return path.join(options.cwd, ".playwright-mcp");
//   }
//
//   function checkFile(options, resolved, flags) {
//     …
//     if (!isPathInside(outputDir(options), resolved) && !isPathInside(cwd, resolved))
//       throw new Error(`File access denied: … Allowed roots: …`);
//   }
//
// Two consequences:
//
// 1. A RELATIVE `filename` always lands somewhere under the repo tree; a bare
//    name lands in the ROOT, as untracked clutter in a tree that — here — is
//    SHARED with other live sessions (.claude/rules/parallel-sessions.md). That
//    is what this guard warns about.
// 2. The server will only accept the repo tree itself and `<repo>/.playwright-mcp`
//    (absent an explicit `--output-dir` / `allowUnrestrictedFileAccess`), so the
//    guard cannot steer callers to the session scratchpad outside the repo —
//    that raises `File access denied`. It steers them into the repo's own
//    git-ignored artifact dirs instead.
//
// Contract: stdin — JSON PreToolUse ({session_id, cwd, tool_name,
// tool_input:{filename}}). exit 0 + `systemMessage` = WARN. exit 0 with no
// output = nothing to say. FAIL-OPEN: any parse/logic error exits 0 — a guard
// bug must never wedge a legitimate screenshot.

import {
  emitWarn,
  hooksDisabled,
  isAbsolutePath,
  isDirectRun,
  isUnder,
  norm,
  readHookPayload,
} from './shared.mjs'

/** The server's own output dir, relative to its cwd (playwright-core 0.0.78). */
export const SERVER_OUTPUT_DIR = '.playwright-mcp'

/**
 * Directories a browser artifact may land in without cluttering the working
 * tree: exactly this repo's git-ignored browser-artifact dirs (.gitignore —
 * `/.playwright-mcp/`, `/test-results/`, `/playwright-report/`). All three sit
 * INSIDE the tree, so the MCP server's own `checkFile` accepts them; the
 * session scratchpad (`%LOCALAPPDATA%\Temp\claude\…`) does not, which is why it
 * is not the recommended target.
 */
export const ALLOWED_OUTPUT_DIRS = [SERVER_OUTPUT_DIR, 'test-results', 'playwright-report']

/**
 * Matches the file-writing browser tools under ANY MCP server id — the plugin's
 * own (`mcp__plugin_playwright_playwright__…`) and a bare re-install
 * (`mcp__playwright__…`). Pinning one literal name would silently disarm the
 * guard the day the server is re-registered. `browser_pdf_save` takes the same
 * `filename` through the same resolve+check path, so it is in scope too.
 */
export function isScreenshotTool(name) {
  return typeof name === 'string' && /^mcp__.*__browser_(take_screenshot|pdf_save)$/.test(name)
}

/** Forward-slashed, trailing-slash-free — case PRESERVED (norm() folds case). */
function toSlash(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

/**
 * Platform-independent `resolve(cwd, filename)`: node's own resolves against
 * the RUNNING os's rules, so a Windows-shaped payload replayed on the Linux CI
 * runner (ci.yml — ubuntu-latest) would resolve to nonsense and the seam tests
 * would pass or fail by accident of runner. This walks the segments itself.
 */
export function resolveTarget(cwd, filename) {
  if (isAbsolutePath(filename)) return toSlash(filename)
  const parts = toSlash(cwd).split('/')
  for (const seg of toSlash(filename).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (parts.length > 1) parts.pop()
    } else {
      parts.push(seg)
    }
  }
  return parts.join('/')
}

/**
 * Every tree this guard protects, given the server's cwd: the cwd itself and —
 * when cwd is at or below `<main>/.claude/worktrees/<N>` — that worktree root
 * plus the SHARED main checkout above it. Without the main root a
 * `../../../shot.png` escape would take the silent branch while landing squarely
 * in the tree the owner and other live sessions work in
 * (.claude/rules/parallel-sessions.md; same derivation as worktree-path-guard.mjs).
 */
export function guardedRoots(cwd) {
  const roots = [toSlash(cwd)]
  const m = toSlash(cwd).match(/^(.*)\/\.claude\/worktrees\/[^/]+/)
  if (m && m[1]) {
    // A hook may run BELOW the worktree root; protect the worktree root itself
    // (and its output dirs) independently from that subdirectory.
    if (norm(m[0]) !== norm(cwd)) roots.push(m[0])
    roots.push(m[1])
  }
  return roots
}

export function warnMessage({ filename, resolved, cwd, toolName }) {
  const calledTool =
    String(toolName).match(/browser_(?:take_screenshot|pdf_save)$/)?.[0] ??
    'browser_take_screenshot'
  const extension = calledTool === 'browser_pdf_save' ? 'pdf' : 'png'
  const allowedRoots = cwd
    ? `Do NOT retarget outside the repo (the session scratchpad included): the server's allowed ` +
      `roots are exactly '${cwd}' and '${cwd}/${SERVER_OUTPUT_DIR}' (playwright-core checkFile) — ` +
      `anything else raises 'File access denied'.\n`
    : `Do NOT retarget outside the repo: the hook payload carried no cwd, so the server's allowed ` +
      `roots cannot be rendered here; Playwright MCP still adjudicates them with checkFile.\n`
  return (
    `⚠ screenshot path guard (#134): ${calledTool} filename '${filename}' writes INSIDE the ` +
    `working tree.\n` +
    `Resolved target: ${resolved}\n` +
    `Playwright MCP resolves a relative filename against its cwd — the repo root — so the file ` +
    `lands in a tree SHARED with other live sessions as untracked clutter (ds-platform: 18 stray ` +
    `files, 5.8 MB, from 73 such calls).\n` +
    `Write into '${SERVER_OUTPUT_DIR}/' instead, with a FLAT name that carries the task: ` +
    `'${SERVER_OUTPUT_DIR}/<issue>-<name>.${extension}'. That directory is .gitignore'd and is ` +
    `where the server's own auto-named files already go (so are 'test-results/' and ` +
    `'playwright-report/').\n` +
    `A caller-supplied filename is NOT mkdir'd: the server's workspaceFile() branch only resolves ` +
    `+ access-checks and _writeFile() writes straight through — a nested ` +
    `'${SERVER_OUTPUT_DIR}/<dir>/x.${extension}' fails with ENOENT unless <dir> exists (only the ` +
    `OMITTED-filename branch, outputFile(), calls mkdir recursive). Need a subdirectory? Create ` +
    `it with the Bash tool first.\n` +
    allowedRoots +
    `For a deliverable, copy the file out to the session scratchpad afterwards with the Bash ` +
    `tool — never leave the only copy in the working tree.\n` +
    `Warning only: the call is not blocked.\n`
  )
}

/**
 * Pure decision seam. WARN only when the call would write into a guarded tree
 * OUTSIDE the git-ignored artifact dirs. Explicitly silent on:
 *
 * - another tool, a malformed `tool_input`, a non-string / empty `filename`;
 * - an OMITTED `filename` — the server names the file itself and puts it in its
 *   own git-ignored `.playwright-mcp/`;
 * - any path under a guarded root's `ALLOWED_OUTPUT_DIRS`, relative or absolute;
 * - a path outside the repo tree — the server's own `checkFile` adjudicates
 *   that, and a guard that pre-empted it would wedge a legitimate configuration
 *   (`--output-dir` / `allowUnrestrictedFileAccess`).
 *
 * Without a usable `cwd` the resolve cannot be reproduced, so the guard falls
 * back to the shape rule: a relative path not already under an allowed output
 * dir is the clutter class.
 */
export function decideScreenshotPath({ toolName, toolInput, cwd }) {
  if (!isScreenshotTool(toolName)) return { warn: false }
  if (!toolInput || typeof toolInput !== 'object') return { warn: false }

  const { filename } = toolInput
  if (typeof filename !== 'string' || filename === '') return { warn: false }

  if (typeof cwd !== 'string' || cwd === '') {
    if (isAbsolutePath(filename)) return { warn: false }
    const rel = norm(filename)
    if (ALLOWED_OUTPUT_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) {
      return { warn: false }
    }
    return { warn: true, toolName, filename, resolved: filename, cwd: '' }
  }

  const resolved = resolveTarget(cwd, filename)
  const roots = guardedRoots(cwd)

  // Output dirs win over the tree check — they are git-ignored by design.
  for (const root of roots) {
    for (const dir of ALLOWED_OUTPUT_DIRS) {
      if (isUnder(resolved, `${root}/${dir}`)) return { warn: false }
    }
  }
  for (const root of roots) {
    if (isUnder(resolved, root)) return { warn: true, toolName, filename, resolved, cwd }
  }
  return { warn: false }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    const decision = decideScreenshotPath({
      toolName: payload.tool_name || '',
      toolInput: payload.tool_input,
      cwd: payload.cwd || '',
    })
    // TODO(#136): severity canon promotion — WARN today, exit 2 + stderr once
    // the severity canon says this class blocks.
    if (decision.warn) emitWarn(warnMessage(decision))
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: never wedge a legitimate screenshot
  }
}

if (isDirectRun(import.meta.url)) main()
