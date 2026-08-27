#!/usr/bin/env node
// endpoint-authz — every `/api/p/*` route handler is provably gated.
//
// Canon: docs/ci-guardrails.md §5. Severity: BLOCK since 2026-08-27 under the
// §3 day-0 mandate, classes 1 and 2 together:
//   class 1 (deterministic tree check) — the only input is the checked-out
//     repo tree. No network, no PR metadata, no regex over human prose: the
//     patterns matched are this repo's OWN handler convention, declared in
//     `src/lib/platform/api/moduleRoute.ts`.
//   class 2 (documented security mandate) — spec 311 EARS-461/EARS-462 and
//     consolidation §5 record the decision that an ungated module handler is a
//     data-protection defect («authorization lives in every handler … a handler
//     that relies on the shell having checked is a defect»). A WARN soak over
//     an authorization hole is itself the risk.
// Escape hatch, per §3 clause (d) read on the CI plane: `// endpoint-authz-ok:
// <reason>` on the handler's own line. The reason is required, it stays in the
// diff, and a reviewer reads it where the decision was made.
//
// WHY IT EXISTS AT ALL. It is the deferred row of the platform-consolidation
// spec §11 — «endpoint-authz-аналог для route handlers (эпик API-слоя §5)» —
// falling due with the surface that triggers it: #315 opens `/api/p/*`, so the
// guard lands with the first handler rather than after the tenth.
//
// THREE FINDINGS, each anchored to a clause:
//   ungated-handler          an exported HTTP method that is neither built by a
//                            sanctioned factory nor gated by `claimGateResponse`
//                            in its own file (EARS-461, EARS-462)
//   member-claim-under-admin a handler under `/admin/` built with `memberRoute`
//                            — the cabinet's claim is not optional (EARS-462)
//   reserved-admin-segment   the segment `admin` anywhere but directly after the
//                            module slug, which would make
//                            /api/p/<slug>/admin/<resource> ambiguous with
//                            /api/p/<slug>/<resource> (D-12)
//
// Run: `pnpm lint:endpoint-authz`. Findings: stderr + exit 1. Clean: stdout + exit 0.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isEntryPoint, reporter, repoRoot, runMain, walkFiles } from './lib/guard.mjs'

const TAG = 'endpoint-authz'

/**
 * The scope: a route handler inside a module's API namespace.
 *
 * The trailing separator after `api/p` is load-bearing — `api/pages/route.ts`
 * is a Payload catch-all path and none of this guard's business, the same
 * over-match trap `isPlatformSurfacePath` has to avoid on the host allowlist.
 */
export const MODULE_ROUTE_RE = /^src\/app\/.*\/api\/p\/.+\/route\.tsx?$/

/** The HTTP methods Next routes from a `route.ts`. */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const METHOD_ALT = METHODS.join('|')

/** `export async function GET(` / `export function GET(` */
const FN_EXPORT_RE = new RegExp(`^\\s*export\\s+(?:async\\s+)?function\\s+(${METHOD_ALT})\\b`)
/** `export const GET = adminRoute({` / `export const GET: Handler = …` */
const CONST_EXPORT_RE = new RegExp(
  `^\\s*export\\s+(?:const|let|var)\\s+(${METHOD_ALT})\\b[^=]*=\\s*([A-Za-z_$][\\w$]*)?`,
)

/** The factories that carry the gate. Anything else has to gate itself. */
const ADMIN_FACTORY = 'adminRoute'
const MEMBER_FACTORY = 'memberRoute'
const SANCTIONED = new Set([ADMIN_FACTORY, MEMBER_FACTORY])

/** The hand-gated escape: the file calls the claim gate helper itself. */
const HAND_GATE_RE = /\bclaimGateResponse\s*\(/

/** Suppression, reason required — a bare marker is not a record. */
const SUPPRESS_RE = /\bendpoint-authz-ok\s*:\s*\S/

/**
 * The path segments of a module API route, module slug first.
 * `src/app/(platform)/api/p/hours/admin/periods/route.ts` → `['hours','admin','periods']`.
 * Next route groups (`(platform)`) and private folders (`_lib`) are not URL
 * segments and are dropped, so the reservation check reads the real URL.
 */
export function apiSegments(rel) {
  const after = rel.split('/api/p/')[1] ?? ''
  return after
    .split('/')
    .slice(0, -1)
    .filter((s) => s !== '' && !s.startsWith('(') && !s.startsWith('_'))
}

/**
 * Pure decision seam: one handler file in, findings out.
 *
 * @param {string} rel repo-relative POSIX path
 * @param {string} source file contents
 */
export function scanHandlerFile(rel, source) {
  const findings = []
  const segments = apiSegments(rel)

  // D-12: `admin` is RESERVED as the segment right after the module slug. A
  // resource named `admin` anywhere else makes the two URL shapes ambiguous,
  // and the reservation is only real if something refuses the second spelling.
  segments.forEach((segment, index) => {
    if (segment === 'admin' && index !== 1) {
      findings.push({
        kind: 'reserved-admin-segment',
        line: 1,
        method: null,
        text: `/${segments.join('/')} — 'admin' is reserved for /api/p/<slug>/admin/… only`,
      })
    }
  })

  const underAdmin = segments[1] === 'admin'
  const handGated = HAND_GATE_RE.test(source)
  const lines = source.split(/\r?\n/)

  lines.forEach((raw, i) => {
    const fn = FN_EXPORT_RE.exec(raw)
    const konst = fn ? null : CONST_EXPORT_RE.exec(raw)
    if (!fn && !konst) return

    const method = (fn ?? konst)[1]
    const factory = konst ? konst[2] : null
    if (SUPPRESS_RE.test(raw)) return

    if (factory && SANCTIONED.has(factory)) {
      if (underAdmin && factory === MEMBER_FACTORY) {
        findings.push({
          kind: 'member-claim-under-admin',
          line: i + 1,
          method,
          text: raw.trim().slice(0, 120),
        })
      }
      return
    }

    if (handGated) return

    findings.push({
      kind: 'ungated-handler',
      line: i + 1,
      method,
      text: raw.trim().slice(0, 120),
    })
  })

  return findings
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()
  const files = walkFiles(root, { include: (rel) => MODULE_ROUTE_RE.test(rel) })

  if (files.length === 0) {
    // A guard that lost its subject must not look clean by silence.
    out.ok('no /api/p/* route handler in this tree — nothing to check.')
  }

  const findings = []
  for (const rel of files) {
    const source = readFileSync(resolve(root, rel), 'utf8')
    for (const finding of scanHandlerFile(rel, source)) findings.push({ rel, ...finding })
  }

  out.info(`scanned ${files.length} module route handler(s)`)
  if (findings.length === 0) {
    out.ok(
      'PASS — every /api/p/* handler re-checks its claim, and the `admin` segment is reserved.',
    )
  }

  for (const f of findings) {
    out.finding(`${f.kind}  ${f.rel}:${f.line}\n    ${f.text}`)
  }
  out.fail(
    `FAIL — ${findings.length} unguarded or mis-shaped module handler(s). Every /api/p/* handler ` +
      'is built by `memberRoute`/`adminRoute` from `@/lib/platform/api`, or calls ' +
      '`claimGateResponse` itself (spec 311 EARS-461/EARS-462) — the shell is never the trust ' +
      'boundary. A handler under /api/p/<slug>/admin/* uses `adminRoute`, and no resource is ' +
      'named `admin` (D-12). A genuine exception carries `// endpoint-authz-ok: <reason>` on the ' +
      'handler line. Canon: docs/ci-guardrails.md §5.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
