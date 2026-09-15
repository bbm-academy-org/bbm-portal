import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { collectKitFiles, formatTable, inventory, parseExports } from '../../tools/ui/inventory.mjs'

/**
 * `pnpm ui:inventory` is the FIRST of the two source lines a gap claim needs
 * (#494): «the kit has no X» is admissible only with the inventory line showing
 * the export is absent plus the registry page URL that was checked. The claim
 * that sank the 2026-09-15 plan — «neither shadcn nor Refine gives a totals
 * row» — was refuted by one export this command prints: `TableFooter`, already
 * vendored in `src/ui/table.tsx`. So the inventory has to see the form that
 * export is written in (a brace list), not only `export function`.
 */

const roots: string[] = []

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(resolve(tmpdir(), 'bbm-ui-inventory-'))
  roots.push(root)
  for (const [path, source] of Object.entries(files)) {
    const full = resolve(root, path)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, source)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('parseExports', () => {
  it('reads a brace list, including `as` renames — the form `TableFooter` is written in', () => {
    const names = parseExports('export { Table, TableFooter, TableCell as Cell }').map(
      (e) => e.name,
    )
    expect(names).toEqual(['Cell', 'Table', 'TableFooter'])
  })

  it('reads declaration exports — function, async function, const, class, enum', () => {
    const source = [
      'export function cn(...inputs) {}',
      'export async function load() {}',
      'export const buttonVariants = cva()',
      'export class Store {}',
      'export enum Mode { A }',
    ].join('\n')
    // Order is by name, `localeCompare` — the same comparator the printed table
    // uses, so the output a gap claim quotes is byte-stable across runs.
    expect(parseExports(source)).toEqual([
      { name: 'buttonVariants', kind: 'const' },
      { name: 'cn', kind: 'function' },
      { name: 'load', kind: 'function' },
      { name: 'Mode', kind: 'enum' },
      { name: 'Store', kind: 'class' },
    ])
  })

  it('reads type and interface exports, and a `export type { … }` list', () => {
    const source = [
      'export type Variant = "a" | "b"',
      'export interface Props { id: string }',
      'export type { ColumnDef, Row }',
    ].join('\n')
    const byName = Object.fromEntries(parseExports(source).map((e) => [e.name, e.kind]))
    expect(byName).toEqual({
      ColumnDef: 'type',
      Props: 'interface',
      Row: 'type',
      Variant: 'type',
    })
  })

  it('records a default export under the name it is imported by', () => {
    expect(parseExports('export default function Page() {}')).toEqual([
      { name: 'default', kind: 'default' },
    ])
  })

  it('ignores `export` inside comments — a commented-out export is not an export', () => {
    const source = ['// export function ghost() {}', '/* export const phantom = 1 */'].join('\n')
    expect(parseExports(source)).toEqual([])
  })
})

describe('collectKitFiles', () => {
  it('walks src/ui/** for .tsx and .ts, sorted, with POSIX repo-relative paths', () => {
    const root = fixture({
      'src/ui/table.tsx': 'export { Table }',
      'src/ui/utils.ts': 'export function cn() {}',
      'src/ui/refine-ui/data-table/data-table.tsx': 'export function DataTable() {}',
      'src/ui/theme.css': ':root {}',
      'src/lib/other.ts': 'export const nope = 1',
    })
    expect(collectKitFiles(root)).toEqual([
      'src/ui/refine-ui/data-table/data-table.tsx',
      'src/ui/table.tsx',
      'src/ui/utils.ts',
    ])
  })
})

describe('inventory', () => {
  it('returns one row per exported name, ordered by file then name', () => {
    const root = fixture({
      'src/ui/table.tsx': 'export { Table, TableFooter }',
      'src/ui/button.tsx': 'export const buttonVariants = cva()\nexport function Button() {}',
    })
    expect(inventory(root)).toEqual([
      { file: 'src/ui/button.tsx', name: 'Button', kind: 'function' },
      { file: 'src/ui/button.tsx', name: 'buttonVariants', kind: 'const' },
      { file: 'src/ui/table.tsx', name: 'Table', kind: 'named' },
      { file: 'src/ui/table.tsx', name: 'TableFooter', kind: 'named' },
    ])
  })

  it('lists TableFooter under src/ui/table.tsx in THIS repo — the 2026-09-15 refutation', () => {
    // vitest runs from the repo root, which is this command's only subject.
    const rows = inventory(process.cwd())
    expect(rows).toContainEqual(
      expect.objectContaining({ file: 'src/ui/table.tsx', name: 'TableFooter' }),
    )
  })
})

describe('formatTable', () => {
  it('prints an aligned file → name → kind table with a header and a count', () => {
    const lines = formatTable([
      { file: 'src/ui/table.tsx', name: 'Table', kind: 'named' },
      { file: 'src/ui/utils.ts', name: 'cn', kind: 'function' },
    ])
    expect(lines[0]).toMatch(/^FILE\s+EXPORT\s+KIND$/)
    expect(lines.some((l) => /^src\/ui\/table\.tsx\s+Table\s+named$/.test(l))).toBe(true)
    expect(lines.at(-1)).toContain('2 exports')
  })

  it('says so plainly when the kit has no exports at all', () => {
    expect(formatTable([]).join('\n')).toContain('no exports')
  })
})
