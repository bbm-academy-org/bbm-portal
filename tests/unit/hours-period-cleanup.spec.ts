import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  APP_STOP_CONFIRMATION,
  TARGET_PERIOD_ID,
  applyCleanupToFile,
  buildCleanupPlan,
  canonicalJson,
  canonicalSha256,
} from '../../tools/ops/cleanup-hours-period.mjs'

const targetPeriod = {
  id: TARGET_PERIOD_ID,
  label: '2 спринт',
  date_from: '2026-05-01',
  date_to: '2026-07-30',
  status: 'closed',
}

function fixture() {
  return {
    participants: [
      {
        email: 'anton@bbm.academy',
        name: 'Антон',
        role: 'Системный архитектор и руководитель продуктового направления',
        fork_min: 150_000,
        fork_max: 250_000,
        grade: 'II',
      },
    ],
    periods: [
      {
        id: 'keep-period',
        label: 'Рабочий',
        date_from: '2026-08-01',
        date_to: '2026-08-31',
        status: 'open',
      },
      targetPeriod,
    ],
    assessments: [
      { period_id: 'keep-period', email: 'anton@bbm.academy', hours: 1 },
      { period_id: TARGET_PERIOD_ID, email: 'anton@bbm.academy', hours: 160 },
    ],
    publications: [
      { period_id: TARGET_PERIOD_ID, status: 'published', messages: [{ delivery: 'sent' }] },
      { period_id: 'keep-period', status: 'sending', messages: [] },
    ],
    module_version: 7,
    future_root_data: { z: [3, 2, 1], a: { preserved: true } },
  }
}

