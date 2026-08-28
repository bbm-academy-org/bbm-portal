import { describe, expect, it } from 'vitest'

import { MODULE_ROUTE_RE, scanHandlerFile } from '../endpoint-authz-lint.mjs'
import { caseDir, runGuard } from './run-guard'

/**
 * endpoint-authz — every `/api/p/*` route handler is provably gated.
 *
 * This is the deferred row of the platform-consolidation spec §11
 * («endpoint-authz-аналог для route handlers — эпик API-слоя §5») falling due:
 * #315 opens the `/api/p/*` HTTP surface, so the guard that was deferred until
 * that surface existed is laid down with it rather than silently skipped.
 *
 * The rule it mechanises is spec 311 EARS-461/EARS-462 and consolidation §5:
 * authorization lives in EVERY handler, and the shell that rendered the link is
 * never the trust boundary. Both clauses end with the same sentence — «a handler
 * that relies on the shell having checked is a defect» — and a defect nobody can
 * see is what prose enforcement produces.
 */

describe('MODULE_ROUTE_RE — the scope is the module HTTP surface and nothing else', () => {
  it('matches a route handler under a module API namespace', () => {
    expect(MODULE_ROUTE_RE.test('src/app/(platform)/api/p/okr/admin/parameters/route.ts')).toBe(
      true,
    )
    expect(MODULE_ROUTE_RE.test('src/app/(platform)/api/p/hours/periods/route.ts')).toBe(true)
  })

  it('does not reach outside it — Auth.js, Payload and the page routes are not its business', () => {
    expect(MODULE_ROUTE_RE.test('src/app/(platform)/api/auth/[...nextauth]/route.ts')).toBe(false)
    expect(MODULE_ROUTE_RE.test('src/app/(payload)/api/[...slug]/route.ts')).toBe(false)
    expect(MODULE_ROUTE_RE.test('src/app/(platform)/p/hours/admin/export/route.ts')).toBe(false)
    expect(MODULE_ROUTE_RE.test('src/app/(platform)/api/p/okr/admin/parameters/page.tsx')).toBe(
      false,
    )
  })

  it('does not over-match a sibling that merely starts with `api/p`', () => {
    // The `/api/pages` trap, in the guard's scope regex this time: a bare
    // `api/p` prefix would drag every Payload slug route into the scan.
    expect(MODULE_ROUTE_RE.test('src/app/(payload)/api/pages/route.ts')).toBe(false)
  })
})

