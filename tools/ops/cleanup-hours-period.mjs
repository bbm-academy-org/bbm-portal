#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { chmod, chown, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const TARGET_PERIOD_ID = '4b741c5e-0b54-45c4-a54a-60cc4fd84936'
export const APP_STOP_CONFIRMATION = 'app-stopped-and-frozen'

const TARGET_PERIOD = {
  id: TARGET_PERIOD_ID,
  label: '2 спринт',
  date_from: '2026-05-01',
  date_to: '2026-07-30',
  status: 'closed',
}
const MANAGED_ARRAYS = ['participants', 'periods', 'assessments', 'publications']
const PRESERVATION_KEYS = ['participants', 'periods', 'assessments', 'publications', 'root_data']
/** @type {(step: string) => unknown} */
const ignoreTransactionStep = () => undefined

export class CleanupInvariantError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CleanupInvariantError'
  }
}

function invariant(condition, message) {
  if (!condition) throw new CleanupInvariantError(message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateDocument(document) {
  invariant(isRecord(document), 'Документ hours должен быть JSON-объектом.')
  for (const key of MANAGED_ARRAYS) {
    invariant(Array.isArray(document[key]), `Корневой узел ${key} должен быть массивом.`)
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

/** Canonical JSON sorts object keys recursively and deliberately preserves array order. */
export function canonicalJson(value) {
  const serialized = JSON.stringify(canonicalize(value))
  invariant(serialized !== undefined, 'Значение нельзя представить как JSON.')
  return serialized
}

export function canonicalSha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function bytesSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function rootData(document) {
  return Object.fromEntries(
    Object.entries(document).filter(([key]) => !MANAGED_ARRAYS.includes(key)),
  )
}

function preservedValues(document) {
  return {
    participants: document.participants,
    periods: document.periods.filter((period) => period?.id !== TARGET_PERIOD_ID),
    assessments: document.assessments.filter(
      (assessment) => assessment?.period_id !== TARGET_PERIOD_ID,
    ),
    publications: document.publications.filter(
      (publication) => publication?.period_id !== TARGET_PERIOD_ID,
    ),
    root_data: rootData(document),
  }
}

function preservationSnapshot(document) {
  return Object.fromEntries(
    Object.entries(preservedValues(document)).map(([key, value]) => [
      key,
      {
        count: Array.isArray(value) ? value.length : Object.keys(value).length,
        serialized: JSON.stringify(value),
        canonical_sha256: canonicalSha256(value),
      },
    ]),
  )
}

function targetRecords(document) {
  return {
    periods: document.periods.filter((period) => period?.id === TARGET_PERIOD_ID),
    assessments: document.assessments.filter(
      (assessment) => assessment?.period_id === TARGET_PERIOD_ID,
    ),
    publications: document.publications.filter(
      (publication) => publication?.period_id === TARGET_PERIOD_ID,
    ),
  }
}

function assertExactAuditTarget(targets) {
  invariant(targets.periods.length === 1, 'Ожидался ровно один целевой период.')
  invariant(targets.assessments.length === 1, 'Ожидалась ровно одна целевая оценка.')
  invariant(targets.publications.length === 1, 'Ожидалась ровно одна целевая publication.')

  const period = targets.periods[0]
  for (const [key, expected] of Object.entries(TARGET_PERIOD)) {
    invariant(period?.[key] === expected, `Целевой период должен иметь ${key}=${expected}.`)
  }

  const publication = targets.publications[0]
  invariant(publication?.status === 'published', 'Целевая publication должна быть published.')
  invariant(
    Array.isArray(publication?.messages) &&
      publication.messages.length === 1 &&
      publication.messages[0]?.delivery === 'sent',
    'Целевая publication должна содержать ровно одну подтверждённую доставку sent.',
  )
}

function assertPreserved(before, after) {
  for (const key of Object.keys(before)) {
    invariant(before[key].count === after[key].count, `Изменился count сохранённого набора ${key}.`)
    invariant(
      before[key].serialized === after[key].serialized,
      `Изменился сериализованный сохранённый набор ${key}.`,
    )
    invariant(
      before[key].canonical_sha256 === after[key].canonical_sha256,
      `Изменился canonical SHA-256 сохранённого набора ${key}.`,
    )
  }
}

/**
 * Pure cleanup core. It replaces only periods/assessments/publications with
 * filtered arrays and preserves every other root key without reconstructing it.
 */
export function buildCleanupPlan(document) {
  validateDocument(document)
  const targets = targetRecords(document)
  const counts = Object.fromEntries(
    Object.entries(targets).map(([key, records]) => [key, records.length]),
  )
  const totalTargets = Object.values(counts).reduce((sum, count) => sum + count, 0)

  if (totalTargets === 0) {
    const snapshot = preservationSnapshot(document)
    return {
      status: 'already-clean',
      cleaned: document,
      removed: counts,
      preservation: { before: snapshot, after: snapshot },
    }
  }

  assertExactAuditTarget(targets)
  const before = preservationSnapshot(document)
  const cleaned = {
    ...document,
    periods: document.periods.filter((period) => period?.id !== TARGET_PERIOD_ID),
    assessments: document.assessments.filter(
      (assessment) => assessment?.period_id !== TARGET_PERIOD_ID,
    ),
    publications: document.publications.filter(
      (publication) => publication?.period_id !== TARGET_PERIOD_ID,
    ),
  }
  const remaining = targetRecords(cleaned)
  invariant(
    Object.values(remaining).every((records) => records.length === 0),
    'Staged-документ всё ещё содержит целевые записи.',
  )
  const after = preservationSnapshot(cleaned)
  assertPreserved(before, after)
  return {
    status: 'ready',
    cleaned,
    removed: counts,
    preservation: { before, after },
  }
}

function parseDocument(bytes, source) {
  try {
    const document = JSON.parse(bytes.toString('utf8'))
    validateDocument(document)
    return document
  } catch (cause) {
    if (cause instanceof CleanupInvariantError) throw cause
    throw new CleanupInvariantError(`${source} содержит невалидный JSON: ${cause.message}`)
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '')
}

async function writeExclusiveSynced(file, bytes, mode = 0o600) {
  const handle = await open(file, 'wx', mode)
  try {
    await handle.writeFile(bytes)
    await handle.chmod(mode)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncFile(file) {
  const handle = await open(file, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(directory) {
  let handle
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch (cause) {
    if (process.platform !== 'win32') throw cause
  } finally {
    await handle?.close()
  }
}

async function applyMetadata(file, metadata) {
  try {
    await chown(file, metadata.uid, metadata.gid)
  } catch (cause) {
    if (process.platform !== 'win32') throw cause
  }
  await chmod(file, metadata.mode)
  await syncFile(file)
}

async function assertMetadata(file, expected) {
  const current = await stat(file)
  invariant((current.mode & 0o777) === expected.mode, 'Mode live-файла изменился.')
  if (process.platform !== 'win32') {
    invariant(current.uid === expected.uid, 'Numeric owner live-файла изменился.')
    invariant(current.gid === expected.gid, 'Numeric group live-файла изменился.')
  }
}

function assertCleanedMatches(frozenDocument, candidateDocument) {
  const expected = buildCleanupPlan(frozenDocument)
  invariant(expected.status === 'ready', 'Frozen pre-state уже не содержит точную audit-цель.')
  const actual = buildCleanupPlan(candidateDocument)
  invariant(actual.status === 'already-clean', 'Кандидат после очистки содержит целевые записи.')
  assertPreserved(expected.preservation.before, actual.preservation.before)
  invariant(
    JSON.stringify(expected.cleaned) === JSON.stringify(candidateDocument),
    'Кандидат отличается от единственного допустимого фильтрованного документа.',
  )
}

async function restoreFromJit({
  liveFile,
  jitBackup,
  frozenBytes,
  frozenDocument,
  metadata,
  stamp,
}) {
  const directory = dirname(liveFile)
  const restoreFile = `${liveFile}.restore-${stamp}`
  const backupBytes = await readFile(jitBackup)
  invariant(bytesSha256(backupBytes) === bytesSha256(frozenBytes), 'JIT backup hash mismatch.')
  invariant(
    canonicalJson(parseDocument(backupBytes, 'JIT backup')) === canonicalJson(frozenDocument),
    'JIT backup JSON mismatch.',
  )

  await writeExclusiveSynced(restoreFile, backupBytes)
  await applyMetadata(restoreFile, metadata)
  const stagedRestore = await readFile(restoreFile)
  invariant(bytesSha256(stagedRestore) === bytesSha256(frozenBytes), 'Rollback temp hash mismatch.')
  parseDocument(stagedRestore, 'Rollback temp')
  await rename(restoreFile, liveFile)
  await syncDirectory(directory)

  const restored = await readFile(liveFile)
  invariant(bytesSha256(restored) === bytesSha256(frozenBytes), 'Restored live hash mismatch.')
  parseDocument(restored, 'Restored live')
  await assertMetadata(liveFile, metadata)
}

function publicPreservation(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot).map(([key, value]) => [
      key,
      { count: value.count, canonical_sha256: value.canonical_sha256 },
    ]),
  )
}

function assertPreservationSnapshotShape(snapshot, source) {
  invariant(isRecord(snapshot), `${source}: preservation snapshot отсутствует.`)
  invariant(
    JSON.stringify(Object.keys(snapshot).sort()) === JSON.stringify([...PRESERVATION_KEYS].sort()),
    `${source}: preservation snapshot содержит не полный набор секций.`,
  )
  for (const key of PRESERVATION_KEYS) {
    const value = snapshot[key]
    invariant(isRecord(value), `${source}: секция ${key} невалидна.`)
    invariant(
      Number.isInteger(value.count) && value.count >= 0,
      `${source}: count ${key} невалиден.`,
    )
    invariant(typeof value.serialized === 'string', `${source}: serialized ${key} отсутствует.`)
    invariant(
      typeof value.canonical_sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.canonical_sha256),
      `${source}: canonical SHA-256 ${key} невалиден.`,
    )
  }
}

export function verifyPostCleanup(document, report) {
  invariant(isRecord(report), 'Frozen cleanup report должен быть JSON-объектом.')
  invariant(report.status === 'applied', 'Frozen cleanup report не подтверждает applied cleanup.')
  invariant(
    report.target_period_id === TARGET_PERIOD_ID,
    'Frozen cleanup report относится к другому period.',
  )
  invariant(isRecord(report.preservation), 'Frozen cleanup report не содержит preservation.')
  assertPreservationSnapshotShape(report.preservation.before, 'Frozen report before')
  assertPreservationSnapshotShape(report.preservation.after, 'Frozen report after')
  assertPreserved(report.preservation.before, report.preservation.after)

  const current = buildCleanupPlan(document)
  invariant(current.status === 'already-clean', 'Post-start live всё ещё содержит целевые записи.')
  assertPreserved(report.preservation.before, current.preservation.before)

  return {
    status: 'post-cleanup-verified',
    target_period_id: TARGET_PERIOD_ID,
    removed: current.removed,
    frozen_sha256: report.frozen_sha256,
    preservation: publicPreservation(current.preservation.before),
  }
}

/**
 * File transaction used by the runbook. The caller must stop and independently
 * verify the app before passing the exact confirmation phrase.
 */
export async function applyCleanupToFile({
  liveFile,
  backupDirectory,
  appStoppedConfirmation,
  afterRename = async () => undefined,
  onTransactionStep = ignoreTransactionStep,
}) {
  invariant(
    appStoppedConfirmation === APP_STOP_CONFIRMATION,
    `Apply requires confirmation ${APP_STOP_CONFIRMATION}.`,
  )
  const absoluteLive = resolve(liveFile)
  const absoluteBackup = resolve(backupDirectory)
  const directory = dirname(absoluteLive)
  const stamp = timestamp()

  const frozenBytes = await readFile(absoluteLive)
  await onTransactionStep('frozen-live-read')
  const fileStat = await stat(absoluteLive)
  const metadata = { uid: fileStat.uid, gid: fileStat.gid, mode: fileStat.mode & 0o777 }
  await onTransactionStep('original-metadata-captured')
  const frozenDocument = parseDocument(frozenBytes, 'Frozen live')
  const frozenTargets = targetRecords(frozenDocument)
  if (Object.values(frozenTargets).every((records) => records.length === 0)) {
    const alreadyClean = buildCleanupPlan(frozenDocument)
    return { status: 'already-clean', removed: alreadyClean.removed }
  }

  await mkdir(absoluteBackup, { recursive: true, mode: 0o700 })
  const frozenSha = bytesSha256(frozenBytes)
  const jitBackup = resolve(absoluteBackup, `${basename(absoluteLive)}.bak-${stamp}`)
  const rollbackCopy = resolve(directory, `.${basename(absoluteLive)}.rollback-${stamp}`)
  const stagedFile = resolve(directory, `.${basename(absoluteLive)}.staged-${stamp}`)
  const reportFile = resolve(absoluteBackup, `hours-cleanup-report-${stamp}.json`)
  let renamed = false

  try {
    await writeExclusiveSynced(jitBackup, frozenBytes)
    await writeExclusiveSynced(rollbackCopy, frozenBytes)
    await onTransactionStep('backups-created')
    for (const backup of [jitBackup, rollbackCopy]) {
      invariant(
        bytesSha256(await readFile(backup)) === frozenSha,
        `Backup hash mismatch: ${backup}`,
      )
    }
    await onTransactionStep('backup-hashes-verified')
    await syncDirectory(absoluteBackup)
    if (directory !== absoluteBackup) await syncDirectory(directory)
    await onTransactionStep('backup-directories-synced')

    const plan = buildCleanupPlan(frozenDocument)
    invariant(plan.status === 'ready', 'Frozen pre-state не содержит точную audit-цель.')
    await onTransactionStep('preservation-snapshot-captured')

    const stagedBytes = Buffer.from(`${JSON.stringify(plan.cleaned, null, 2)}\n`, 'utf8')
    await writeExclusiveSynced(stagedFile, stagedBytes)
    await onTransactionStep('staged-file-written')
    const stagedDocument = parseDocument(await readFile(stagedFile), 'Staged file')
    assertCleanedMatches(frozenDocument, stagedDocument)
    await onTransactionStep('staged-file-validated')
    await applyMetadata(stagedFile, metadata)
    await rename(stagedFile, absoluteLive)
    renamed = true
    await syncDirectory(directory)
    await onTransactionStep('live-file-renamed')

    await afterRename()
    const appliedBytes = await readFile(absoluteLive)
    invariant(bytesSha256(appliedBytes) === bytesSha256(stagedBytes), 'Applied live hash mismatch.')
    assertCleanedMatches(frozenDocument, parseDocument(appliedBytes, 'Applied live'))
    await assertMetadata(absoluteLive, metadata)
    await onTransactionStep('live-file-verified')

    const report = {
      status: 'applied',
      target_period_id: TARGET_PERIOD_ID,
      timestamp: stamp,
      live_file: absoluteLive,
      frozen_sha256: frozenSha,
      metadata,
      jit_backup: jitBackup,
      same_volume_rollback: rollbackCopy,
      removed: plan.removed,
      preservation: plan.preservation,
    }
    await writeExclusiveSynced(reportFile, Buffer.from(`${JSON.stringify(report, null, 2)}\n`))
    await syncDirectory(absoluteBackup)
    await onTransactionStep('report-written')
    return {
      status: 'applied',
      removed: plan.removed,
      frozen_sha256: frozenSha,
      preservation: publicPreservation(plan.preservation.after),
      jit_backup: jitBackup,
      same_volume_rollback: rollbackCopy,
      report: reportFile,
    }
  } catch (cause) {
    await rm(stagedFile, { force: true }).catch(() => undefined)
    if (renamed) {
      try {
        await restoreFromJit({
          liveFile: absoluteLive,
          jitBackup,
          frozenBytes,
          frozenDocument,
          metadata,
          stamp,
        })
      } catch (rollbackCause) {
        throw new Error(
          `${cause.message}; ROLLBACK FAILED: ${rollbackCause.message}. Keep app stopped.`,
          { cause: rollbackCause },
        )
      }
      throw new Error(`${cause.message}; rollback confirmed from JIT backup.`, { cause })
    }

    const currentBytes = await readFile(absoluteLive)
    invariant(bytesSha256(currentBytes) === frozenSha, 'Pre-rename failure changed live bytes.')
    parseDocument(currentBytes, 'Unchanged live')
    await assertMetadata(absoluteLive, metadata)
    throw new Error(`${cause.message}; live file unchanged and confirmed.`, { cause })
  }
}

function parseArgs(argv) {
  const result = { apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') result.apply = true
    else if (arg === '--file') result.liveFile = argv[++index]
    else if (arg === '--backup-dir') result.backupDirectory = argv[++index]
    else if (arg === '--confirm-app-stopped') result.appStoppedConfirmation = argv[++index]
    else if (arg === '--verify-report') result.verifyReport = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  invariant(result.liveFile, 'Required argument: --file.')
  invariant(
    !(result.apply && result.verifyReport),
    '--apply and --verify-report are mutually exclusive.',
  )
  if (result.apply) invariant(result.backupDirectory, 'Apply requires --backup-dir.')
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.verifyReport) {
    const liveFile = resolve(args.liveFile)
    const reportFile = resolve(args.verifyReport)
    const reportStat = await stat(reportFile)
    if (process.platform !== 'win32') {
      invariant((reportStat.mode & 0o777) === 0o600, 'Frozen cleanup report должен иметь mode 600.')
    }
    const report = JSON.parse((await readFile(reportFile)).toString('utf8'))
    invariant(isRecord(report), 'Frozen cleanup report должен быть JSON-объектом.')
    invariant(
      resolve(report.live_file) === liveFile,
      'Frozen cleanup report относится к другому live-файлу.',
    )
    const document = parseDocument(await readFile(liveFile), 'Post-start live')
    process.stdout.write(`${JSON.stringify(verifyPostCleanup(document, report), null, 2)}\n`)
    return
  }
  if (!args.apply) {
    const document = parseDocument(await readFile(resolve(args.liveFile)), 'Live dry-run')
    const plan = buildCleanupPlan(document)
    process.stdout.write(
      `${JSON.stringify(
        {
          status: plan.status,
          target_period_id: TARGET_PERIOD_ID,
          removed: plan.removed,
          preservation: publicPreservation(plan.preservation.before),
        },
        null,
        2,
      )}\n`,
    )
    return
  }
  const result = await applyCleanupToFile(args)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

const isDirectRun = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false
if (isDirectRun) {
  main().catch((cause) => {
    process.stderr.write(`hours cleanup aborted: ${cause.message}\n`)
    process.exitCode = 1
  })
}
