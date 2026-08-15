import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'

import lintStaged from 'lint-staged'
import { check, getFileInfo } from 'prettier'
import { describe, expect, it } from 'vitest'

type LintStagedTask = string | string[]

type PackageConfig = {
  scripts: Record<string, string>
  'lint-staged': Record<string, LintStagedTask>
}

const repoRoot = resolve(import.meta.dirname, '..', '..')
const packageConfig = JSON.parse(
  readFileSync(resolve(repoRoot, 'package.json'), 'utf8'),
) as PackageConfig
const prettierConfig = JSON.parse(
  readFileSync(resolve(repoRoot, '.prettierrc.json'), 'utf8'),
) as Record<string, unknown>
const ciWorkflow = readFileSync(resolve(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')

const formatCheckGlobs = (script: string) =>
  [...script.matchAll(/"([^"]+)"/g)].map((match) => match[1])

const lintStagedPrettierGlobs = (config: Record<string, LintStagedTask>) =>
  Object.entries(config)
    .filter(([, task]) => {
      const commands = Array.isArray(task) ? task : [task]
      return commands.some((command) => command.startsWith('prettier '))
    })
    .map(([glob]) => glob)

const assertAlignedPrettierPolicy = (checked: string[], written: string[]) => {
  const checkedSet = new Set(checked)
  const writtenSet = new Set(written)
  const checkOnly = checked.filter((glob) => !writtenSet.has(glob))
  const hookOnly = written.filter((glob) => !checkedSet.has(glob))

  if (checkOnly.length > 0 || hookOnly.length > 0) {
    throw new Error(
      `Prettier policy divergence: format:check-only=[${checkOnly.join(', ')}]; ` +
        `lint-staged-only=[${hookOnly.join(', ')}]`,
    )
  }
}

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

describe('canonical Prettier policy on cross-platform checkouts', () => {
  it('accepts a CRLF-only difference', async () => {
    expect(
      await check("const value = 'already formatted'\r\n", {
        ...prettierConfig,
        filepath: 'fixture.ts',
      }),
    ).toBe(true)
  })

  it('still rejects a substantive formatting violation', async () => {
    expect(
      await check('const value={nested:true}\r\n', {
        ...prettierConfig,
        filepath: 'fixture.ts',
      }),
    ).toBe(false)
  })
})

describe('format-check and pre-commit policy', () => {
  it('makes format:check reject an unformatted file under .claude', () => {
    const fixtureDir = mkdtempSync(resolve(repoRoot, '.claude', '.format-policy-test-'))
    const fixture = resolve(fixtureDir, 'fixture.md')
    writeFileSync(fixture, '# malformed\n\n-   item\n', 'utf8')

    try {
      const result = spawnSync('pnpm', ['format:check'], {
        cwd: repoRoot,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      })

      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain(basename(fixture))
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  }, 20_000)

  it('keeps format:check and lint-staged Prettier globs identical', () => {
    expect(() =>
      assertAlignedPrettierPolicy(
        formatCheckGlobs(packageConfig.scripts['format:check']),
        lintStagedPrettierGlobs(packageConfig['lint-staged']),
      ),
    ).not.toThrow()
  })

  it('names the divergent surface when only one policy changes', () => {
    const aligned = ['src/**/*.md']
    const oneSidedGlob = 'policy-divergence-fixture/**/*.md'

    expect(() => assertAlignedPrettierPolicy([...aligned, oneSidedGlob], aligned)).toThrow(
      `Prettier policy divergence: format:check-only=[${oneSidedGlob}]`,
    )
  })

  it('leaves staged pnpm-lock.yaml bytes untouched when lint-staged runs', async () => {
    const fixtureRepo = mkdtempSync(join(tmpdir(), 'bbm-lint-staged-policy-'))
    const lockfile = resolve(fixtureRepo, 'pnpm-lock.yaml')

    try {
      writeFileSync(
        resolve(fixtureRepo, 'package.json'),
        `${JSON.stringify({ private: true }, null, 2)}\n`,
        'utf8',
      )
      copyFileSync(resolve(repoRoot, '.prettierignore'), resolve(fixtureRepo, '.prettierignore'))
      writeFileSync(lockfile, "lockfileVersion: '9.0'\n\npackages: {}\n", 'utf8')

      git(fixtureRepo, ['init', '--quiet'])
      git(fixtureRepo, ['config', 'user.name', 'Format Policy Test'])
      git(fixtureRepo, ['config', 'user.email', 'format-policy@example.invalid'])
      git(fixtureRepo, ['add', '.'])
      git(fixtureRepo, ['commit', '--quiet', '--no-verify', '-m', 'fixture baseline'])

      const stagedBytes = Buffer.from("lockfileVersion: '9.0'\n\npackages:    {}\n")
      writeFileSync(lockfile, stagedBytes)
      git(fixtureRepo, ['add', 'pnpm-lock.yaml'])
      const before = execFileSync('git', ['show', ':pnpm-lock.yaml'], {
        cwd: fixtureRepo,
        encoding: 'buffer',
      })

      const success = await lintStaged({
        concurrent: false,
        config: packageConfig['lint-staged'],
        cwd: fixtureRepo,
        quiet: true,
        stash: false,
      })
      const after = execFileSync('git', ['show', ':pnpm-lock.yaml'], {
        cwd: fixtureRepo,
        encoding: 'buffer',
      })

      expect(success).toBe(true)
      expect(after.equals(before)).toBe(true)
      expect(after.equals(stagedBytes)).toBe(true)
    } finally {
      rmSync(fixtureRepo, { recursive: true, force: true })
    }
  })

  it('formats staged Markdown and JSON files at the repository root', async () => {
    const fixtureRepo = mkdtempSync(join(tmpdir(), 'bbm-lint-staged-root-policy-'))
    const markdown = resolve(fixtureRepo, 'README.md')
    const json = resolve(fixtureRepo, 'fixture.json')

    try {
      copyFileSync(resolve(repoRoot, '.prettierignore'), resolve(fixtureRepo, '.prettierignore'))
      writeFileSync(markdown, '# Root fixture\n', 'utf8')
      writeFileSync(json, '{}\n', 'utf8')

      git(fixtureRepo, ['init', '--quiet'])
      git(fixtureRepo, ['config', 'user.name', 'Format Policy Test'])
      git(fixtureRepo, ['config', 'user.email', 'format-policy@example.invalid'])
      git(fixtureRepo, ['add', '.'])
      git(fixtureRepo, ['commit', '--quiet', '--no-verify', '-m', 'fixture baseline'])

      writeFileSync(markdown, '# Root fixture\n\n-   item\n', 'utf8')
      writeFileSync(json, '{"fixture":true}\n', 'utf8')
      git(fixtureRepo, ['add', 'README.md', 'fixture.json'])

      const success = await lintStaged({
        concurrent: false,
        config: packageConfig['lint-staged'],
        cwd: fixtureRepo,
        quiet: true,
        stash: false,
      })

      expect(success).toBe(true)
      expect(git(fixtureRepo, ['show', ':README.md'])).toBe('# Root fixture\n\n- item\n')
      expect(git(fixtureRepo, ['show', ':fixture.json'])).toBe('{ "fixture": true }\n')
    } finally {
      rmSync(fixtureRepo, { recursive: true, force: true })
    }
  })

  it('checks generator-owned Payload types in blocking CI', () => {
    expect(
      packageConfig.scripts['generate:types:check'],
      'generated Payload types need a byte-drift check',
    ).toBe('pnpm generate:types && git diff --exit-code -- src/payload-types.ts')
    expect(ciWorkflow, 'blocking CI must run the generated Payload types check').toContain(
      'run: pnpm generate:types:check',
    )
  })

  it.each([
    'pnpm-lock.yaml',
    'src/payload-types.ts',
    'tools/lint/guard-tests/fixtures/workflow-auth/unwired/package.json',
  ])('keeps %s outside both Prettier writers', async (path) => {
    const info = await getFileInfo(resolve(repoRoot, path), {
      ignorePath: resolve(repoRoot, '.prettierignore'),
    })

    expect(info.ignored, relative(repoRoot, resolve(repoRoot, path))).toBe(true)
  })
})
