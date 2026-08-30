import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src', 'app', '(platform)', 'p', 'admin', 'hours')
const CLIENT_FILES = [
  'participants/HoursParticipantCreateScreen.tsx',
  'participants/HoursParticipantForm.tsx',
  'participants/HoursParticipantRecordScreen.tsx',
  'participants/HoursParticipantsScreen.tsx',
  'periods/HoursPeriodCreateScreen.tsx',
  'periods/HoursPeriodForm.tsx',
  'periods/HoursPeriodRecordScreen.tsx',
  'periods/HoursPeriodsScreen.tsx',
  'publication/HoursPublicationScreen.tsx',
]

describe('hours cabinet client boundary', () => {
  it('keeps the server-only hours store and pg out of every client bundle', () => {
    const violations: string[] = []
    for (const file of CLIENT_FILES) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      for (const statement of source.matchAll(
        /import(?:\s+type)?\s+\{[^}]*\}\s+from ['"]@\/lib\/hours['"]/g,
      )) {
        if (!statement[0].startsWith('import type ')) violations.push(`${file}: ${statement[0]}`)
      }
    }
    expect(violations).toEqual([])
  })
})
