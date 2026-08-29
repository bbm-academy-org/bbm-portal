import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src', 'app', '(platform)', 'p', 'admin', 'member', 'members')
const CLIENT_FILES = [
  'AliasPanel.tsx',
  'MemberCreateScreen.tsx',
  'MemberForm.tsx',
  'MemberListScreen.tsx',
  'MemberRecordScreen.tsx',
]

describe('member cabinet client boundary', () => {
  it('keeps the server-only member repository and pg out of every client bundle', () => {
    const violations: string[] = []
    for (const file of CLIENT_FILES) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      for (const statement of source.matchAll(
        /import(?:\s+type)?\s+\{[^}]*\}\s+from ['"]@\/lib\/member['"]/g,
      )) {
        if (!statement[0].startsWith('import type ')) violations.push(`${file}: ${statement[0]}`)
      }
    }
    expect(violations).toEqual([])
  })
})
