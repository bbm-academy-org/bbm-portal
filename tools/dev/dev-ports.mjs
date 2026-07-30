#!/usr/bin/env node
// bbm-portal — per-session dev-server port prober. Issue #90.
//
// Why: `next dev` defaults to 3000, which is the SINGLE-session default. With
// parallel sessions on one box the second `pnpm dev` either fails or, worse,
// the session reaches for the "kill whatever holds 3000" reflex and takes down
// another session's acceptance stand while the owner is looking at it.
//
// Why 3000–3009 and not a wider range: the dev Zitadel has redirect URIs
// registered ONLY for those ten ports. A stand outside the range boots fine and
// then dies at login with `400 invalid_request` — a slow, confusing failure. The
// range is therefore a hard ceiling, not a convenience. (Restoring it in the
// provisioning default: issue #93.)
//
// Usage:
//   pnpm dev:ports            # prints PORT=<n> + the boot line
//   pnpm dev:ports --json     # {"port":3001} for tooling
//
// The probe BINDS each candidate (net.createServer().listen) and releases it
// immediately — real availability, no netstat parsing, cross-platform. A port
// held by anyone (another session's stand included) is simply skipped: nothing
// is inspected, nothing is killed. The probe→boot race is accepted; it is
// ms-scale on one dev box.

import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── pure seams (unit-tested in tests/unit/dev-ports.spec.ts) ─────────────────

export const PORT_MIN = 3000
export const PORT_MAX = 3009

/** The candidate ports, in order: 3000, 3001, … 3009. */
export function portSequence() {
  const ports = []
  for (let p = PORT_MIN; p <= PORT_MAX; p += 1) ports.push(p)
  return ports
}

/**
 * The first port that probes free, or null when the whole range is taken.
 * `probe(port) → Promise<boolean>` is injected so the tests need no real bind.
 */
export async function firstFreePort(ports, probe) {
  for (const port of ports) {
    if (await probe(port)) return port
  }
  return null
}

/**
 * The human-readable result block.
 *
 * The boot line is `PORT=<n> pnpm dev` and NOT `pnpm dev -- -p <n>`: the `--`
 * form reaches Next as a positional argument and fails with
 * `Invalid project directory … \-p`. Auth.js builds its dev callback from the
 * request host, so the port substitutes itself — nothing else to configure.
 */
export function formatPort(port) {
  return [
    `PORT=${port}`,
    `# boot the stand:  PORT=${port} pnpm dev        → http://localhost:${port}`,
    `# PowerShell:      $env:PORT=${port}; pnpm dev`,
    `# NOT \`pnpm dev -- -p ${port}\` — the -- reaches Next as a path and it fails.`,
    `# Record this port in the handoff and the issue comment.`,
  ]
}

/** The message for a saturated range — a wider range is not an option (see header). */
export function exhaustedMessage() {
  return (
    `dev:ports: no free port in ${PORT_MIN}-${PORT_MAX} — every slot is held by a running stand. ` +
    `Do NOT kill a listener you did not start (it is probably another session's acceptance stand). ` +
    `Shut down your own stand, or wait for a session to hand back.`
  )
}

/**
 * Real probe: bind the port on the unspecified host (what `next dev` binds by
 * default) and release it immediately. `false` on EADDRINUSE/EACCES.
 */
export function probePortFree(port) {
  return new Promise((resolveProbe) => {
    const srv = createServer()
    srv.once('error', () => resolveProbe(false))
    srv.listen(port, () => srv.close(() => resolveProbe(true)))
  })
}

// ── impure CLI (skipped on import) ───────────────────────────────────────────

async function main() {
  const json = process.argv.includes('--json')
  const port = await firstFreePort(portSequence(), probePortFree)
  if (port === null) {
    console.error(exhaustedMessage())
    process.exit(1)
  }
  if (json) console.log(JSON.stringify({ port }))
  else for (const line of formatPort(port)) console.log(line)
}

const INVOKED = process.argv[1] ? resolve(process.argv[1]) : ''
const SELF = resolve(fileURLToPath(import.meta.url))
if (INVOKED === SELF) {
  await main()
}
