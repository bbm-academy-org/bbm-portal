import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

type GitResult = {
  status: number | null
  stderr: string
  stdout: string
}

const runGit = (cwd: string, args: string[]): GitResult => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  }
}

const git = (cwd: string, args: string[]) => {
  const result = runGit(cwd, args)
  expect(result.status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`).toBe(0)
  return result
}

const alphaEntry = [
  '- [ ] 2026-08-15 branch alpha records one small deviation — return condition: alpha sweep (#247)',
  '      alpha continuation stays inside the same readable DEBT entry block',
  '',
].join('\n')

const betaEntry = [
  '- [ ] 2026-08-15 branch beta records another small deviation — return condition: beta sweep (#247)',
  '      beta continuation stays inside the same readable DEBT entry block',
  '',
].join('\n')

const countOccurrences = (text: string, needle: string) => text.split(needle).length - 1

describe('DEBT.md merge driver', () => {
  it('keeps concurrent append-only entries from two branches without a manual conflict', () => {
    const root = mkdtempSync(join(tmpdir(), 'bbm-debt-merge-'))

    try {
      git(root, ['init', '--initial-branch=main'])
      git(root, ['config', 'user.email', 'codex@example.invalid'])
      git(root, ['config', 'user.name', 'Codex Test'])
      git(root, ['config', 'core.autocrlf', 'false'])

      writeFileSync(
        join(root, '.gitattributes'),
        readFileSync(resolve(process.cwd(), '.gitattributes'), 'utf8'),
        'utf8',
      )
      writeFileSync(
        join(root, 'DEBT.md'),
        [
          '# DEBT.md — minor convention deviations (decision-debt lite)',
          '',
          '<!-- entries below this line -->',
          '',
          '- [ ] 2026-08-14 base entry — return condition: baseline sweep (#247)',
          '      base continuation stays inside the same readable DEBT entry block',
          '',
        ].join('\n'),
        'utf8',
      )
      mkdirSync(join(root, 'nested'))
      writeFileSync(
        join(root, 'nested', 'DEBT.md'),
        '# nested debt is not the root ledger\n',
        'utf8',
      )

      expect(git(root, ['check-attr', 'merge', '--', 'DEBT.md', 'nested/DEBT.md']).stdout).toBe(
        ['DEBT.md: merge: union', 'nested/DEBT.md: merge: unspecified', ''].join('\n'),
      )

      git(root, ['add', '.gitattributes', 'DEBT.md', 'nested/DEBT.md'])
      git(root, ['commit', '-m', 'base'])

      git(root, ['checkout', '-b', 'alpha'])
      writeFileSync(join(root, 'DEBT.md'), alphaEntry, { encoding: 'utf8', flag: 'a' })
      git(root, ['commit', '-am', 'append alpha debt'])

      git(root, ['checkout', 'main'])
      git(root, ['checkout', '-b', 'beta'])
      writeFileSync(join(root, 'DEBT.md'), betaEntry, { encoding: 'utf8', flag: 'a' })
      git(root, ['commit', '-am', 'append beta debt'])

      git(root, ['checkout', 'main'])
      git(root, ['merge', '--no-edit', 'alpha'])

      const secondMerge = runGit(root, ['merge', '--no-edit', 'beta'])
      expect(
        secondMerge.status,
        `second merge should not conflict\n${secondMerge.stdout}\n${secondMerge.stderr}`,
      ).toBe(0)

      const mergedDebt = readFileSync(join(root, 'DEBT.md'), 'utf8')
      expect(countOccurrences(mergedDebt, alphaEntry)).toBe(1)
      expect(countOccurrences(mergedDebt, betaEntry)).toBe(1)
      expect(mergedDebt).not.toContain('<<<<<<<')
      expect(mergedDebt).not.toContain('=======')
      expect(mergedDebt).not.toContain('>>>>>>>')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
