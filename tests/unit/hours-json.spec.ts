import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HoursDataError } from '@/lib/hours'
import type { HoursDocument } from '@/lib/hours'

import { normalizeDocument, readJsonDocument } from '../../tools/platform/hours-json'

/**
 * The frozen archive reader (`tools/platform/hours-json.ts`, spec 124 EARS-15/16,
 * EARS-26/27).
 *
 * This parser used to be the application's storage layer, covered by
 * `tests/unit/hours-store.spec.ts`; #256 deleted the store and moved the PARSER
 * to `tools/`. The cases below are the half of that suite that survived the move
 * — everything about the legacy document SHAPE — re-pointed at the reader. The
 * other half (`resolveDataFile`, the tmp+rename write, the in-process mutex,
 * mutation refusals) died with the write path it described and is not ported.
 *
 * Why the shape cases still matter after the cutover: this reader is the only
 * thing that will ever parse `hours.json.<date>` again, and its output is one
 * side of the `pnpm platform:hours:verify` verdict. A normalization drift here
 * does not fail loudly — it produces a confident, WRONG `VERDICT: identical`.
 *
 * The one deliberate deviation from the frozen original gets its own case: a
 * missing file is an error out loud, where the store returned an empty document
 * (081 §17, correct for an app booting on a fresh volume, wrong for a verifier
 * pointed at an archive by hand).
 */

let dir: string
let file: string

const seed: HoursDocument = {
  participants: [
    {
      email: 'anton@bbm.academy',
      name: 'Антон',
      role: 'Продукт',
      fork_min: 150_000,
      fork_max: 250_000,
      grade: 'II',
    },
    {
      email: 'eduard@bbm.academy',
      name: 'Эдуард',
      role: 'Операции',
      fork_min: 100_000,
      fork_max: 200_000,
      grade: 'I',
    },
  ],
  periods: [
    {
      id: 'p-july',
      label: 'Июль 2026',
      date_from: '2026-07-01',
      date_to: '2026-07-31',
      status: 'open',
    },
  ],
  assessments: [],
  publications: [],
}

function write(content: unknown): void {
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bbm-hours-archive-'))
  file = join(dir, 'hours.json.2026-08-18')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readJsonDocument — reading the archive', () => {
  it('EARS-16: reads an archived document back as it was written', async () => {
    write(seed)
    await expect(readJsonDocument(file)).resolves.toEqual(seed)
  })

  it('EARS-15: a MISSING file is an error out loud, not an empty document', async () => {
    // The deliberate change of behaviour when the parser left the app. The store
    // answered «empty» because a missing file meant a fresh volume; the only
    // caller now is a verifier pointed at an archive by hand, where «empty» would
    // be compared against a populated `core` — or, worse, against an empty one.
    await expect(readJsonDocument(join(dir, 'nope.json'))).rejects.toBeInstanceOf(HoursDataError)
  })

  it('accepts a relative path, resolved against the process cwd', async () => {
    write(seed)
    await expect(readJsonDocument(file)).resolves.toEqual(seed)
    // The path is an ARGUMENT — no environment variable takes part in resolving
    // it, which is what let `HOURS_DATA_FILE` be deleted outright.
    await expect(readJsonDocument('tests/unit/hours-json.spec.ts')).rejects.toBeInstanceOf(
      HoursDataError,
    )
  })

  it('an EMPTY file reads as an empty document, as it always did', async () => {
    write('   \n')
    await expect(readJsonDocument(file)).resolves.toEqual({
      participants: [],
      periods: [],
      assessments: [],
      publications: [],
    })
  })

  it('malformed JSON is a HoursDataError naming the file', async () => {
    write('{ это не json')
    await expect(readJsonDocument(file)).rejects.toBeInstanceOf(HoursDataError)
    await expect(readJsonDocument(file)).rejects.toThrow(/битый JSON/)
  })

  it('valid JSON of the wrong kind is a HoursDataError too', async () => {
    write('[1,2,3]')
    await expect(readJsonDocument(file)).rejects.toBeInstanceOf(HoursDataError)
  })
})

