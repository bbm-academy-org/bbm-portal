#!/usr/bin/env node
// no-stub — no dev placeholder, no untracked stub marker on the render surface.
//
// Canon: docs/ci-guardrails.md §5, which is the severity of record. WARN from
// 2026-08-05 under the new-guard posture (§3 — it matches regexes over
// human-written text, so it soaked), promoted to BLOCK on 2026-09-02 (#438) under
// the §4 clauses: no `continue-on-error`, and the job is in the `ci` needs-list.
//
// Why it exists: CLAUDE.md already bans user-facing dev placeholders ("render
// the real thing or nothing") and untracked scaffold, and the ban recurred
// anyway because prose does not fire at the moment code is written. Two literal
// shapes are checked — narrow and mechanical, not a style nanny:
//
//   1. A user-facing DEV PLACEHOLDER: rendered copy telling the reader to set or
//      configure an env/config value. That is a leak of the developer's problem
//      into the product surface.
//   2. A TODO/FIXME/XXX/HACK/STUB standing in for a deliverable with no tracked
//      issue. `TODO(#136)` passes; a bare `// TODO: implement` is an obligation
//      the tracker cannot see, which is exactly the class DEBT.md exists for.
//
// Scope — the USER-FACING RENDER SURFACE only (`src/**/*.tsx`, `src/**/*.css`).
// Deliberately narrower than the ds-platform original, which scans all app
// source: in this repo a marker under `src/lib/**` or `tools/**` is engineering
// debt with a legitimate home (DEBT.md, an issue), while the same marker in a
// rendered component is something the owner sees on the stand. Widening the
// scope is a substantive rule change — canon §4 restarts the promotion clock.
//
// Suppression: `// no-stub-ok: <reason>` on the line. The reason is required.
//
// Run: `pnpm lint:no-stub`. Findings: stderr + exit 1. Clean: stdout + exit 0.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isEntryPoint, reporter, repoRoot, runMain, walkFiles } from './lib/guard.mjs'

const TAG = 'no-stub'

/** The user-facing render surface, minus tests and generated output. */
export const RENDER_SURFACE_RE =
  /^src\/(?!payload-types\.ts|payload-generated-schema\.ts).*\.(tsx|css)$/
const EXEMPT_RE = /(\.spec\.|\.test\.|\/__tests__\/|\/migrations\/)/

// (1) Rendered copy telling the reader to set/configure an env or config value.
// The imperative and the env/config object must be close together, so a label
// like "Configure your profile" does not match.
const ENV_PLACEHOLDER_RE =
  /\b(set|configure|define|provide|missing|задай|настрой|укажи)\b[^\n]{0,40}?\b(env(?:ironment)?\s*var(?:iable)?s?|\.env\b|environment variables?|config(?:uration)? values?|переменн\w*\s+окружения)\b/i
// (2) A stub marker. Matched CASE-SENSITIVELY (the comment convention is
// uppercase) so React's lowercase `placeholder` prop and ordinary prose are not
// caught. `PLACEHOLDER` is deliberately absent — it is a real DOM attribute, and
// the user-facing placeholder shape is covered by (1).
const STUB_MARKER_RE = /\b(TODO|FIXME|XXX|HACK|STUB)\b/
const ISSUE_REF_RE = /#\d{1,6}\b/
const SUPPRESS_RE = /\bno-stub-ok\s*:\s*\S/i

/** Pure decision seam: one source line in, finding kind (or null) out. */
export function scanLine(raw) {
  if (SUPPRESS_RE.test(raw)) return null
  if (ENV_PLACEHOLDER_RE.test(raw)) return 'user-facing-env-placeholder'
  if (STUB_MARKER_RE.test(raw) && !ISSUE_REF_RE.test(raw)) return 'untracked-stub-marker'
  return null
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()
  const files = walkFiles(root, {
    include: (rel) => RENDER_SURFACE_RE.test(rel) && !EXEMPT_RE.test(rel),
  })

  const findings = []
  for (const rel of files) {
    const lines = readFileSync(resolve(root, rel), 'utf8').split(/\r?\n/)
    lines.forEach((raw, i) => {
      const kind = scanLine(raw)
      if (kind) findings.push({ rel, line: i + 1, kind, text: raw.trim().slice(0, 120) })
    })
  }

  out.info(`scanned ${files.length} render-surface file(s)`)
  if (findings.length === 0) {
    out.ok('PASS — no dev placeholder and no untracked stub marker on the render surface.')
  }

  for (const f of findings) {
    out.finding(`${f.kind}  ${f.rel}:${f.line}\n    ${f.text}`)
  }
  out.fail(
    `FAIL — ${findings.length} banned pattern(s). A user-facing dev placeholder is a banned stub, ` +
      'not an affordance — render the real thing or nothing. A stub marker standing in for a ' +
      'deliverable cites a tracked issue (#NNN), or carries `// no-stub-ok: <reason>` when it is ' +
      'genuinely not a deliverable. Canon: docs/ci-guardrails.md §5.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
