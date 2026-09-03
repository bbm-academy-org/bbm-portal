#!/usr/bin/env node
/**
 * `pnpm dev:seed` — representative dev data for the platform database (#436).
 *
 * **Why this exists.** Owner ruling, Антон, 2026-09-02: every owner-visible
 * stand comes pre-filled — dozens of rows, every lifecycle status — and is
 * driven by the agent before the owner is invited. A freshly branched
 * `platform_<N>` shows empty tables, so composition, density, sorting,
 * pagination and overflow are all invisible at review time, which is exactly
 * the defect class the UX-sanity requirement of 2026-08-31 was created for.
 *
 * **No reminders.** `pnpm dev:db:branch` runs the migrate and this seed itself,
 * so an agent that brings a stand up by the documented path gets a populated
 * database by construction; nothing in a skill, hook or handoff has to say
 * «and then seed». An already-branched database is refreshed by this command
 * alone.
 *
 * **Idempotent by stable slug, not by luck.** Every row this writes carries a
 * fixed identity — a member's email, a period id, a `[seed:<slug>]` marker in an
 * intake note, a `source_ref` — and a rerun matches on it and does nothing.
 * `tests/int/platform/dev-seed.int.spec.ts` asserts that as a content digest
 * over every seeded table, not as row counts: a second run that rewrote rows in
 * place is exactly the failure the slug is for.
 *
 * **Everything goes through the module APIs.** `@/lib/member`, `@/lib/hours`,
 * `@/lib/finance` — no SQL of its own, the same boundary
 * `tools/platform/member-seed.ts` and `finance-acceptance-seed.ts` hold
 * (`src/lib/platform/db/README.md` → Boundaries). That is also why the requests
 * really do walk the spec-339 status machine: a `posted` row here was submitted,
 * documented, approved and posted through `postIntakeItem`, so the ledger
 * postings behind it are real.
 *
 * **What it refuses.** `tools/platform/dev-database-guard.mjs`, before the first
 * statement. See that file for the predicate and for how production differs.
 */
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  approveExpenseRequest,
  cancelExpenseRequest,
  createCounterparty,
  createExpenseRequest,
  createIntakeItem,
  listCounterparties,
  listIntakeItems,
  listAccounts,
  listProducts,
  listProjects,
  listPurposes,
  refuseExpenseRequest,
  submitExpenseRequest,
  uploadFinanceDocument,
  FINANCE_APPROVE_ROLE,
  FINANCE_ENTRY_ROLE,
  type FinanceActor,
  type FinanceIntakeItemView,
} from '@/lib/finance'
import {
  createPeriod,
  mutateHoursDocument,
  saveAssessment,
  setPeriodStatus,
  upsertParticipant,
  type HoursDocument,
  type MutationResult,
} from '@/lib/hours'
import { upsertMemberWithAliases } from '@/lib/member'
import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'
import { closePlatformDb } from '@/lib/platform/db/client'
import { platformTransaction } from '@/lib/platform/db/transaction'

import { assertDevPlatformDatabase } from './dev-database-guard.mjs'
import {
  DEV_SEED_APPROVER_SLUG,
  DEV_SEED_COUNTERPARTIES,
  DEV_SEED_HOURS_PARTICIPANTS,
  DEV_SEED_HOURS_PERIODS,
  DEV_SEED_INTAKE_ITEMS,
  DEV_SEED_MEMBERS,
  DEV_SEED_NOW,
  DEV_SEED_REQUESTS,
  devSeedNote,
  devSeedSlugFromNote,
  type DevSeedIntakeItem,
  type DevSeedMember,
  type DevSeedRequest,
} from './dev-seed-plan'
import { seedFinanceAcceptance } from './finance-acceptance-seed'
import { loadPlatformToolEnv } from './load-env.mjs'

const TAG = 'dev:seed'

/**
 * A real 1×1 PNG.
 *
 * `assertFinanceDocumentBytes` (EARS-514) sniffs the magic bytes and refuses
 * anything whose content does not match its declared type, so a placeholder
 * text file would not get past the upload — and a `posted` request cannot exist
 * without a ready document (EARS-506). The smallest honest PNG is therefore
 * part of the fixture, not decoration.
 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export type DevSeedOptions = {
  /** Defaults to `PLATFORM_DATABASE_URL`; named explicitly by the refusal tests. */
  connectionString?: string
  env?: Record<string, string | undefined>
}

export type DevSeedSummary = {
  database: string
  members: { created: number; updated: number; unchanged: number }
  hours: { periods: number; participants: number; assessments: number }
  finance: {
    referencesCreated: number
    referencesReused: number
    operationsCreated: number
    operationsReused: number
  }
  counterparties: { created: number; reused: number }
  requests: { created: number; reused: number }
  intakeItems: { created: number; reused: number }
  documents: { uploaded: number }
}