describe('scanHandlerFile — the pure decision seam', () => {
  const gated = `
    import { adminRoute } from '@/lib/platform/api'
    export const GET = adminRoute({ output: s, handler: async () => [] })
  `

  it('accepts a handler built by a sanctioned factory', () => {
    expect(scanHandlerFile('src/app/(platform)/api/p/okr/admin/x/route.ts', gated)).toEqual([])
  })

  it('flags an exported method that is not built by one', () => {
    const findings = scanHandlerFile(
      'src/app/(platform)/api/p/okr/admin/x/route.ts',
      'export async function GET() {\n  return Response.json({ ok: true })\n}\n',
    )
    expect(findings.map((f) => f.kind)).toEqual(['ungated-handler'])
    expect(findings[0].method).toBe('GET')
    expect(findings[0].line).toBe(1)
  })

  it('flags every exported method separately, so a half-gated file is not clean', () => {
    const findings = scanHandlerFile(
      'src/app/(platform)/api/p/hours/periods/route.ts',
      [
        "import { memberRoute } from '@/lib/platform/api'",
        'export const GET = memberRoute({ output: s, handler: async () => [] })',
        'export async function POST(request: Request) {',
        '  return Response.json({ ok: true })',
        '}',
      ].join('\n'),
    )
    expect(findings.map((f) => f.method)).toEqual(['POST'])
  })

  it('checks a hand gate per exported method instead of blessing the whole file', () => {
    const findings = scanHandlerFile(
      'src/app/(platform)/api/p/hours/admin/periods/route.ts',
      [
        "import { claimGateResponse, PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'",
        'export async function GET() {',
        '  const refusal = claimGateResponse(await auth(), PLATFORM_ADMIN_ROLE)',
        '  if (refusal) return refusal',
        '  return Response.json({ data: [] })',
        '}',
        'export async function POST() {',
        '  return Response.json({ ok: true })',
        '}',
      ].join('\n'),
    )
    expect(findings.map(({ kind, method }) => ({ kind, method }))).toEqual([
      { kind: 'ungated-handler', method: 'POST' },
    ])
  })

  it('EARS-462: flags a handler under an `/admin/` segment that only asks for the member claim', () => {
    const findings = scanHandlerFile(
      'src/app/(platform)/api/p/hours/admin/periods/route.ts',
      "import { memberRoute } from '@/lib/platform/api'\nexport const GET = memberRoute({ output: s, handler: async () => [] })\n",
    )
    expect(findings.map((f) => f.kind)).toEqual(['member-claim-under-admin'])
  })

  it('EARS-462: flags a hand-gated `/admin/` handler that asks only for `platform-user`', () => {
    const findings = scanHandlerFile(
      'src/app/(platform)/api/p/hours/admin/periods/route.ts',
      [
        "import { claimGateResponse, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'",
        'export async function GET() {',
        '  const refusal = claimGateResponse(await auth(), PLATFORM_USER_ROLE)',
        '  if (refusal) return refusal',
        '  return Response.json({ data: [] })',
        '}',
      ].join('\n'),
    )
    expect(findings.map(({ kind, method }) => ({ kind, method }))).toEqual([
      { kind: 'member-claim-under-admin', method: 'GET' },
    ])
  })

  it('flags a re-exported HTTP method because the route file proves no gate', () => {
    const findings = scanHandlerFile(
      'src/app/(platform)/api/p/hours/admin/periods/route.ts',
      "export { GET } from './handler'\n",
    )
    expect(findings.map(({ kind, method }) => ({ kind, method }))).toEqual([
      { kind: 'ungated-handler', method: 'GET' },
    ])
  })

  it('accepts a hand-gated handler that calls the claim gate itself, and says which claim', () => {
    // The factory is the convention, not a cage: a handler with a genuinely
    // different shape (a streamed download, say) passes by calling the same
    // gate helper. What it may not do is answer without calling anything.
    const findings = scanHandlerFile(
      'src/app/(platform)/api/p/hours/admin/export/route.ts',
      [
        "import { claimGateResponse, PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'",
        'export async function GET() {',
        '  const refusal = claimGateResponse(await auth(), PLATFORM_ADMIN_ROLE)',
        '  if (refusal) return refusal',
        '  return new Response(body)',
        '}',
      ].join('\n'),
    )
    expect(findings).toEqual([])
  })

  it('honours an explicit suppression carrying a reason', () => {
    const findings = scanHandlerFile(
      'src/app/(platform)/api/p/hours/periods/route.ts',
      'export async function GET() {} // endpoint-authz-ok: public health probe, no data\n',
    )
    expect(findings).toEqual([])
  })

  it('refuses a bare suppression with no reason — the reason IS the record', () => {
    const findings = scanHandlerFile(
      'src/app/(platform)/api/p/hours/periods/route.ts',
      'export async function GET() {} // endpoint-authz-ok\n',
    )
    expect(findings.map((f) => f.kind)).toEqual(['ungated-handler'])
  })

  it('D-12: flags an `admin` segment anywhere but directly after the module slug', () => {
    // `admin` is RESERVED as the segment right after the module slug (D-12):
    // a resource named `admin` would make /api/p/<slug>/admin/<resource>
    // ambiguous with /api/p/<slug>/<resource>. The reservation is only real if
    // something refuses the second spelling.
    const findings = scanHandlerFile(
      'src/app/(platform)/api/p/hours/periods/admin/route.ts',
      "import { adminRoute } from '@/lib/platform/api'\nexport const GET = adminRoute({ output: s, handler: async () => [] })\n",
    )
    expect(findings.map((f) => f.kind)).toEqual(['reserved-admin-segment'])
  })
})

describe('endpoint-authz (spawned)', () => {
  it('exits 1 and names file:line of an ungated handler', () => {
    const res = runGuard('endpoint-authz-lint.mjs', caseDir('endpoint-authz', 'ungated'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/app/(platform)/api/p/hours/periods/route.ts:3')
    expect(res.stderr).toContain('ungated-handler')
  })

  it('exits 1 when one method is hand-gated and another method is not', () => {
    const res = runGuard('endpoint-authz-lint.mjs', caseDir('endpoint-authz', 'mixed'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('ungated-handler')
    expect(res.stderr).toContain('POST')
  })

  it('exits 1 when an admin handler hand-gates only `platform-user`', () => {
    const res = runGuard('endpoint-authz-lint.mjs', caseDir('endpoint-authz', 'wrong-admin-claim'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('member-claim-under-admin')
    expect(res.stderr).toContain('GET')
  })

  it('exits 1 when a route re-exports an HTTP method without proving its gate', () => {
    const res = runGuard('endpoint-authz-lint.mjs', caseDir('endpoint-authz', 're-export'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('ungated-handler')
    expect(res.stderr).toContain('GET')
  })

  it('exits 0 on a tree whose handlers are all built by the factories', () => {
    const res = runGuard('endpoint-authz-lint.mjs', caseDir('endpoint-authz', 'clean'))
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('PASS')
  })

  it('exits 0 and SAYS SO on a tree with no module handlers at all', () => {
    // A guard that lost its subject must not look clean by silence: the run
    // that scanned nothing has to be distinguishable from the run that scanned
    // a surface and found it sound.
    const res = runGuard('endpoint-authz-lint.mjs', caseDir('endpoint-authz', 'empty'))
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/no \/api\/p\/\* route handler/i)
  })

  it('exits 0 against the real repo tree — this repo is the guard’s first subject', () => {
    const res = runGuard('endpoint-authz-lint.mjs', null, { realTree: true })
    expect(res.stderr).toBe('')
    expect(res.code).toBe(0)
  })
})
