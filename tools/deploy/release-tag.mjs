#!/usr/bin/env node
// bbm-portal — cut the repo-level release at the DEPLOYED sha (task 7.6, #137;
// port of ds-platform `tools/release/cut-release.mjs`).
//
// `pnpm deploy:prod` is the release INITIATOR: when the box is confirmed serving
// the new code, the script cuts ONE git tag + GitHub Release at the sha that
// shipped. "Release == what shipped" — not what a version bump claimed, and not
// what a merge into main promised (a merge only means the code is mergeable;
// this repo deploys manually, so main runs ahead of prod by design).
//
// Tag format: `release-YYYY.MM.DD-<n>` — calendar date + a same-day monotonic
// ordinal. Deliberately NOT semver: this repo ships one deploy unit whose
// package.json version nobody bumps, so a semver tag would be a second fiction
// to maintain. The Release notes are GitHub's own `--generate-notes` (diffed
// since the previous release).
//
// bbm-portal has NO `release-*` tag yet, so the first `deploy:prod` run cuts the
// inaugural `release-<today>-1`. ds hit a real bug on exactly this edge (their
// #975) and both halves of the fix are ported here deliberately:
//   • `shouldCutRelease` treats "no prior tag" as CUT (not as "cannot compute");
//   • the digest's baseline for a repo with no prior tag is the repo-root
//     commit, so the inaugural digest covers the full history rather than
//     silently ranging over nothing (`tools/ci/post-release-digest.mjs`).
//
// Error posture: the I/O seam NEVER throws and never fails the deploy. By the
// time it runs, prod is already serving the new code — a tag that could not be
// cut is a warning to act on, not a reason to call a good deploy failed. Every
// decision lives in a pure seam (unit-tested in tests/unit/deploy-release.spec.ts);
// git/gh access goes through an injectable runner so the tests never shell out.

import { spawnSync } from 'node:child_process'

const TAG_RE = /^release-(\d{4}\.\d{2}\.\d{2})-(\d+)$/
const SHA_RE = /^[0-9a-f]{7,40}$/i

/**
 * Parse a release tag into `{ date, ordinal }`, or `null` when it is not the
 * canonical shape. Pure.
 */
export function parseReleaseTag(tag) {
  if (typeof tag !== 'string') return null
  const m = TAG_RE.exec(tag)
  if (!m) return null
  return { date: m[1], ordinal: Number(m[2]) }
}

/**
 * The next tag for `dateStr` (a `YYYY.MM.DD` string INJECTED by the caller —
 * this never reads the clock) given the existing tags.
 *
 * The ordinal is max+1 among the same day's tags, not count+1: a deleted tag
 * must never let a used ordinal be issued twice. Pure.
 */
export function nextReleaseTag(existingTags, dateStr) {
  const tags = Array.isArray(existingTags) ? existingTags : []
  let max = 0
  for (const tag of tags) {
    const parsed = parseReleaseTag(tag)
    if (parsed && parsed.date === dateStr && parsed.ordinal > max) max = parsed.ordinal
  }
  return `release-${dateStr}-${max + 1}`
}

/**
 * The most recent `release-*` tag: max by (date, ordinal). The date sorts
 * lexically == chronologically; the ordinal is zero-padded before comparison so
 * `-10` beats `-2` (the lexical trap). Pure.
 */
export function latestReleaseTag(existingTags) {
  const tags = Array.isArray(existingTags) ? existingTags : []
  let best = null
  let bestKey = null
  for (const tag of tags) {
    const parsed = parseReleaseTag(tag)
    if (!parsed) continue
    const key = `${parsed.date}#${String(parsed.ordinal).padStart(9, '0')}`
    if (bestKey === null || key > bestKey) {
      bestKey = key
      best = tag
    }
  }
  return best
}

/**
 * Non-empty-range guard: cut only when the deployed sha is a STRICT descendant
 * of the latest release — i.e. `latestReleaseSha..deployedSha` is non-empty.
 * Pure; the caller resolves the git facts.
 *
 *   no prior tag                      → cut (the inaugural release)
 *   deployedSha === latestReleaseSha  → skip (redeploy, empty range)
 *   latest release not an ancestor    → skip (behind / diverged — never cut backwards)
 *   otherwise                         → cut
 *
 * @param {{ latestReleaseSha?: string|null, deployedSha?: string,
 *           releaseIsAncestor?: boolean }} [facts]
 * @returns {{ cut: boolean, reason: string }}
 */
export function shouldCutRelease({ latestReleaseSha, deployedSha, releaseIsAncestor = false } = {}) {
  if (!deployedSha) return { cut: false, reason: 'no deployed sha' }
  if (!latestReleaseSha) return { cut: true, reason: 'no prior release — first release' }
  if (deployedSha === latestReleaseSha)
    return { cut: false, reason: 'deployed sha already released (empty range)' }
  if (!releaseIsAncestor)
    return {
      cut: false,
      reason: 'latest release is not an ancestor of the deployed sha (nothing new / diverged)',
    }
  return { cut: true, reason: 'new commits since the latest release' }
}

