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

const countOccurrences = (text: string, needle: string) => text.split(needle).length - 1

const activeStartMarker = '<!-- entries below this line -->'
const appendMarker = '<!-- debt-append-marker -->'

const endAnchor = (id: string) => `<!-- debt-entry-end: ${id} -->`

const activeBlock = (body: string, id: string) => `${body}\n${endAnchor(id)}`

const baseBody = [
  '- [ ] 2026-08-14 base active entry — return condition: baseline sweep (#247)',
  '      base continuation stays inside the same readable DEBT entry block',
].join('\n')

const alphaBody = [
  '- [ ] 2026-08-15 branch alpha records one small deviation — return condition: alpha sweep (#247)',
  '      alpha continuation stays inside the same readable DEBT entry block',
].join('\n')

const betaBody = [
  '- [ ] 2026-08-15 branch beta records another small deviation — return condition: beta sweep (#247)',
  '      beta continuation stays inside the same readable DEBT entry block',
].join('\n')

const keptBody = [
  '- [ ] 2026-08-14 active entry that remains open — return condition: later trigger (#247)',
  '      kept entry continuation stays in the same active block',
].join('\n')

const removedBody = [
  '- [ ] 2026-08-14 active entry that the sweep removes — return condition: fired trigger (#247)',
  '      removed entry continuation stays in the same active block',
].join('\n')

const appendedBody = [
  '- [ ] 2026-08-15 append branch records new active debt — return condition: future sweep (#247)',
  '      appended entry continuation stays in the same active block',
].join('\n')

const historicalNote = '_Historical sweep note stays after the permanent append marker._'
const sweepPromotionNote =
  '_Sweep note records the removed active entry after the permanent append marker._'

const renderDebt = (activeBlocks: string[], historicalNotes = [historicalNote]) =>
  [
    '# DEBT.md — minor convention deviations (decision-debt lite)',
    '',
    'Rules.',
    '',
    activeStartMarker,
    '',
    activeBlocks.join('\n\n'),
    '',
    appendMarker,
    '',
    historicalNotes.join('\n\n'),
    '',
  ].join('\n')

const insertBeforeAppendMarker = (text: string, block: string) => {
  const markerIndex = text.indexOf(appendMarker)
  expect(markerIndex).toBeGreaterThan(0)

  return `${text.slice(0, markerIndex).replace(/\n*$/, '\n\n')}${block}\n\n${text.slice(markerIndex)}`
}

const noConflict = (text: string) => {
  expect(text).not.toContain('<<<<<<<')
  expect(text).not.toContain('=======')
  expect(text).not.toContain('>>>>>>>')
}

const assertOnce = (text: string, needle: string) => {
  expect(countOccurrences(text, needle)).toBe(1)
}

const assertSingleLine = (text: string, line: string) => {
  expect(text.split('\n').filter((candidate) => candidate.trim() === line).length).toBe(1)
}

const singleLineOffset = (text: string, line: string) => {
  let offset = 0
  let found: number | null = null

  for (const candidate of text.split('\n')) {
    if (candidate.trim() === line) {
      expect(found, line).toBeNull()
      found = offset
    }

    offset += candidate.length + 1
  }

  expect(found, line).not.toBeNull()
  return found!
}

const assertBefore = (text: string, first: string, second: string) => {
  expect(text.indexOf(first)).toBeGreaterThanOrEqual(0)
  expect(text.indexOf(second)).toBeGreaterThanOrEqual(0)
  expect(text.indexOf(first)).toBeLessThan(text.indexOf(second))
}

const assertReadableActiveBlock = (text: string, body: string, id: string) => {
  assertOnce(text, body)
  assertOnce(text, endAnchor(id))
  expect(text).toContain(`${body}\n${endAnchor(id)}`)
  assertBefore(text, body, endAnchor(id))
  assertBefore(text, endAnchor(id), appendMarker)
}

const assertHistoryAfterAppendMarker = (text: string, note: string) => {
  assertOnce(text, note)
  assertBefore(text, appendMarker, note)
}

const assertAppendMarkerContract = (text: string) => {
  assertSingleLine(text, activeStartMarker)
  assertSingleLine(text, appendMarker)
  const activeStart = singleLineOffset(text, activeStartMarker)
  const appendStart = singleLineOffset(text, appendMarker)
  expect(activeStart).toBeLessThan(appendStart)
  expect(text.slice(appendStart)).not.toContain('\n- [ ] ')
}