describe('hours exact-period cleanup core (spec 102)', () => {
  it('removes exactly the audited period and its assessment/publication', () => {
    const before = fixture()
    const plan = buildCleanupPlan(before)

    expect(plan.status).toBe('ready')
    expect(plan.removed).toEqual({ periods: 1, assessments: 1, publications: 1 })
    expect(plan.cleaned.periods).toEqual([before.periods[0]])
    expect(plan.cleaned.assessments).toEqual([before.assessments[0]])
    expect(plan.cleaned.publications).toEqual([before.publications[1]])
    expect(plan.cleaned.participants).toEqual(before.participants)
    expect(plan.cleaned.future_root_data).toEqual(before.future_root_data)
    expect(Object.keys(plan.cleaned)).toEqual(Object.keys(before))

    expect(plan.preservation.before).toEqual(plan.preservation.after)
  })

  it('canonical hashes sort object keys but preserve array order', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}')
    expect(canonicalSha256({ a: 1, z: [2, 1] })).toBe(canonicalSha256({ z: [2, 1], a: 1 }))
    expect(canonicalSha256({ z: [2, 1], a: 1 })).not.toBe(canonicalSha256({ z: [1, 2], a: 1 }))
  })

  it('refuses drift from the exact audited target before producing a staged document', () => {
    expect(() => buildCleanupPlan({ ...fixture(), periods: [] })).toThrow(
      /ровно один целевой период/,
    )
    expect(() =>
      buildCleanupPlan({
        ...fixture(),
        periods: [{ ...targetPeriod, status: 'open' }],
      }),
    ).toThrow(/closed/)
    expect(() => buildCleanupPlan({ ...fixture(), assessments: [] })).toThrow(
      /ровно одна целевая оценка/,
    )
  })

  it('is repeatable: an already-clean document is reported and never rebuilt', () => {
    const cleaned = buildCleanupPlan(fixture()).cleaned
    const plan = buildCleanupPlan(cleaned)
    expect(plan.status).toBe('already-clean')
    expect(plan.cleaned).toBe(cleaned)
    expect(plan.removed).toEqual({ periods: 0, assessments: 0, publications: 0 })
  })
})

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('hours cleanup file transaction rollback fixture', () => {
  it('applies exact cleanup, protects artifacts, and is a no-write second run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bbm-hours-cleanup-success-'))
    dirs.push(dir)
    const liveFile = join(dir, 'hours.json')
    const backupDirectory = join(dir, 'backups')
    const before = fixture()
    const original = `${JSON.stringify(before, null, 2)}\n`
    writeFileSync(liveFile, original, { encoding: 'utf8', mode: 0o640 })
    const originalMode = statSync(liveFile).mode & 0o777

    const result = await applyCleanupToFile({
      liveFile,
      backupDirectory,
      appStoppedConfirmation: APP_STOP_CONFIRMATION,
    })

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') throw new Error('expected applied cleanup result')
    const { jit_backup: jitBackup, same_volume_rollback: rollbackCopy, report } = result
    if (!jitBackup || !rollbackCopy || !report) throw new Error('expected cleanup artifacts')
    const cleanedBytes = readFileSync(liveFile)
    const cleaned = JSON.parse(cleanedBytes.toString('utf8'))
    expect(cleaned).toEqual(buildCleanupPlan(before).cleaned)
    expect(cleaned.participants).toEqual(before.participants)
    expect(cleaned.periods).toEqual([before.periods[0]])
    expect(cleaned.assessments).toEqual([before.assessments[0]])
    expect(cleaned.publications).toEqual([before.publications[1]])
    expect(cleaned.future_root_data).toEqual(before.future_root_data)
    expect(statSync(liveFile).mode & 0o777).toBe(originalMode)

    for (const artifact of [jitBackup, rollbackCopy]) {
      expect(readFileSync(artifact, 'utf8')).toBe(original)
      if (process.platform !== 'win32') expect(statSync(artifact).mode & 0o777).toBe(0o600)
    }
    if (process.platform !== 'win32') expect(statSync(report).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(report, 'utf8')).status).toBe('applied')

    const beforeSecondRun = statSync(liveFile, { bigint: true })
    const second = await applyCleanupToFile({
      liveFile,
      backupDirectory,
      appStoppedConfirmation: APP_STOP_CONFIRMATION,
    })
    const afterSecondRun = statSync(liveFile, { bigint: true })
    expect(second.status).toBe('already-clean')
    expect(readFileSync(liveFile)).toEqual(cleanedBytes)
    expect(afterSecondRun.ino).toBe(beforeSecondRun.ino)
    expect(afterSecondRun.mtimeNs).toBe(beforeSecondRun.mtimeNs)
  })

  it('atomically restores the exact frozen bytes and metadata after a post-rename failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bbm-hours-cleanup-'))
    dirs.push(dir)
    const liveFile = join(dir, 'hours.json')
    const backupDirectory = join(dir, 'backups')
    const original = `${JSON.stringify(fixture(), null, 2)}\n`
    writeFileSync(liveFile, original, { encoding: 'utf8', mode: 0o640 })
    const originalMode = statSync(liveFile).mode & 0o777

    await expect(
      applyCleanupToFile({
        liveFile,
        backupDirectory,
        appStoppedConfirmation: APP_STOP_CONFIRMATION,
        afterRename: () => {
          throw new Error('fixture post-rename failure')
        },
      }),
    ).rejects.toThrow(/rollback confirmed/)

    expect(readFileSync(liveFile, 'utf8')).toBe(original)
    expect(statSync(liveFile).mode & 0o777).toBe(originalMode)
  })
})

describe('hours cleanup runbook failure semantics', () => {
  it('restarts after a confirmed recovery but exits nonzero before success postchecks', () => {
    const runbook = readFileSync(
      join(__dirname, '..', '..', 'docs', 'runbooks', 'hours-period-102-cleanup.md'),
      'utf8',
    )
    expect(runbook).toContain('CLEANUP_APPLIED=0')
    expect(runbook).toMatch(/CLEANUP_STATUS" -eq 0[\s\S]*CLEANUP_APPLIED=1/)
    expect(runbook).toMatch(
      /rollback confirmed from JIT backup\|live file unchanged and confirmed[\s\S]*SAFE_TO_START=1/,
    )
    const restart = runbook.indexOf('$COMPOSE up -d app')
    const notApplied = runbook.indexOf('cleanup not applied')
    const postcheck = runbook.indexOf('## Post-check')
    expect(restart).toBeGreaterThan(0)
    expect(notApplied).toBeGreaterThan(restart)
    expect(postcheck).toBeGreaterThan(notApplied)
    expect(runbook.slice(restart, postcheck)).toMatch(/exit [1-9]/)
  })
})
