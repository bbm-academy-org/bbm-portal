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

import ts from 'typescript'

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
const METHOD_SET = new Set(METHODS)

/** The factories that carry the gate. Anything else has to gate itself. */
const ADMIN_FACTORY = 'adminRoute'
const MEMBER_FACTORY = 'memberRoute'
const SANCTIONED = new Set([ADMIN_FACTORY, MEMBER_FACTORY])

/** Suppression, reason required — a bare marker is not a record. */
const SUPPRESS_RE = /\bendpoint-authz-ok\s*:\s*\S/

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function identifierText(node) {
  return node && ts.isIdentifier(node) ? node.text : null
}

function unwrapExpression(node) {
  let current = node
  while (
    current &&
    (ts.isAwaitExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression
  }
  return current
}

function directCall(node, callee) {
  const expression = unwrapExpression(node)
  return expression &&
    ts.isCallExpression(expression) &&
    identifierText(expression.expression) === callee
    ? expression
    : null
}

function functionBody(node) {
  if (ts.isFunctionDeclaration(node)) return node.body ?? null
  if (!ts.isVariableDeclaration(node) || !node.initializer) return null
  const initializer = unwrapExpression(node.initializer)
  return initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ? initializer.body
    : null
}

function authPrelude(statement) {
  return (
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.length > 0 &&
    statement.declarationList.declarations.every(
      (declaration) =>
        ts.isIdentifier(declaration.name) && directCall(declaration.initializer, 'auth'),
    )
  )
}

function gateDeclaration(statement) {
  if (
    !statement ||
    !ts.isVariableStatement(statement) ||
    statement.declarationList.declarations.length !== 1
  ) {
    return null
  }
  const declaration = statement.declarationList.declarations[0]
  const binding = identifierText(declaration.name)
  const call = directCall(declaration.initializer, 'claimGateResponse')
  return binding && call ? { binding, call } : null
}

function returnedBinding(statement, binding) {
  if (!statement || !ts.isIfStatement(statement)) return false
  const condition = unwrapExpression(statement.expression)
  if (!condition || !ts.isIdentifier(condition) || condition.text !== binding) return false

  const branch = statement.thenStatement
  const returned = ts.isBlock(branch)
    ? branch.statements.length === 1 && ts.isReturnStatement(branch.statements[0])
      ? branch.statements[0]
      : null
    : ts.isReturnStatement(branch)
      ? branch
      : null
  const expression = returned?.expression ? unwrapExpression(returned.expression) : null
  return Boolean(expression && ts.isIdentifier(expression) && expression.text === binding)
}

function directClaim(node) {
  const claim = unwrapExpression(node)
  return claim && (ts.isIdentifier(claim) || ts.isStringLiteral(claim)) ? claim : null
}

function isAdminClaim(node) {
  const claim = directClaim(node)
  return Boolean(
    claim &&
    ((ts.isIdentifier(claim) && claim.text === 'PLATFORM_ADMIN_ROLE') ||
      (ts.isStringLiteral(claim) && claim.text === 'platform-admin')),
  )
}

/**
 * A hand gate is accepted only in the canonical fail-closed shape:
 *
 *   const session = await auth() // optional gate preparation
 *   const refusal = claimGateResponse(session, DIRECT_CLAIM)
 *   if (refusal) return refusal
 *   // handler work starts here
 *
 * Looking through descendants is deliberately forbidden: a gate in an unused
 * nested function proves nothing about the exported handler.
 */
function handGateProof(node, underAdmin) {
  const body = functionBody(node)
  if (!body || !ts.isBlock(body)) return { valid: false, topLevel: false, adminClaim: false }

  let gateIndex = 0
  while (gateIndex < body.statements.length && authPrelude(body.statements[gateIndex])) {
    gateIndex += 1
  }

  const gate = gateDeclaration(body.statements[gateIndex])
  if (!gate) return { valid: false, topLevel: false, adminClaim: false }

  const claim = directClaim(gate.call.arguments[1])
  const adminClaim = isAdminClaim(gate.call.arguments[1])
  const failClosed = returnedBinding(body.statements[gateIndex + 1], gate.binding)
  return {
    valid: Boolean(claim && failClosed && (!underAdmin || adminClaim)),
    topLevel: true,
    adminClaim,
  }
}

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
  const lines = source.split(/\r?\n/)
  const sourceFile = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  function location(node) {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
    const raw = lines[line] ?? ''
    return { line: line + 1, raw, text: raw.trim().slice(0, 120) }
  }

  function checkHandler(method, node, factory = null) {
    const at = location(node)
    if (SUPPRESS_RE.test(at.raw)) return

    if (factory && SANCTIONED.has(factory)) {
      if (underAdmin && factory === MEMBER_FACTORY) {
        findings.push({
          kind: 'member-claim-under-admin',
          line: at.line,
          method,
          text: at.text,
        })
      }
      return
    }

    const handGate = handGateProof(node, underAdmin)
    if (handGate.valid) return
    if (underAdmin && handGate.topLevel && !handGate.adminClaim) {
      findings.push({
        kind: 'member-claim-under-admin',
        line: at.line,
        method,
        text: at.text,
      })
      return
    }

    findings.push({
      kind: 'ungated-handler',
      line: at.line,
      method,
      text: at.text,
    })
  }

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      const method = identifierText(statement.name)
      if (method && METHOD_SET.has(method)) checkHandler(method, statement)
      continue
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const method = identifierText(declaration.name)
        if (!method || !METHOD_SET.has(method)) continue
        const factory =
          declaration.initializer && ts.isCallExpression(declaration.initializer)
            ? identifierText(declaration.initializer.expression)
            : null
        checkHandler(method, declaration, factory)
      }
      continue
    }

    if (!ts.isExportDeclaration(statement)) continue
    if (statement.isTypeOnly) continue
    const at = location(statement)
    if (SUPPRESS_RE.test(at.raw)) continue

    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue
        const method = element.name.text
        if (!METHOD_SET.has(method)) continue
        findings.push({
          kind: 'ungated-handler',
          line: at.line,
          method,
          text: at.text,
        })
      }
      continue
    }

    // `export *` can surface any Next HTTP method while proving no gate in the
    // route file. Fail closed; a genuine exception uses the recorded marker.
    if (!statement.exportClause && statement.moduleSpecifier) {
      findings.push({
        kind: 'ungated-handler',
        line: at.line,
        method: null,
        text: at.text,
      })
    }
  }

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
