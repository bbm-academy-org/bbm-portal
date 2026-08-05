import { describe, expect, it } from 'vitest'

import {
  cutDeployRelease,
  latestReleaseTag,
  nextReleaseTag,
  parseReleaseTag,
  shouldCutRelease,
} from '../../tools/deploy/release-tag.mjs'
import {
  buildDeploymentPayload,
  createDeploymentRecord,
} from '../../tools/deploy/deployment-record.mjs'

/**
 * Release identity of a deploy (task 7.6, #137). Two records are written at the
 * moment `deploy:prod` succeeds:
 *
 *   • a git tag + GitHub Release `release-YYYY.MM.DD-<n>` at the DEPLOYED sha —
 *     "release == what shipped", not "what a version bump said";
 *   • a GitHub Deployment(production, sha) + `success` status, which is also
 *     the EVENT that fires the Mattermost prod digest from CI (the deploy runs
 *     from a workstation and has no repo secrets — spec §3 decision 13).
 *
 * Both are NON-FATAL by contract: they run after the box is already serving the
 * new code, so a `gh` hiccup must never turn a good deploy red. The pure seams
 * carry the decisions; the I/O seams take an injectable runner so nothing here
 * shells out.
 */

// ── tag algebra ──────────────────────────────────────────────────────────────