describe('normalizeDocument — the legacy document shape', () => {
  it('normalizes email on read, on participants and assessments alike', () => {
    // Hand-editing the file on the host was a SUPPORTED path (081 §16), so
    // `Anton@BBM.Academy` exists in real history. Without this the archive and
    // `core` would differ on case alone and the verdict would say so.
    const doc = normalizeDocument({
      participants: [{ ...seed.participants[0], email: '  Anton@BBM.Academy ' }],
      periods: seed.periods,
      assessments: [
        {
          period_id: 'p-july',
          email: 'ANTON@bbm.academy',
          hours: 160,
          method: 'period',
          weekend_hours: 0,
          split_percent: 0,
          monthly_rate: 200_000,
          hourly_rate: 200_000 / 184,
          accrual: 173_913,
          cash_amount: 173_913,
          invest_amount: 0,
          weekday_count: 23,
          saved_at: '2026-08-01T09:00:00.000Z',
        },
      ],
    })
    expect(doc.participants[0].email).toBe('anton@bbm.academy')
    expect(doc.assessments[0].email).toBe('anton@bbm.academy')
  })

  it('drops the legacy participant `monthly_rate` (issue #83)', () => {
    const doc = normalizeDocument({
      participants: [{ ...seed.participants[0], monthly_rate: 999_999 }],
      periods: [],
      assessments: [],
    })
    expect(doc.participants[0]).not.toHaveProperty('monthly_rate')
    expect(doc.participants[0].fork_min).toBe(150_000)
  })

  it('reads a participant that carries only name and email', () => {
    const doc = normalizeDocument({
      participants: [{ email: 'new@bbm.academy', name: 'Новый' }],
      periods: [],
      assessments: [],
    })
    expect(doc.participants[0]).toEqual({ email: 'new@bbm.academy', name: 'Новый' })
  })

  it('fills missing sections with empty ones — an older document still reads', () => {
    expect(normalizeDocument({ participants: seed.participants })).toEqual({
      participants: seed.participants,
      periods: [],
      assessments: [],
      publications: [],
    })
  })

  it('keeps a publication batch whole, delivery progress included', () => {
    const batch = {
      period_id: 'p-july',
      status: 'incomplete',
      started_at: '2026-08-02T00:00:00.000Z',
      published_at: null,
      preview_fingerprint: 'sha256:test',
      messages: [
        {
          email: 'anton@bbm.academy',
          text: 'Сообщение 1',
          delivery: 'sent',
          sent_at: '2026-08-02T00:00:01.000Z',
        },
        { email: 'eduard@bbm.academy', text: 'Сообщение 2', delivery: 'failed', sent_at: null },
      ],
    }
    expect(normalizeDocument({ ...seed, publications: [batch] }).publications).toEqual([batch])
  })

  it('refuses a publications node that is not an array', () => {
    expect(() => normalizeDocument({ ...seed, publications: { period_id: 'p-july' } })).toThrow(
      HoursDataError,
    )
  })

  it('refuses a corrupted publication, naming its position', () => {
    expect(() =>
      normalizeDocument({ ...seed, publications: [{ period_id: 'p-july', status: 'nonsense' }] }),
    ).toThrow(/повреждённую публикацию #1/)
  })

  it('refuses a publication whose message is malformed', () => {
    const batch = {
      period_id: 'p-july',
      status: 'sending',
      started_at: '2026-08-02T00:00:00.000Z',
      published_at: null,
      preview_fingerprint: 'sha256:test',
      messages: [{ email: 'anton@bbm.academy', text: 'x', delivery: 'teleported', sent_at: null }],
    }
    expect(() => normalizeDocument({ ...seed, publications: [batch] })).toThrow(HoursDataError)
  })

  it('refuses two publications for one period — the audit trail must stay singular', () => {
    const batch = {
      period_id: 'p-july',
      status: 'published',
      started_at: '2026-08-02T00:00:00.000Z',
      published_at: '2026-08-02T00:01:00.000Z',
      preview_fingerprint: 'sha256:test',
      messages: [],
    }
    expect(() => normalizeDocument({ ...seed, publications: [batch, { ...batch }] })).toThrow(
      /больше одной публикации/,
    )
  })
})
