/**
 * The FROZEN read-only reader of the legacy hours JSON document (spec 124
 * EARS-15, EARS-16, EARS-26/27).
 *
 * Until the 2026-08-18 cutover this parser was the app's storage layer
 * (`src/lib/hours/store.ts`, spec 081 §«Хранение (без БД)»). The cutover moved
 * `/p/hours` onto the `core` schema and #256 deleted that module: the app has no
 * JSON code path of any kind, and no fallback (EARS-12). What survives here is
 * the PARSER alone, in `tools/`, for one reason — `pnpm platform:hours:verify
 * <archive>` must keep answering «is what `core` holds still the document that
 * was imported?» against the archived `hours.json.<date>` on the volume, and the
 * only honest way to read that file is with the code that produced the document
 * the import consumed.
 *
 * What is deliberately GONE, not moved:
 *
 *  - **Every write path.** No tmp-file + rename, no mutation, no mutex. This file
 *    opens the document `readFile`-only, so EARS-16 («the import shall never
 *    mutate the source») holds by construction and not by care.
 *  - **`HOURS_DATA_FILE`.** The path is an ARGUMENT now. The variable is removed
 *    from the app, from `.env.example`, from `deploy/.env.prod.example` and from
 *    the box's `.env.prod`; a reader that still consulted it would be the one
 *    place able to resurrect it.
 *  - **`HoursDataError` as a second class.** It is imported from `@/lib/hours`,
 *    which serves the `core` store's one (`src/lib/hours/core/errors.ts`). The
 *    duplicate the JSON store carried died with `store.ts`.
 *
 * ONE behaviour deliberately differs from the frozen original, and it is the
 * change of caller: a MISSING file used to mean «empty document» (the app booting
 * on a fresh volume, 081 §17). Here the only caller is a verifier pointed at an
 * archive by hand, where a typo'd path silently reading as an empty document
 * would produce a confident, wrong verdict. A missing file is an error out loud.
 *
 * The normalization is otherwise byte-identical to what the running app applied
 * to that file for its whole life: `lower(btrim(email))` on every participant and
 * every assessment, the legacy `monthly_rate` participant field dropped (#83), a
 * corrupted publication node refused rather than silently repaired.
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import {
  emptyHoursDocument,
  HoursDataError,
  normalizeEmail,
  type HoursDocument,
  type Publication,
  type PublicationDelivery,
  type PublicationStatus,
} from '@/lib/hours'

const PUBLICATION_STATUSES: PublicationStatus[] = ['sending', 'published', 'incomplete']
const DELIVERY_STATUSES: PublicationDelivery[] = ['pending', 'sent', 'failed', 'unknown']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function normalizePublication(raw: unknown, index: number): Publication {
  const invalid = (): never => {
    throw new HoursDataError(
      `Файл данных модуля часов содержит повреждённую публикацию #${index + 1}.`,
    )
  }
  if (!isRecord(raw)) return invalid()
  if (
    typeof raw.period_id !== 'string' ||
    !raw.period_id ||
    typeof raw.status !== 'string' ||
    !PUBLICATION_STATUSES.includes(raw.status as PublicationStatus) ||
    typeof raw.started_at !== 'string' ||
    !isNullableString(raw.published_at) ||
    typeof raw.preview_fingerprint !== 'string' ||
    !raw.preview_fingerprint ||
    !Array.isArray(raw.messages)
  ) {
    return invalid()
  }

  const messages = raw.messages.map((message) => {
    if (
      !isRecord(message) ||
      typeof message.email !== 'string' ||
      !normalizeEmail(message.email) ||
      typeof message.text !== 'string' ||
      typeof message.delivery !== 'string' ||
      !DELIVERY_STATUSES.includes(message.delivery as PublicationDelivery) ||
      !isNullableString(message.sent_at)
    ) {
      return invalid()
    }
    return {
      email: normalizeEmail(message.email),
      text: message.text,
      delivery: message.delivery as PublicationDelivery,
      sent_at: message.sent_at,
    }
  })

  return {
    period_id: raw.period_id,
    status: raw.status as PublicationStatus,
    started_at: raw.started_at,
    published_at: raw.published_at,
    preview_fingerprint: raw.preview_fingerprint,
    messages,
  }
}

/**
 * The legacy document shape, validated (spec 081 §14).
 *
 * Email is the key of both a participant and an assessment, and hand-editing the
 * file on the host was a SUPPORTED path of spec 081 §16 — so `Anton@BBM.Academy`
 * exists in real history and is canonicalized here, on the boundary with the
 * disk, exactly as the app always did.
 */
export function normalizeDocument(raw: unknown): HoursDocument {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HoursDataError('Файл данных модуля часов имеет неожиданную структуру.')
  }
  const value = raw as Partial<HoursDocument>
  const document = emptyHoursDocument()
  if (Array.isArray(value.participants)) {
    document.participants = value.participants.map((participant) => {
      // Documents older than 2026-07-30 carried `monthly_rate` on the participant;
      // the rate is computed from fork + grade now and the field is dropped on
      // read (#83) rather than round-tripped forever.
      const { monthly_rate: _legacyRate, ...rest } = (participant ?? {}) as unknown as Record<
        string,
        unknown
      > & { monthly_rate?: unknown }
      return {
        ...(rest as unknown as (typeof document.participants)[number]),
        email: normalizeEmail(participant?.email),
      }
    })
  }
  if (Array.isArray(value.periods)) document.periods = value.periods
  if (Array.isArray(value.assessments)) {
    document.assessments = value.assessments.map((assessment) => ({
      ...assessment,
      email: normalizeEmail(assessment?.email),
    }))
  }
  if (value.publications !== undefined) {
    if (!Array.isArray(value.publications)) {
      throw new HoursDataError('Файл данных модуля часов содержит повреждённый узел publications.')
    }
    document.publications = value.publications.map(normalizePublication)
    const periodIds = document.publications.map((publication) => publication.period_id)
    if (new Set(periodIds).size !== periodIds.length) {
      throw new HoursDataError(
        'Файл данных модуля часов содержит больше одной публикации для периода.',
      )
    }
  }
  return document
}

/**
 * Read and validate an archived hours document. Read-only, always (EARS-16).
 *
 * @param file path to `hours.json` or its `hours.json.<date>` archive; a relative
 *   path resolves against the process cwd.
 */
export async function readJsonDocument(file: string): Promise<HoursDocument> {
  const target = isAbsolute(file) ? file : resolve(process.cwd(), file)
  let text: string
  try {
    text = await readFile(target, 'utf8')
  } catch (error) {
    throw new HoursDataError(`Не удалось прочитать файл данных ${target}.`, { cause: error })
  }
  if (text.trim() === '') return emptyHoursDocument()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new HoursDataError(`Файл данных ${target} содержит битый JSON.`, { cause: error })
  }
  return normalizeDocument(parsed)
}