describe('parseReleaseTag', () => {
  it('parses the canonical shape into date + ordinal', () => {
    expect(parseReleaseTag('release-2026.08.05-1')).toEqual({ date: '2026.08.05', ordinal: 1 })
    expect(parseReleaseTag('release-2026.12.31-17')).toEqual({ date: '2026.12.31', ordinal: 17 })
  })

  it('rejects anything else — a stray tag must never anchor a release', () => {
    for (const tag of [
      'v1.0.0',
      'release-2026.08.05',
      'release-2026-08-05-1',
      'release-2026.08.05-',
      'release-2026.08.05-1-hotfix',
      'prerelease-2026.08.05-1',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(parseReleaseTag(tag as never), String(tag)).toBeNull()
    }
  })
})

describe('nextReleaseTag', () => {
  it('is -1 on a day with no releases yet', () => {
    expect(nextReleaseTag(['release-2026.08.04-3'], '2026.08.05')).toBe('release-2026.08.05-1')
  })

  it('is the FIRST tag this repo ever cuts when no tags exist (bbm-portal today)', () => {
    // bbm-portal has no `release-*` tag at all: the inaugural deploy cuts -1.
    expect(nextReleaseTag([], '2026.08.05')).toBe('release-2026.08.05-1')
  })

  it('increments past the same day’s highest ordinal', () => {
    expect(
      nextReleaseTag(
        ['release-2026.08.05-1', 'release-2026.08.05-2', 'release-2026.08.04-9'],
        '2026.08.05',
      ),
    ).toBe('release-2026.08.05-3')
  })

  it('uses max+1, not count+1 — a deleted tag never re-issues a used ordinal', () => {
    expect(nextReleaseTag(['release-2026.08.05-1', 'release-2026.08.05-4'], '2026.08.05')).toBe(
      'release-2026.08.05-5',
    )
  })

  it('ignores malformed and unrelated tags', () => {
    expect(nextReleaseTag(['v2.0.0', 'release-2026.08.05-x', null], '2026.08.05')).toBe(
      'release-2026.08.05-1',
    )
  })
})

describe('latestReleaseTag', () => {
  it('is null when the repo has no release tags yet', () => {
    expect(latestReleaseTag([])).toBeNull()
    expect(latestReleaseTag(['v1.2.3', 'nightly'])).toBeNull()
  })

  it('picks the newest by date, then by same-day ordinal', () => {
    expect(
      latestReleaseTag(['release-2026.08.04-9', 'release-2026.08.05-1', 'release-2026.07.31-4']),
    ).toBe('release-2026.08.05-1')
  })

  it('orders ordinals numerically — -10 beats -2 (the lexical trap)', () => {
    expect(latestReleaseTag(['release-2026.08.05-2', 'release-2026.08.05-10'])).toBe(
      'release-2026.08.05-10',
    )
  })
})

describe('shouldCutRelease', () => {
  it('cuts the inaugural release when no prior tag exists', () => {
    expect(shouldCutRelease({ latestReleaseSha: null, deployedSha: 'abc1234' })).toEqual({
      cut: true,
      reason: 'no prior release — first release',
    })
  })

  it('does not cut an empty range (redeploy of the released sha)', () => {
    expect(shouldCutRelease({ latestReleaseSha: 'abc1234', deployedSha: 'abc1234' }).cut).toBe(
      false,
    )
  })

  it('does not cut when the last release is not an ancestor (behind / diverged)', () => {
    expect(
      shouldCutRelease({
        latestReleaseSha: 'aaa1111',
        deployedSha: 'bbb2222',
        releaseIsAncestor: false,
      }).cut,
    ).toBe(false)
  })

  it('cuts when new commits landed since the last release', () => {
    expect(
      shouldCutRelease({
        latestReleaseSha: 'aaa1111',
        deployedSha: 'bbb2222',
        releaseIsAncestor: true,
      }),
    ).toEqual({ cut: true, reason: 'new commits since the latest release' })
  })

  it('never cuts without a deployed sha', () => {
    expect(shouldCutRelease({ latestReleaseSha: null, deployedSha: '' }).cut).toBe(false)
    expect(shouldCutRelease({}).cut).toBe(false)
  })
})

describe('cutDeployRelease — I/O seam (injected runner, never shells out)', () => {
  const sha = 'f'.repeat(40)

  /** Record every command; answer from a table keyed by the joined argv. */
  function runner(table: Record<string, { status: number; stdout?: string; stderr?: string }>) {
    const calls: string[][] = []
    const run = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      const key = [cmd, ...args].join(' ')
      return table[key] ?? { status: 0, stdout: '', stderr: '' }
    }
    return { calls, run }
  }

  it('cuts the inaugural tag at the DEPLOYED sha, not local HEAD', () => {
    const { calls, run } = runner({
      'git tag -l release-*': { status: 0, stdout: '' },
    })
    const res = cutDeployRelease({ targetSha: sha, now: new Date('2026-08-05T12:00:00Z'), run })
    expect(res).toMatchObject({ cut: true, tag: 'release-2026.08.05-1' })
    const create = calls.find((c) => c[0] === 'gh' && c[1] === 'release')
    expect(create).toEqual([
      'gh',
      'release',
      'create',
      'release-2026.08.05-1',
      '--generate-notes',
      '--target',
      sha,
      '--title',
      'release-2026.08.05-1',
    ])
  })

  it('refuses a target that is not a sha (green skip, no gh call)', () => {
    const { calls, run } = runner({})
    expect(cutDeployRelease({ targetSha: 'origin/main', run }).cut).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('skips green when the deployed sha is already the latest release', () => {
    const { calls, run } = runner({
      'git tag -l release-*': { status: 0, stdout: 'release-2026.08.04-1\n' },
      'git rev-list -n 1 release-2026.08.04-1': { status: 0, stdout: `${sha}\n` },
    })
    expect(cutDeployRelease({ targetSha: sha, run }).cut).toBe(false)
    expect(calls.some((c) => c[0] === 'gh')).toBe(false)
  })

  it('never throws when gh fails — the deploy already succeeded', () => {
    const { run } = runner({
      'git tag -l release-*': { status: 0, stdout: '' },
      [`gh release create release-2026.08.05-1 --generate-notes --target ${sha} --title release-2026.08.05-1`]:
        { status: 1, stderr: 'HTTP 403' },
    })
    expect(
      cutDeployRelease({ targetSha: sha, now: new Date('2026-08-05T12:00:00Z'), run }).cut,
    ).toBe(false)
  })

  it('never throws when the runner itself explodes', () => {
    const run = () => {
      throw new Error('spawn ENOENT')
    }
    expect(cutDeployRelease({ targetSha: sha, run }).cut).toBe(false)
  })
})

// ── GitHub Deployment record ─────────────────────────────────────────────────

describe('buildDeploymentPayload', () => {
  const base = {
    sha: 'a'.repeat(40),
    releaseTag: 'release-2026.08.05-1',
    healthUrl: 'https://cms.bbm.academy/api/health',
    nowIso: '2026-08-05T12:00:00.000Z',
  }

  it('creates a production Deployment carrying the notes in its payload', () => {
    const { deployment } = buildDeploymentPayload({ ...base, notesText: 'Что вошло: часы.' })
    expect(deployment).toMatchObject({
      ref: base.sha,
      environment: 'production',
      auto_merge: false,
      required_contexts: [],
      payload: {
        releaseTag: 'release-2026.08.05-1',
        notes: 'Что вошло: часы.',
        deployedAt: base.nowIso,
      },
    })
    expect(deployment.description).toBe(`release release-2026.08.05-1 @ ${'a'.repeat(12)}`)
  })

  it('marks it success and points log_url at the health endpoint', () => {
    const { status } = buildDeploymentPayload({ ...base, notesText: 'Первая строка\nвторая' })
    expect(status).toMatchObject({
      state: 'success',
      environment: 'production',
      log_url: 'https://cms.bbm.academy/api/health',
      description: 'Первая строка',
    })
  })

  it('falls back to the release name when there are no notes', () => {
    expect(buildDeploymentPayload({ ...base, notesText: '' }).status.description).toBe(
      'release release-2026.08.05-1',
    )
  })

  it('records an untagged deploy rather than failing', () => {
    const { deployment } = buildDeploymentPayload({ ...base, releaseTag: null, notesText: '' })
    expect(deployment.payload.releaseTag).toBeNull()
    expect(deployment.description).toContain('(untagged)')
  })

  it('strips 4-byte emoji from descriptions — GitHub rejects them with a 422', () => {
    // The digest's first line is `## 🚀 Релиз на PROD`; the description columns
    // are legacy 3-byte utf8. Cyrillic (BMP) survives, the rocket does not.
    const { status, deployment } = buildDeploymentPayload({
      ...base,
      notesText: '## 🚀 Релиз на PROD',
    })
    // The emoji is removed, not replaced — the surrounding spaces stay put.
    expect(status.description).toBe('##  Релиз на PROD')
    expect(status.description).not.toMatch(/\p{Extended_Pictographic}/u)
    // The JSON payload column keeps the emoji verbatim.
    expect(deployment.payload.notes).toContain('🚀')
  })

  it('truncates a long description to GitHub’s 140-char ceiling', () => {
    const { status } = buildDeploymentPayload({ ...base, notesText: 'x'.repeat(300) })
    expect(status.description).toHaveLength(140)
    expect(status.description.endsWith('…')).toBe(true)
  })
})

describe('createDeploymentRecord — never throws, reports structurally', () => {
  it('creates the deployment then its success status', () => {
    const calls: string[][] = []
    const run = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      return { status: 0, stdout: JSON.stringify({ id: 4242 }) }
    }
    const res = createDeploymentRecord({
      sha: 'b'.repeat(40),
      releaseTag: 'release-2026.08.05-1',
      notesText: '',
      healthUrl: 'https://cms.bbm.academy/api/health',
      run,
    })
    expect(res).toEqual({ ok: true, deploymentId: 4242 })
    expect(calls[0].slice(0, 4)).toEqual(['gh', 'api', '-X', 'POST'])
    expect(calls[0]).toContain('repos/{owner}/{repo}/deployments')
    expect(calls[1]).toContain('repos/{owner}/{repo}/deployments/4242/statuses')
  })

  it('reports a gh failure instead of throwing', () => {
    const run = () => ({ status: 1, stdout: '{"message":"Validation Failed"}', stderr: 'HTTP 422' })
    const res = createDeploymentRecord({
      sha: 'b'.repeat(40),
      releaseTag: null,
      notesText: '',
      healthUrl: 'https://cms.bbm.academy/api/health',
      run,
    })
    expect(res.ok).toBe(false)
    // Both gh channels are surfaced: the summary AND the body naming the field.
    expect(res.error).toContain('HTTP 422')
    expect(res.error).toContain('Validation Failed')
  })

  it('reports a response with no numeric id instead of throwing', () => {
    const run = () => ({ status: 0, stdout: 'null' })
    const res = createDeploymentRecord({
      sha: 'b'.repeat(40),
      releaseTag: null,
      notesText: '',
      healthUrl: 'https://cms.bbm.academy/api/health',
      run,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no numeric id/)
  })
})