const makeRepo = (initialDebt: string) => {
  const root = mkdtempSync(join(tmpdir(), 'bbm-debt-merge-'))

  git(root, ['init', '--initial-branch=main'])
  git(root, ['config', 'user.email', 'codex@example.invalid'])
  git(root, ['config', 'user.name', 'Codex Test'])
  git(root, ['config', 'core.autocrlf', 'false'])

  writeFileSync(
    join(root, '.gitattributes'),
    readFileSync(resolve(process.cwd(), '.gitattributes'), 'utf8'),
    'utf8',
  )
  writeFileSync(join(root, 'DEBT.md'), initialDebt, 'utf8')

  git(root, ['add', '.gitattributes', 'DEBT.md'])
  git(root, ['commit', '-m', 'base'])

  return root
}

const mergeBothOrders = ({
  branchA,
  branchAContent,
  branchB,
  branchBContent,
  initialDebt,
}: {
  branchA: string
  branchAContent: string
  branchB: string
  branchBContent: string
  initialDebt: string
}) => {
  const results: string[] = []

  for (const order of [
    [branchA, branchB],
    [branchB, branchA],
  ]) {
    const root = makeRepo(initialDebt)

    try {
      git(root, ['checkout', '-b', branchA])
      writeFileSync(join(root, 'DEBT.md'), branchAContent, 'utf8')
      git(root, ['commit', '-am', `${branchA} debt change`])

      git(root, ['checkout', 'main'])
      git(root, ['checkout', '-b', branchB])
      writeFileSync(join(root, 'DEBT.md'), branchBContent, 'utf8')
      git(root, ['commit', '-am', `${branchB} debt change`])

      git(root, ['checkout', 'main'])
      git(root, ['merge', '--no-edit', order[0]!])

      const secondMerge = runGit(root, ['merge', '--no-edit', order[1]!])
      expect(
        secondMerge.status,
        `${order.join(' then ')} should not conflict\n${secondMerge.stdout}\n${secondMerge.stderr}`,
      ).toBe(0)

      results.push(readFileSync(join(root, 'DEBT.md'), 'utf8'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  }

  return results
}

const parseActiveRegion = (text: string) => {
  const normalized = text.replace(/\r\n/g, '\n')
  const start = singleLineOffset(normalized, activeStartMarker)
  const end = singleLineOffset(normalized, appendMarker)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)

  const blocks: string[] = []
  let current: string[] = []

  for (const line of normalized
    .slice(start + activeStartMarker.length, end)
    .trim()
    .split('\n')) {
    if (line.trim() === '') continue

    if (line.startsWith('- [ ] ')) {
      if (current.length > 0) blocks.push(current.join('\n').trim())
      current = [line]
      continue
    }

    if (line.startsWith('<!-- debt-entry-end: ')) {
      if (current.length === 0) {
        blocks.push(line)
      } else {
        current.push(line)
        blocks.push(current.join('\n').trim())
        current = []
      }
      continue
    }

    if (current.length > 0) {
      current.push(line)
      continue
    }

    throw new Error('DEBT.md active text after anchor must start a new bullet')
  }

  if (current.length > 0) blocks.push(current.join('\n').trim())

  return blocks.filter(Boolean)
}

const lineCount = (text: string, line: string) =>
  text.split('\n').filter((candidate) => candidate.trim() === line).length

const collectAddedDebtAnchorIds = (cwd: string) => {
  const shallow = git(cwd, ['rev-parse', '--is-shallow-repository']).stdout.trim()

  if (shallow !== 'false') {
    throw new Error(
      'DEBT.md anchor history check requires full git history; configure actions/checkout with fetch-depth: 0',
    )
  }

  const log = git(cwd, [
    'log',
    '--format=',
    '--patch',
    '--no-ext-diff',
    '--unified=0',
    'HEAD',
    '--',
    'DEBT.md',
  ]).stdout
  const ids = new Set<string>()

  for (const line of log.split('\n')) {
    const match = /^\+<!-- debt-entry-end: ([a-z0-9-]+) -->$/.exec(line)
    if (match) ids.add(match[1]!)
  }

  return [...ids].sort()
}

const missingHistoricalAnchors = (cwd: string, debt: string) =>
  collectAddedDebtAnchorIds(cwd).filter((id) => lineCount(debt, endAnchor(id)) !== 1)

describe('DEBT.md merge protocol', () => {
  it('keeps two concurrent active appends in both merge orders', () => {
    const initialDebt = renderDebt([activeBlock(baseBody, 'base-entry')])
    const alphaBlock = activeBlock(alphaBody, 'alpha-entry')
    const betaBlock = activeBlock(betaBody, 'beta-entry')
    const results = mergeBothOrders({
      branchA: 'alpha',
      branchAContent: insertBeforeAppendMarker(initialDebt, alphaBlock),
      branchB: 'beta',
      branchBContent: insertBeforeAppendMarker(initialDebt, betaBlock),
      initialDebt,
    })

    for (const mergedDebt of results) {
      noConflict(mergedDebt)
      assertAppendMarkerContract(mergedDebt)
      assertReadableActiveBlock(mergedDebt, baseBody, 'base-entry')
      assertReadableActiveBlock(mergedDebt, alphaBody, 'alpha-entry')
      assertReadableActiveBlock(mergedDebt, betaBody, 'beta-entry')
      assertHistoryAfterAppendMarker(mergedDebt, historicalNote)
    }
  })

  it('keeps a swept last-entry body deleted while preserving its anchor and a concurrent append', () => {
    const removedId = 'removed-entry'
    const initialDebt = renderDebt([
      activeBlock(keptBody, 'kept-entry'),
      activeBlock(removedBody, removedId),
    ])
    const sweepDebt = renderDebt(
      [activeBlock(keptBody, 'kept-entry'), endAnchor(removedId)],
      [historicalNote, sweepPromotionNote],
    )
    const appendDebt = insertBeforeAppendMarker(
      initialDebt,
      activeBlock(appendedBody, 'append-entry'),
    )
    const results = mergeBothOrders({
      branchA: 'sweep',
      branchAContent: sweepDebt,
      branchB: 'append',
      branchBContent: appendDebt,
      initialDebt,
    })

    for (const mergedDebt of results) {
      noConflict(mergedDebt)
      assertAppendMarkerContract(mergedDebt)
      expect(countOccurrences(mergedDebt, removedBody)).toBe(0)
      assertOnce(mergedDebt, endAnchor(removedId))
      assertReadableActiveBlock(mergedDebt, keptBody, 'kept-entry')
      assertReadableActiveBlock(mergedDebt, appendedBody, 'append-entry')
      assertBefore(mergedDebt, endAnchor(removedId), appendedBody)
      assertHistoryAfterAppendMarker(mergedDebt, historicalNote)
      assertHistoryAfterAppendMarker(mergedDebt, sweepPromotionNote)
    }
  })

  it('the shipped DEBT.md has one append marker and unique anchors for every active block', () => {
    const debt = readFileSync(resolve(process.cwd(), 'DEBT.md'), 'utf8')

    assertAppendMarkerContract(debt)
    expect(missingHistoricalAnchors(process.cwd(), debt)).toEqual([])

    const activeBlocks = parseActiveRegion(debt)
    const anchors = new Set<string>()

    for (const block of activeBlocks) {
      const matches = [...block.matchAll(/<!-- debt-entry-end: ([a-z0-9-]+) -->/g)]

      expect(matches.length, block).toBe(1)
      expect(block.endsWith(matches[0]![0]), block).toBe(true)
      expect(block.startsWith('- [ ] ') || block === matches[0]![0], block).toBe(true)
      expect(anchors.has(matches[0]![1]), matches[0]![1]).toBe(false)
      anchors.add(matches[0]![1])
    }
  })

  it('parses each active body with its closing anchor and rejects text after an anchor', () => {
    expect(parseActiveRegion(renderDebt([activeBlock(baseBody, 'base-entry')]))).toEqual([
      activeBlock(baseBody, 'base-entry'),
    ])
    expect(parseActiveRegion(renderDebt([endAnchor('swept-entry')]))).toEqual([
      endAnchor('swept-entry'),
    ])
    expect(() =>
      parseActiveRegion(renderDebt([`${activeBlock(baseBody, 'base-entry')}\nstray continuation`])),
    ).toThrow('DEBT.md active text after anchor must start a new bullet')
  })

  it('detects a sweep that deletes an anchor together with its body from repository history', () => {
    const root = makeRepo(renderDebt([activeBlock(baseBody, 'lost-anchor')]))
    const withoutBodyOrAnchor = renderDebt([])

    try {
      writeFileSync(join(root, 'DEBT.md'), withoutBodyOrAnchor, 'utf8')
      git(root, ['commit', '-am', 'delete debt body and anchor'])

      expect(missingHistoricalAnchors(root, readFileSync(join(root, 'DEBT.md'), 'utf8'))).toEqual([
        'lost-anchor',
      ])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('keeps the root-only merge attribute scoped to the root ledger', () => {
    const root = makeRepo(renderDebt([activeBlock(baseBody, 'base-entry')]))
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'nested', 'DEBT.md'), '# nested debt is not the root ledger\n', 'utf8')

    try {
      expect(git(root, ['check-attr', 'merge', '--', 'DEBT.md', 'nested/DEBT.md']).stdout).toBe(
        ['DEBT.md: merge: union', 'nested/DEBT.md: merge: unspecified', ''].join('\n'),
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
