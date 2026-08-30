import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('legacy hours admin retirement (spec 311 EARS-421, EARS-452)', () => {
  it('EARS-452: removes both old /p/hours/admin entry points', () => {
    expect(existsSync(join(root, 'src/app/(platform)/p/hours/admin/page.tsx'))).toBe(false)
    expect(existsSync(join(root, 'src/app/(platform)/p/hours/admin/export/route.ts'))).toBe(false)
  })

  it('removes the temporary cabinet export rejected during owner acceptance', () => {
    expect(existsSync(join(root, 'src/app/(platform)/p/admin/hours/export/page.tsx'))).toBe(false)
    expect(
      existsSync(join(root, 'src/app/(platform)/p/admin/hours/export/HoursExportScreen.tsx')),
    ).toBe(false)
    expect(existsSync(join(root, 'src/app/(platform)/api/p/hours/admin/export/route.ts'))).toBe(
      false,
    )
  })

  it('EARS-421/32: removes the temporary HOURS_ADMIN_EMAILS authority everywhere', () => {
    const files = [
      '.env.example',
      'deploy/.env.prod.example',
      'src/lib/hours/access.ts',
      'src/modules/hours/actions.ts',
    ]
    for (const file of files) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toContain('HOURS_ADMIN_EMAILS')
    }
  })
})