const emailOf = (slug: string): string => {
  const member = DEV_SEED_MEMBERS.find((row) => row.slug === slug)
  if (member === undefined) throw new Error(`${TAG}: no seeded member «${slug}»`)
  return member.email
}

/**
 * The one actor that holds every flow role.
 *
 * Deliberately a SEEDED member rather than the operator running the command:
 * `created_by`, `decided_by` and `posted_by` are FKs into `core.member`, so a
 * stand seeded from two different machines would otherwise carry two different
 * authors and stop being comparable.
 */
function approverActor(): FinanceActor {
  return {
    email: emailOf(DEV_SEED_APPROVER_SLUG),
    roles: [PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE, FINANCE_APPROVE_ROLE, FINANCE_ENTRY_ROLE],
  }
}

/** A plain platform member: no flow role, only the EARS-502 carve-out on their own request. */
function submitterActor(slug: string): FinanceActor {
  return { email: emailOf(slug), roles: [PLATFORM_USER_ROLE] }
}

// ── members ─────────────────────────────────────────────────────────────────

async function seedMembers(): Promise<DevSeedSummary['members']> {
  const summary = { created: 0, updated: 0, unchanged: 0 }
  // One transaction for the whole registry, like `platform:member:seed`: a
  // refusal on the thirtieth person must not leave twenty-nine behind.
  await platformTransaction({ actorEmail: null, source: 'cli:dev-seed' }, async (tx) => {
    for (const member of DEV_SEED_MEMBERS as readonly DevSeedMember[]) {
      const outcome = await upsertMemberWithAliases(
        {
          email: member.email,
          name: member.name,
          role: member.role,
          status: member.status,
          slug: member.slug,
          aliases: member.aliases === undefined ? undefined : [...member.aliases],
        },
        { db: tx },
      )
      if (outcome.created) summary.created += 1
      else if (outcome.profileUpdated) summary.updated += 1
      else summary.unchanged += 1
    }
  })
  return summary
}

// ── hours ───────────────────────────────────────────────────────────────────

function unwrap<T>(result: MutationResult<T>, what: string): HoursDocument {
  if (!result.ok) throw new Error(`${TAG}: ${what} — ${result.error}`)
  return result.doc
}

/**
 * Periods, participants and assessments in ONE document mutation.
 *
 * An assessment is only accepted into an OPEN period and the module allows
 * exactly one open period at a time, so each closed period is created, opened,
 * filled and closed again inside this single transaction — which is also why a
 * period that already exists is skipped WHOLE rather than re-filled: reopening
 * it to write the same assessments would be a real state change on a rerun.
 */
async function seedHours(): Promise<DevSeedSummary['hours']> {
  const summary = { periods: 0, participants: 0, assessments: 0 }
  const emailBySlug = new Map(DEV_SEED_MEMBERS.map((member) => [member.slug, member.email]))

  const result = await mutateHoursDocument(
    { actorEmail: null, source: 'cli:dev-seed' },
    (document) => {
      let doc = document

      for (const participant of DEV_SEED_HOURS_PARTICIPANTS) {
        doc = unwrap(
          upsertParticipant(doc, {
            email: emailBySlug.get(participant.memberSlug)!,
            name: DEV_SEED_MEMBERS.find((row) => row.slug === participant.memberSlug)!.name,
            role: participant.role,
            forkMin: participant.forkMin,
            forkMax: participant.forkMax,
            grade: participant.grade,
          }),
          `participant ${participant.memberSlug}`,
        )
        summary.participants += 1
      }

      for (const period of DEV_SEED_HOURS_PERIODS) {
        if (doc.periods.some((row) => row.id === period.id)) continue
        doc = unwrap(
          createPeriod(
            doc,
            { label: period.label, dateFrom: period.dateFrom, dateTo: period.dateTo },
            period.id,
          ),
          `period ${period.id}`,
        )
        // `createPeriod` makes a CLOSED period; assessments need it open.
        doc = unwrap(setPeriodStatus(doc, period.id, 'open'), `open ${period.id}`)
        for (const assessment of period.assessments) {
          doc = unwrap(
            saveAssessment(
              doc,
              {
                periodId: period.id,
                email: emailBySlug.get(assessment.memberSlug)!,
                hours: assessment.hours,
                method: assessment.method,
                weekendHours: assessment.weekendHours,
                splitPercent: assessment.splitPercent,
              },
              DEV_SEED_NOW,
            ),
            `assessment ${period.id}/${assessment.memberSlug}`,
          )
          summary.assessments += 1
        }
        if (period.status === 'closed') {
          doc = unwrap(setPeriodStatus(doc, period.id, 'closed'), `close ${period.id}`)
        }
        summary.periods += 1
      }

      return { ok: true, doc, warnings: [], saved: summary }
    },
  )
  if (!result.ok) throw new Error(`${TAG}: hours — ${result.error}`)
  return summary
}

