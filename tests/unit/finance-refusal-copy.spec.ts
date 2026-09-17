// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * WHAT A REFUSAL IS ALLOWED TO SAY (#473 item 4).
 *
 * Every `FinanceRefusal` / `FinanceAccessRefusal` message reaches a person:
 * spec 338 EARS-326 requires a readable sentence, and the surfaces render it
 * verbatim — `/p/finance/requests` puts it straight into the board's 403 Alert
 * (`errorMessage`, `RequestsBoardScreen.tsx`). A reader who is not a member was
 * therefore told to go and look at `src/lib/member`: a path inside a private
 * repository, in a message shown on a live screen. The reader cannot open it,
 * and the sentence answers nothing they can act on.
 *
 * The rule is mechanical because the copy is not written in one place: four
 * modules had grown their own copy of the same sentence, and the fifth would
 * have too. A refusal names what the reader can DO — a workspace section, a
 * role, a person to ask — never a file in this repository.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODULE_ROOT = join(REPO_ROOT, 'src', 'lib', 'finance')

/** A path into this repository, as it would look inside a Russian sentence. */
const REPO_PATH =
  /\b(?:src|infra|tools|docs|tests|deploy|scripts)\/[\w./-]+|\b[\w./-]+\.(?:ts|tsx|md|sh|mjs|json)\b/

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : []
  })
}

/** The argument list of every refusal construction in `source`, code comments excluded. */
function refusalArguments(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const found: string[] = []
  const opening = /new Finance(?:Access)?Refusal\(/g
  let match: RegExpExecArray | null
  while ((match = opening.exec(withoutComments)) !== null) {
    let depth = 1
    let index = match.index + match[0].length
    const start = index
    while (index < withoutComments.length && depth > 0) {
      const character = withoutComments[index]
      if (character === '(') depth += 1
      if (character === ')') depth -= 1
      index += 1
    }
    found.push(withoutComments.slice(start, index - 1))
  }
  return found
}

describe('a finance refusal is written for the person who reads it (#473 item 4)', () => {
  it('names no path inside this repository', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(MODULE_ROOT)) {
      for (const argument of refusalArguments(readFileSync(file, 'utf8'))) {
        const leak = REPO_PATH.exec(argument)
        if (leak !== null) offenders.push(`${relative(REPO_ROOT, file)}: ${leak[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('tells a reader with no member record what to do, in one shared sentence', async () => {
    const { financeMemberRecordRefusal } = await import('@/lib/finance/core/errors')
    const refusal = financeMemberRecordRefusal(
      'ivan@example.com',
      'документ обязан называть загрузившего',
    )

    expect(refusal.message).toContain('ivan@example.com')
    expect(refusal.message).toContain('документ обязан называть загрузившего')
    expect(refusal.message).not.toMatch(REPO_PATH)
  })
})
