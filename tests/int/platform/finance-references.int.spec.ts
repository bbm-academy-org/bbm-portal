// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  createCounterparty,
  createCurrency,
  createIntakeItem,
  createPurpose,
  createPurposeProposal,
  dismissPurposeProposal,
  editIntakeItem,
  FinanceAccessRefusal,
  FinanceRefusal,
  getIntakeItem,
  listCounterparties,
  listPurposeProposals,
  renameCounterparty,
  resolvePurposeProposal,
  transitionIntakeItem,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { auditEventsFor, auditEventsSince, auditWatermark } from './audit-helpers'
import {
  ADMIN,
  ENTRY,
  fixtureWrite,
  fundProjectId,
  MEMBER,
  seedMember,
  truncateFinanceTables,
} from './finance-helpers'

/**
 * The two F2 reference resources against the real platform database (spec 339
 * EARS-532/EARS-526, issue #383).
 *
 * Both clauses are database claims as well as module claims: counterparty names
 * stay unique under a direct/racing writer, and resolving a proposal updates the
 * proposal and its request in one audited transaction. A repository double
 * would prove neither property.
 */
const db = getPlatformDb()

const STRANGER = {
  email: 'stranger@bbm.academy',
  roles: ['platform-user'],
} as const

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

async function seedActors() {
  const memberId = await seedMember(MEMBER.email, 'Plain Member')
  const entryId = await seedMember(ENTRY.email, 'Entry Clerk')
  await seedMember(STRANGER.email, 'Other Member')
  return { memberId, entryId }
}

async function seedDraftRequest() {
  await seedActors()
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  const account = await createAccount(ADMIN, {
    name: 'Тинькофф RUB',
    kind: 'bank',
    currency: 'RUB',
  })
  const counterparty = await createCounterparty(MEMBER, { name: 'Anthropic' })
  return createIntakeItem(MEMBER, {
    source: 'request',
    kind: 'expense',
    occurredOn: '2026-08-29',
    accountId: account.id,
    amount: 120_000n,
    currency: 'RUB',
    purposeId: null,
    projectId: await fundProjectId(),
    counterpartyId: counterparty.id,
  })
}

describe('the counterparty reference (spec 339 EARS-532)', () => {
  it('EARS-532: any submitter creates inline, names are case-insensitively unique, and only admin renames', async () => {
    const { memberId, entryId } = await seedActors()
    const mark = await auditWatermark(db)

    const created = await createCounterparty(MEMBER, { name: '  Anthropic  ' })
    expect(created).toMatchObject({ name: 'Anthropic', createdBy: memberId })
    expect(await listCounterparties()).toEqual([created])

    await expect(createCounterparty(ENTRY, { name: 'anthropic' })).rejects.toBeInstanceOf(
      FinanceRefusal,
    )
    await expect(
      fixtureWrite((tx) =>
        tx.execute(sql`
          insert into core.finance_counterparty (name, created_by)
          values (' ANTHROPIC ', ${entryId})
        `),
      ),
    ).rejects.toThrow()

    await expect(renameCounterparty(MEMBER, created.id, { name: 'OpenAI' })).rejects.toBeInstanceOf(
      FinanceAccessRefusal,
    )
    const renamed = await renameCounterparty(ADMIN, created.id, { name: 'OpenAI' })
    expect(renamed.name).toBe('OpenAI')

    const events = await auditEventsFor(db, mark, 'finance_counterparty')
    expect(events.map((event) => [event.event_type, event.actor_email])).toEqual([
      ['data.finance_counterparty.insert', MEMBER.email],
      ['data.finance_counterparty.update', ADMIN.email],
    ])
    expect(events[1].diff.name).toEqual({ old: 'Anthropic', new: 'OpenAI' })
  })
})