// ── finance references, counterparties and the ledger origin ────────────────

type FinanceRefs = {
  accounts: Record<'bank' | 'cash' | 'card' | 'thb', number>
  ops: { purposeId: number; projectId: number; productId: number | null }
  courseSales: { purposeId: number; projectId: number; productId: number | null }
  counterparties: number[]
}

async function resolveFinanceRefs(actor: FinanceActor): Promise<FinanceRefs> {
  const [accounts, purposes, projects, products] = await Promise.all([
    listAccounts(),
    listPurposes(),
    listProjects(),
    listProducts(),
  ])
  const byName = <T extends { name: string }>(rows: readonly T[], name: string): T => {
    const row = rows.find((candidate) => candidate.name === name)
    if (row === undefined) throw new Error(`${TAG}: finance reference «${name}» is missing`)
    return row
  }
  const counterparties = await listCounterparties()
  return {
    accounts: {
      bank: byName(accounts, 'Основной банк').id,
      cash: byName(accounts, 'Наличные RUB').id,
      card: byName(accounts, 'Корпоративная карта').id,
      thb: byName(accounts, 'Карта THB').id,
    },
    ops: {
      purposeId: byName(purposes, 'Операционные расходы').id,
      projectId: byName(projects, 'BBM Academy').id,
      productId: null,
    },
    courseSales: {
      purposeId: byName(purposes, 'Продажи курса').id,
      projectId: byName(projects, 'Doctor School').id,
      productId: byName(products, 'Курс «Основы нутрициологии»').id,
    },
    counterparties: DEV_SEED_COUNTERPARTIES.map((name) => {
      const row = counterparties.find((candidate) => candidate.name === name)
      if (row === undefined) throw new Error(`${TAG}: counterparty «${name}» is missing`)
      return row.id
    }),
  }
}

async function seedCounterparties(actor: FinanceActor): Promise<DevSeedSummary['counterparties']> {
  const summary = { created: 0, reused: 0 }
  const existing = new Set((await listCounterparties()).map((row) => row.name))
  for (const name of DEV_SEED_COUNTERPARTIES) {
    if (existing.has(name)) {
      summary.reused += 1
      continue
    }
    await createCounterparty(actor, { name })
    summary.created += 1
  }
  return summary
}

// ── the intake spine: requests through the real status machine ──────────────

/** Slug → the item a previous run left, so a rerun is a no-op per request. */
async function seededIntakeIndex(
  actor: FinanceActor,
): Promise<Map<string, FinanceIntakeItemView>> {
  const items = await listIntakeItems(actor)
  const index = new Map<string, FinanceIntakeItemView>()
  for (const item of items) {
    const slug = devSeedSlugFromNote(item.note)
    if (slug !== null) index.set(slug, item)
  }
  return index
}

async function seedRequest(
  approver: FinanceActor,
  refs: FinanceRefs,
  request: DevSeedRequest,
): Promise<void> {
  const submitter = submitterActor(request.submitterSlug)
  const created = await createExpenseRequest(submitter, {
    occurredOn: request.occurredOn,
    accountId: request.account === null ? null : refs.accounts[request.account],
    amount: request.amount,
    currency: request.currency,
    purposeId: refs.ops.purposeId,
    projectId: refs.ops.projectId,
    productId: refs.ops.productId,
    counterpartyId: refs.counterparties[request.counterparty],
    note: devSeedNote(request.slug, request.note),
    alreadyPaid: request.alreadyPaid,
    personalFunds: request.personalFunds,
  })
  if (request.status === 'draft') return

  await submitExpenseRequest(submitter, created.id)
  switch (request.status) {
    case 'submitted':
      return
    case 'cancelled':
      // The one gate the entry role does not widen: a withdrawal is the
      // submitter's statement about their own intent (status machine).
      await cancelExpenseRequest(submitter, created.id)
      return
    case 'refused':
      await refuseExpenseRequest(approver, created.id, request.refusalReason!)
      return
    case 'approved':
      // Deliberately WITHOUT a document: with a ready document `approve` is the
      // one-act confirmation and posts in the same transaction (EARS-510/511),
      // so an `approved` fixture is precisely a request still waiting for its file.
      await approveExpenseRequest(approver, created.id)
      return
    case 'posted':
      await uploadFinanceDocument(approver, {
        filename: request.document!.filename,
        mime: 'image/png',
        bytes: ONE_PIXEL_PNG,
        kind: request.document!.kind,
        intakeItemIds: [created.id],
      })
      await approveExpenseRequest(approver, created.id)
      return
  }
}

