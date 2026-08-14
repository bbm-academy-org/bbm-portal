import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Regression lock for #219 — the OKR surface loads its faces from vendored
 * files, never over the network at build time.
 *
 * `next/font/google` resolves fonts from `fonts.googleapis.com` while
 * `next build` runs. On a cold hosted CI runner (#214) a transient failure
 * there turns the REQUIRED `ci` check red, with a message that names neither
 * Google nor the network — and a re-run of the same commit goes green. CI
 * cannot catch that class by running once, and adding a font through the Google
 * loader is the convenient, documented, obvious way to add one in Next.js. So
 * the property is pinned here rather than left to memory.
 *
 * This reads sources rather than rendering, like the stylesheet contract in
 * `okr-view-markup.spec.ts`: the defect is an import specifier, and it is
 * invisible to a rendered-output assertion.
 */

const VIEW_DIR = join(__dirname, '..', '..', 'src', 'modules', 'okr', 'view')

/** Module specifiers of static imports, re-exports, `require()` and `import()`. */
function specifiers(source: string): string[] {
  const out: string[] = []
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    for (const m of source.matchAll(re)) out.push(m[1])
  }
  return out
}

function viewSources(): Array<{ name: string; source: string }> {
  return readdirSync(VIEW_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => ({ name: e.name, source: readFileSync(join(VIEW_DIR, e.name), 'utf8') }))
}

describe('OKR fonts are vendored, not fetched at build time (#219)', () => {
  it('no view file imports the Google font loader', () => {
    const files = viewSources()
    expect(files.length, 'the OKR view directory must contain source files').toBeGreaterThan(0)

    const offenders = files
      .filter(({ source }) => specifiers(source).some((s) => s.startsWith('next/font/google')))
      .map(({ name }) => name)

    // Prose may still NAME the loader — the comment in OkrLayout.tsx explains
    // why it is gone. Only an import specifier reintroduces the build-time
    // network dependency, so only that is the failure.
    expect(
      offenders,
      'importing the Google font loader puts `next build` back on the network — ' +
        'vendor the file into src/modules/okr/view/fonts/ and use `next/font/local` instead (#219)',
    ).toEqual([])
  })

  it('OkrLayout loads its faces through next/font/local', () => {
    // The positive half: without it the test above would also pass on a layout
    // that had lost its fonts entirely, and would say nothing about what the
    // surface is supposed to do.
    const source = readFileSync(join(VIEW_DIR, 'OkrLayout.tsx'), 'utf8')
    expect(specifiers(source)).toContain('next/font/local')

    // One local face per CSS variable okr.css consumes.
    for (const variable of ['--font-unbounded', '--font-golos', '--font-plex-mono']) {
      expect(source, `${variable} must still be produced by a font loader`).toContain(variable)
    }

    // The `src` paths are strings the loader resolves, not imports — no
    // dependency graph sees them — so the files they name are checked here.
    const vendored = readdirSync(join(VIEW_DIR, 'fonts'))
    for (const m of source.matchAll(/src:\s*'\.\/fonts\/([^']+)'/g)) {
      expect(vendored, `OkrLayout points at ./fonts/${m[1]}, which is not committed`).toContain(
        m[1],
      )
    }
  })
})