describe('a missing-purpose proposal bound to its draft request (spec 339 EARS-526)', () => {
  it('EARS-526: proposer sees own, admin resolves it atomically, and only then may the request submit', async () => {
    const request = await seedDraftRequest()
    const mark = await auditWatermark(db)

    const proposal = await createPurposeProposal(MEMBER, {
      intakeItemId: request.id,
      text: 'Подписка на AI-инструменты',
    })
    expect(proposal).toMatchObject({
      intakeItemId: request.id,
      text: 'Подписка на AI-инструменты',
      status: 'pending',
      resolvedPurposeId: null,
      resolvedAt: null,
    })
    expect(await listPurposeProposals(MEMBER)).toEqual([proposal])
    expect(await listPurposeProposals(STRANGER)).toEqual([])
    expect(await listPurposeProposals(ADMIN)).toEqual([proposal])

    await expect(transitionIntakeItem(MEMBER, request.id, 'submit')).rejects.toThrow(/EARS-526/)
    await expect(
      resolvePurposeProposal(MEMBER, proposal.id, { purposeId: 1 }),
    ).rejects.toBeInstanceOf(FinanceAccessRefusal)

    const purpose = await createPurpose(ADMIN, {
      name: proposal.text,
      productBinding: 'forbidden',
    })
    await editIntakeItem(MEMBER, request.id, { purposeId: purpose.id })
    await expect(transitionIntakeItem(MEMBER, request.id, 'submit')).rejects.toThrow(/EARS-526/)
    await editIntakeItem(MEMBER, request.id, { purposeId: null })
    const resolved = await resolvePurposeProposal(ADMIN, proposal.id, {
      purposeId: purpose.id,
    })
    expect(resolved).toMatchObject({
      id: proposal.id,
      status: 'resolved',
      resolvedPurposeId: purpose.id,
    })
    expect(resolved.resolvedAt).toBeInstanceOf(Date)
    expect(await getIntakeItem(MEMBER, request.id)).toMatchObject({ purposeId: purpose.id })
    await expect(transitionIntakeItem(MEMBER, request.id, 'submit')).resolves.toMatchObject({
      status: 'submitted',
    })

    const events = await auditEventsSince(db, mark)
    const proposalEvents = events.filter((event) => event.table_name === 'finance_purpose_proposal')
    expect(proposalEvents.map((event) => [event.event_type, event.actor_email])).toEqual([
      ['data.finance_purpose_proposal.insert', MEMBER.email],
      ['data.finance_purpose_proposal.update', ADMIN.email],
    ])
    const resolution = proposalEvents[1]
    const requestUpdate = events.find(
      (event) =>
        event.table_name === 'finance_intake_item' &&
        event.actor_email === ADMIN.email &&
        event.diff.purpose_id !== undefined,
    )
    expect(requestUpdate?.txid).toBe(resolution.txid)
  })

  it('EARS-526: only the request owner or entry role proposes; dismissal retains the row and does not unblock', async () => {
    const request = await seedDraftRequest()

    await expect(
      createPurposeProposal(STRANGER, { intakeItemId: request.id, text: 'Чужое назначение' }),
    ).rejects.toBeInstanceOf(FinanceAccessRefusal)

    const proposal = await createPurposeProposal(ENTRY, {
      intakeItemId: request.id,
      text: 'Облачные вычисления',
    })
    const dismissed = await dismissPurposeProposal(ADMIN, proposal.id)
    expect(dismissed).toMatchObject({
      id: proposal.id,
      status: 'dismissed',
      resolvedPurposeId: null,
    })
    expect(dismissed.resolvedAt).toBeInstanceOf(Date)
    expect(dismissed.resolvedAt?.getTime()).toBeGreaterThanOrEqual(dismissed.createdAt.getTime())
    expect(await listPurposeProposals(ENTRY)).toEqual([dismissed])
    expect(await listPurposeProposals(MEMBER)).toEqual([])
    await expect(transitionIntakeItem(MEMBER, request.id, 'submit')).rejects.toThrow(/EARS-526/)

    const persisted = await db.execute(sql`
      select id, text, resolved_at, resolved_purpose_id
      from core.finance_purpose_proposal
      where id = ${proposal.id}
    `)
    expect(persisted.rows).toHaveLength(1)
  })
})
