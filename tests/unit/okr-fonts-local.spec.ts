import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
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

/**
 * Module specifiers of static imports, re-exports, `require()` and `import()`.
 *
 * Anchored on the `from` / `import(` / `require(` keyword and never on the
 * statement it belongs to: an import of five families wraps its clause across
 * lines at `printWidth: 100`, and a pattern that walked from `import` to `from`
 * without crossing a newline stopped seeing exactly that — the single most
 * likely way this defect returns, since the surface already uses three families.
 * `\s*` spans newlines; keep it that way.
 *
 * The trade is deliberate: prose that quotes `from 'next/font/google'` inside a
 * comment will trip this. That fails CLOSED — noisy, and fixed by rewording —
 * whereas parsing cleverly enough to exclude comments risks failing OPEN, which
 * is the whole failure mode this file exists to not have.
 */
function specifiers(source: string): string[] {
  const out: string[] = []
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    for (const m of source.matchAll(re)) out.push(m[1])
  }
  return out
}

/** Every source under the view, RECURSIVELY — a `view/parts/` must not escape. */
function viewSources(): Array<{ name: string; source: string }> {
  return readdirSync(VIEW_DIR, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => {
      const full = join(e.parentPath, e.name)
      return { name: relative(VIEW_DIR, full), source: readFileSync(full, 'utf8') }
    })
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
    // Both loader shapes count: `src: './fonts/x.woff2'` and the array form
    // `src: [{ path: './fonts/x.woff2', … }]`. Matching only the first made this
    // loop run zero times against the second, and "every referenced file
    // exists" was then vacuously true over an empty set.
    const referenced = [...source.matchAll(/(?:src|path):\s*['"]\.\/fonts\/([^'"]+)['"]/g)].map(
      (m) => m[1],
    )
    // A parse that finds nothing must fail, not pass quietly: zero matches means
    // the loader call changed shape and this assertion has stopped guarding.
    expect(
      referenced.length,
      'no ./fonts/ reference could be parsed out of OkrLayout — the loader call changed shape ' +
        'and this check is no longer looking at anything',
    ).toBeGreaterThan(0)

    const vendored = readdirSync(join(VIEW_DIR, 'fonts'))
    for (const name of referenced) {
      expect(vendored, `OkrLayout points at ./fonts/${name}, which is not committed`).toContain(
        name,
      )
    }
  })
})

/**
 * Regression lock for #230 — the binaries are the ones the provenance table
 * describes.
 *
 * #230 subsetted these three files to latin + cyrillic + seven named extras.
 * That halves the preloaded bytes, and it is also the one change to them that
 * can fail SILENTLY: a wrongly-subsetted face throws no error, it renders a
 * blank box for some Cyrillic codepoint nobody happened to look at. Re-running
 * the build recipe with a different flag set, or dropping in a file from
 * somewhere else, produces exactly that — a plausible-looking binary nobody
 * diffed.
 *
 * Verifying the coverage itself would mean parsing WOFF2 (brotli-compressed
 * table directory) in the test, which is a font library's job and not worth a
 * dependency here. So the check is pinned one level up: the vendored bytes must
 * be the exact bytes whose `cmap` WAS verified, and README.md's provenance table
 * is where that digest is recorded. This makes that table executable rather than
 * decorative — swap a binary without re-running the verification and updating
 * its row, and this fails.
 */
describe('vendored OKR font binaries match their provenance record (#230)', () => {
  const FONTS_DIR = join(VIEW_DIR, 'fonts')

  /** `| \`Name.woff2\` | build … | … | <upstream sha> | <vendored sha> |` */
  function recordedDigests(): Map<string, string> {
    const readme = readFileSync(join(FONTS_DIR, 'README.md'), 'utf8')
    const out = new Map<string, string>()
    for (const line of readme.split('\n')) {
      if (!line.startsWith('|')) continue
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
      const name = cells[0]?.replace(/`/g, '')
      if (!name?.endsWith('.woff2')) continue
      // The LAST 64-hex cell on the row is the vendored digest; the upstream
      // digest of the TTF this was built from sits in the cell before it.
      const digests = cells.map((c) => c.replace(/`/g, '')).filter((c) => /^[0-9a-f]{64}$/.test(c))
      const vendored = digests.at(-1)
      expect(
        digests.length,
        `README row for ${name} must record both the upstream and the vendored SHA-256`,
      ).toBe(2)
      out.set(name, vendored as string)
    }
    return out
  }

  it('every committed .woff2 has a provenance row', () => {
    const committed = readdirSync(FONTS_DIR).filter((f) => f.endsWith('.woff2'))
    expect(committed.length, 'the fonts directory must contain vendored binaries').toBeGreaterThan(
      0,
    )
    expect([...recordedDigests().keys()].sort()).toEqual(committed.sort())
  })

  it('every committed .woff2 hashes to the digest its row records', () => {
    for (const [name, expected] of recordedDigests()) {
      const actual = createHash('sha256')
        .update(readFileSync(join(FONTS_DIR, name)))
        .digest('hex')
      expect(
        actual,
        `${name} is not the binary README.md describes. If you rebuilt it, re-run the ` +
          'coverage verification (no codepoint the surface renders may be lost) and update ' +
          'its provenance row — do not just paste the new digest in.',
      ).toBe(expected)
    }
  })
})
