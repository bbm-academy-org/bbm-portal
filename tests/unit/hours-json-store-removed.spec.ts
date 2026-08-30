import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The JSON store is GONE from the application (spec 124 EARS-15).
 *
 * «WHEN the cutover completes and the owner accepts the stand, the production
 * `hours.json` shall be archived in place …, `HOURS_DATA_FILE` and the JSON store
 * code path removed, and spec 081's «Хранение (без БД)» section revised to point
 * at this spec (same PR).»
 *
 * The clause's trigger fired on 2026-08-18 (window log + Stage-B GO on #256), and
 * this is the test it was waiting for — until then it was the last entry in the
 * deferral list of `tools/lint/ears-test-lint.mjs`, which PR-2 empties.
 *
 * A removal is only testable as an ABSENCE, so the assertions are deliberately
 * grep-shaped and scoped to the two places where a resurrection would actually
 * hurt: `src/` (the application — a fallback read is exactly what EARS-12 forbids)
 * and the env contracts (`.env.example`, `deploy/.env.prod.example` — a declared
 * variable is an instruction to an operator). Prose that NAMES the removed
 * variable while explaining its removal is not a violation and is why the scan
 * looks at code and declarations rather than at the word appearing anywhere.
 *
 * The ops half of the clause — renaming the live document to `hours.json.<date>`
 * on the volume — happens on the box after this PR deploys and cannot be asserted
 * from the repository. What CAN be asserted is that the repository tells the
 * operator to do it, so the last case pins the runbook step rather than pretending
 * to observe the volume.
 */

const ROOT = resolve(import.meta.dirname, '../..')

/** Every file under `dir`, recursively, as repo-relative POSIX paths. */
function filesUnder(dir: string, skip = new Set(['node_modules', '.next'])): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (skip.has(entry)) continue
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(ROOT, full).split(sep).join('/'))
    }
  }
  walk(dir)
  return out
}

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

describe('the JSON store code path is removed (EARS-15)', () => {
  it('EARS-15: `src/lib/hours/store.ts` does not exist', () => {
    expect(existsSync(join(ROOT, 'src/lib/hours/store.ts'))).toBe(false)
  })

  it('EARS-15: no module under `src/` names HOURS_DATA_FILE', () => {
    // The one env var that could point the app back at a file. Comments count:
    // the variable is not coming back, so neither should a line telling a reader
    // it might.
    const offenders = filesUnder(join(ROOT, 'src')).filter((file) =>
      read(file).includes('HOURS_DATA_FILE'),
    )
    expect(offenders).toEqual([])
  })

  it('EARS-15: no module of `src/lib/hours` touches the filesystem at all', () => {
    // The sharpest available statement of «the code path is removed»: the store
    // was the module's only reason to open a file, and a future fallback would
    // have to start by importing `node:fs`. Asserted on the module rather than on
    // the word `hours.json`, which legitimately survives in frozen archives,
    // migration fixtures and tools outside `src/` (EARS-11).
    const offenders = filesUnder(join(ROOT, 'src/lib/hours'))
      .filter((file) => !file.endsWith('.md'))
      .filter((file) => /from 'node:fs(?:\/promises)?'/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('EARS-15: neither env contract declares HOURS_DATA_FILE any more', () => {
    // A declaration is `NAME=`; the surrounding prose explaining the removal is
    // not one, which is the difference this assertion is built on.
    for (const file of ['.env.example', 'deploy/.env.prod.example']) {
      const declarations = read(file)
        .split(/\r?\n/)
        .filter((line) => /^\s*HOURS_DATA_FILE\s*=/.test(line))
      expect(declarations, `${file} still declares HOURS_DATA_FILE`).toEqual([])
    }
  })

  it('EARS-15: the frozen reader survives OUTSIDE the app, read-only, in tools/', () => {
    // The clause removes the store, not the ability to read the archive: the
    // verdict command must keep working against `hours.json.<date>` (EARS-26/27).
    expect(existsSync(join(ROOT, 'tools/platform/hours-json.ts'))).toBe(true)
    const reader = read('tools/platform/hours-json.ts')
    // Read-only BY CONSTRUCTION: the only filesystem binding it imports is
    // `readFile`. Asserted on the import statement rather than on the word
    // `writeFile` appearing anywhere — the header explains what was left behind,
    // and prose about a deleted write path must not read as the write path.
    const fsImports = [...reader.matchAll(/import \{([^}]*)\} from 'node:fs(?:\/promises)?'/g)]
      .flatMap((match) => match[1].split(','))
      .map((name) => name.trim())
      .filter(Boolean)
    expect(fsImports).toEqual(['readFile'])
  })

  it('EARS-15: spec 081 no longer specifies a JSON store and points at spec 124', () => {
    const spec = read('docs/specs/081-hours-calculator.md')
    expect(spec).not.toContain('### Хранение (без БД)')
    expect(spec).toContain('124-hours-on-core.md')
  })

  it('EARS-15: the runbook carries the archive step as a named ops action', () => {
    // The half of the clause that happens on the box. A reader must be able to
    // find WHAT to rename the document to without inventing a convention.
    const runbook = read('docs/runbooks/hours-core-cutover.md')
    expect(runbook).toMatch(/hours\.json\.\d{4}-\d{2}-\d{2}/)
    expect(runbook).toMatch(/mv \/data\/hours\/hours\.json /)
    expect(runbook).toMatch(/bbm-portal_hoursdata/)
  })
})