function log(msg) {
  process.stdout.write(`[release-tag] ${msg}\n`)
}

/** Today in the `YYYY.MM.DD` shape the tag uses (UTC — one clock for all boxes). */
function todayDateStr(now = new Date()) {
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  return `${yyyy}.${mm}.${dd}`
}

/**
 * I/O seam — cut the tag + GitHub Release for the DEPLOYED sha. NEVER throws:
 * every failure logs and returns `{ cut: false }`.
 *
 * `targetSha` is the explicit deployed sha (the one pre-flight fixed from
 * `origin/main`), NOT local `HEAD` — the deploy tool may legitimately run from a
 * maintenance branch, and the tag must land on exactly what shipped.
 *
 * @param {{ targetSha: string, cwd?: string, now?: Date,
 *           run?: (cmd: string, args: string[]) => { status: number|null, stdout?: string, stderr?: string } }} opts
 * @returns {{ cut: boolean, tag?: string, reason: string }}
 */
export function cutDeployRelease({ targetSha, cwd = process.cwd(), now = new Date(), run } = {}) {
  const exec = run || ((cmd, args) => spawnSync(cmd, args, { cwd, encoding: 'utf8' }))

  try {
    if (!targetSha || !SHA_RE.test(targetSha)) {
      log(`⚠ needs an explicit target sha, got: ${targetSha ?? '(none)'} — skipping (green).`)
      return { cut: false, reason: 'no valid target sha' }
    }

    // The deploy fetches origin/main but not tags — make the release tags present
    // locally so the range guard sees the real latest release. Non-fatal.
    const fetched = exec('git', ['fetch', '--tags', '--force', 'origin'])
    if (fetched.status !== 0) {
      log(`⚠ \`git fetch --tags\` failed (continuing with local tags): ${(fetched.stderr || '').trim()}`)
    }

    const tagRes = exec('git', ['tag', '-l', 'release-*'])
    if (tagRes.status !== 0) {
      log(`⚠ \`git tag -l\` failed — skipping (green): ${(tagRes.stderr || '').trim()}`)
      return { cut: false, reason: 'git tag -l failed' }
    }
    const existingTags = (tagRes.stdout || '').split(/\r?\n/).filter(Boolean)
    const latestTag = latestReleaseTag(existingTags)

    // `rev-list -n 1` dereferences an annotated tag to its commit.
    let latestReleaseSha = null
    if (latestTag) {
      const shaRes = exec('git', ['rev-list', '-n', '1', latestTag])
      if (shaRes.status !== 0) {
        log(`⚠ could not resolve ${latestTag} — skipping (green): ${(shaRes.stderr || '').trim()}`)
        return { cut: false, reason: `cannot resolve ${latestTag}` }
      }
      latestReleaseSha = (shaRes.stdout || '').trim()
    }

    // `merge-base --is-ancestor A B` exits 0 when A is an ancestor of B. Only
    // asked when the shas differ — an equal sha is its own ancestor, but that is
    // the empty-range redeploy the pure guard rejects first.
    let releaseIsAncestor = false
    if (latestReleaseSha && latestReleaseSha !== targetSha) {
      releaseIsAncestor =
        exec('git', ['merge-base', '--is-ancestor', latestReleaseSha, targetSha]).status === 0
    }

    const decision = shouldCutRelease({
      latestReleaseSha,
      deployedSha: targetSha,
      releaseIsAncestor,
    })
    if (!decision.cut) {
      log(`no release cut — ${decision.reason}.`)
      return { cut: false, reason: decision.reason }
    }

    const tag = nextReleaseTag(existingTags, todayDateStr(now))

    // `gh` creates the underlying git tag at --target when it does not exist.
    const rel = exec('gh', [
      'release',
      'create',
      tag,
      '--generate-notes',
      '--target',
      targetSha,
      '--title',
      tag,
    ])
    if (rel.status !== 0) {
      log(`⚠ \`gh release create ${tag}\` failed — skipping (green): ${(rel.stderr || '').trim()}`)
      return { cut: false, reason: 'gh release create failed' }
    }
    log(`cut release ${tag} at ${targetSha.slice(0, 12)} (${decision.reason}).`)
    return { cut: true, tag, reason: decision.reason }
  } catch (e) {
    // Belt and braces: never fail a deploy that already succeeded.
    log(`⚠ unexpected error, skipping (green): ${e?.message ?? String(e)}`)
    return { cut: false, reason: 'unexpected error' }
  }
}