async function seedRequests(
  approver: FinanceActor,
  refs: FinanceRefs,
): Promise<{ requests: DevSeedSummary['requests']; documents: DevSeedSummary['documents'] }> {
  const requests = { created: 0, reused: 0 }
  const documents = { uploaded: 0 }
  const index = await seededIntakeIndex(approver)
  for (const request of DEV_SEED_REQUESTS) {
    if (index.has(request.slug)) {
      requests.reused += 1
      continue
    }
    await seedRequest(approver, refs, request)
    requests.created += 1
    if (request.document !== undefined) documents.uploaded += 1
  }
  return { requests, documents }
}

async function seedIntakeItems(
  actor: FinanceActor,
  refs: FinanceRefs,
): Promise<DevSeedSummary['intakeItems']> {
  const summary = { created: 0, reused: 0 }
  const index = await seededIntakeIndex(actor)
  for (const item of DEV_SEED_INTAKE_ITEMS as readonly DevSeedIntakeItem[]) {
    if (index.has(item.slug)) {
      summary.reused += 1
      continue
    }
    const dimension = item.purpose === 'course-sales' ? refs.courseSales : refs.ops
    await createIntakeItem(actor, {
      source: item.source,
      kind: item.kind,
      occurredOn: item.occurredOn,
      amount: item.amount,
      currency: item.currency,
      accountId: item.account === null ? null : refs.accounts[item.account],
      counterAccountId: item.counterAccount === null ? null : refs.accounts[item.counterAccount],
      paidAmount: item.paidAmount,
      paidCurrency: item.paidCurrency,
      // A transfer or a conversion between own accounts has no purpose and no
      // counterparty at all — that is the model, not a gap in the fixture.
      purposeId: item.purpose === null ? null : dimension.purposeId,
      projectId: dimension.projectId,
      productId: item.purpose === null ? null : dimension.productId,
      note: devSeedNote(item.slug, item.note),
      // `manual` has policy `none` (a human act deduplicates on nothing); the
      // machine-fed sources MUST carry a ref, and it is what makes them
      // idempotent at the database level (EARS-503/504).
      sourceRef: item.source === 'manual' ? null : item.slug,
    })
    summary.created += 1
  }
  return summary
}

// ── the command ─────────────────────────────────────────────────────────────

/**
 * Apply the whole plan. Safe to call twice; the second call writes nothing.
 *
 * The guard runs FIRST and against the string this process will actually
 * connect with, so a refusal happens before a single statement rather than
 * after the members are already in.
 */
export async function seedDevData(options: DevSeedOptions = {}): Promise<DevSeedSummary> {
  const env = options.env ?? process.env
  const connectionString = options.connectionString ?? env.PLATFORM_DATABASE_URL
  const target = assertDevPlatformDatabase(connectionString, env)

  const members = await seedMembers()
  const hours = await seedHours()

  const approver = approverActor()
  const finance = await seedFinanceAcceptance(approver)
  const counterparties = await seedCounterparties(approver)
  const refs = await resolveFinanceRefs(approver)
  const { requests, documents } = await seedRequests(approver, refs)
  const intakeItems = await seedIntakeItems(approver, refs)

  return {
    database: target.database,
    members,
    hours,
    finance,
    counterparties,
    requests,
    intakeItems,
    documents,
  }
}

export function summaryLines(summary: DevSeedSummary): string[] {
  return [
    `  database          ${summary.database}`,
    `  core.member       created ${summary.members.created} · updated ${summary.members.updated} · unchanged ${summary.members.unchanged}`,
    `  hours             ${summary.hours.periods} period(s) · ${summary.hours.participants} participant(s) · ${summary.hours.assessments} assessment(s)`,
    `  finance refs      created ${summary.finance.referencesCreated} · reused ${summary.finance.referencesReused}`,
    `  ledger ops        created ${summary.finance.operationsCreated} · reused ${summary.finance.operationsReused}`,
    `  counterparties    created ${summary.counterparties.created} · reused ${summary.counterparties.reused}`,
    `  requests          created ${summary.requests.created} · reused ${summary.requests.reused}`,
    `  intake lines      created ${summary.intakeItems.created} · reused ${summary.intakeItems.reused}`,
    `  documents         uploaded ${summary.documents.uploaded}`,
  ]
}

async function main(): Promise<void> {
  loadPlatformToolEnv()
  console.log(`\n▶ ${TAG}`)
  const summary = await seedDevData()
  for (const line of summaryLines(summary)) console.log(line)
  console.log('')
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = resolve(fileURLToPath(import.meta.url))
if (
  invokedPath &&
  invokedPath === selfPath &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  main()
    .then(() => closePlatformDb())
    .catch(async (error: unknown) => {
      console.error(`\n✗ ${TAG} FAILED: ${(error as Error)?.message ?? String(error)}`)
      await closePlatformDb().catch(() => undefined)
      process.exit(1)
    })
}
