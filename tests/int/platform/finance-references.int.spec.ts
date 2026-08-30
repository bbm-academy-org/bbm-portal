// @vitest-environment node
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import * as financeModule from '@/lib/finance'
import {
  createAccount,
  createCounterparty,
  createCurrency,
  createPurpose,
  createPurposeProposal,
  dismissPurposeProposal,
  FinanceAccessRefusal,
  FinanceRefusal,
  getIntakeItem,
  listCounterparties,
  listPurposeProposals,
  renameCounterparty,
  resolvePurposeProposal,
} from '@/lib/finance'
import { createIntakeItem, editIntakeItem, transitionIntakeItem } from '@/lib/finance/intake/items'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { requirePlatformDatabaseUrl } from '@/lib/platform/db/config'
import type { PlatformTx } from '@/lib/platform/db/transaction'

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

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown }

function observe<T>(promise: Promise<T>): {
  outcome: Promise<Outcome<T>>
  settled: () => boolean
} {
  let settled = false
  return {
    outcome: promise.then(
      (value) => {
        settled = true
        return { ok: true as const, value }
      },
      (error: unknown) => {
        settled = true
        return { ok: false as const, error }
      },
    ),
    settled: () => settled,
  }
}

function sqlState(error: unknown): string | undefined {
  const node = error as { code?: string; cause?: unknown } | undefined
  if (typeof node?.code === 'string') return node.code
  return node?.cause ? sqlState(node.cause) : undefined
}

async function waitForBlockedBy(
  blocker: Client,
  blockerPid: number,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const result = await blocker.query<{ blocked: number }>(
      `with recursive waiters(pid) as (
         select pid
           from pg_stat_activity
          where $1 = any(pg_blocking_pids(pid))
         union
         select activity.pid
           from pg_stat_activity activity
           join waiters on waiters.pid = any(pg_blocking_pids(activity.pid))
       )
       select count(*)::int as blocked from waiters`,
      [blockerPid],
    )
    if (Number(result.rows[0]?.blocked ?? 0) >= expected) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Expected ${expected} transaction(s) to wait behind backend ${blockerPid}.`)
}

type RequestPurposeReadinessSeam = (tx: PlatformTx, intakeItemId: number) => Promise<unknown>

function requestPurposeReadinessSeam(): RequestPurposeReadinessSeam {
  const seam = (
    financeModule as unknown as {
      assertRequestPurposeReady?: RequestPurposeReadinessSeam
    }
  ).assertRequestPurposeReady
  if (typeof seam !== 'function') {
    throw new Error(
      'The finance public API has no transaction-scoped request-purpose readiness seam for #385.',
    )
  }
  return seam
}

function assertRequestPurposeReady(intakeItemId: number): Promise<unknown> {
  return fixtureWrite((tx) => requestPurposeReadinessSeam()(tx, intakeItemId))
}

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

  it('EARS-532: concurrent normalized renames yield one row and one readable refusal', async () => {
    const { memberId } = await seedActors()
    const first = await createCounterparty(MEMBER, { name: 'First vendor' })
    const second = await createCounterparty(MEMBER, { name: 'Second vendor' })
    const blocker = new Client({ connectionString: requirePlatformDatabaseUrl(process.env) })
    await blocker.connect()

    let transactionOpen = false
    let firstRename: ReturnType<typeof observe<Awaited<ReturnType<typeof renameCounterparty>>>>
    let secondRename: ReturnType<typeof observe<Awaited<ReturnType<typeof renameCounterparty>>>>
    try {
      await blocker.query('begin')
      transactionOpen = true
      const pid = Number(
        (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid,
      )
      await blocker.query(
        `insert into core.finance_counterparty (name, created_by)
         values ('Shared Vendor', $1)`,
        [memberId],
      )

      firstRename = observe(renameCounterparty(ADMIN, first.id, { name: ' shared vendor ' }))
      secondRename = observe(renameCounterparty(ADMIN, second.id, { name: 'SHARED VENDOR' }))
      await waitForBlockedBy(blocker, pid, 1)
      expect(firstRename.settled()).toBe(false)
      expect(secondRename.settled()).toBe(false)

      await blocker.query('rollback')
      transactionOpen = false
    } finally {
      if (transactionOpen) await blocker.query('rollback')
      await blocker.end()
    }

    const outcomes = await Promise.all([firstRename!.outcome, secondRename!.outcome])
    const successes = outcomes.filter((outcome) => outcome.ok)
    const refusals = outcomes.filter((outcome) => !outcome.ok)
    expect(successes).toHaveLength(1)
    expect(refusals).toHaveLength(1)
    expect((refusals[0] as { ok: false; error: unknown }).error).toBeInstanceOf(FinanceRefusal)
    expect(sqlState((refusals[0] as { ok: false; error: unknown }).error)).not.toBe('23505')

    const rows = await listCounterparties()
    expect(rows.filter((row) => row.name.trim().toLowerCase() === 'shared vendor')).toHaveLength(1)
  }, 10_000)
})

describe('a missing-purpose proposal bound to its draft request (spec 339 EARS-526)', () => {
  it('EARS-526: the transaction-scoped posting seam blocks a pending proposal', async () => {
    const request = await seedDraftRequest()
    const proposal = await createPurposeProposal(MEMBER, {
      intakeItemId: request.id,
      text: 'Новая подписка',
    })
    expect(proposal.status).toBe('pending')

    await expect(assertRequestPurposeReady(request.id)).rejects.toBeInstanceOf(FinanceRefusal)
  })

  it('EARS-526: the transaction-scoped posting seam still blocks a dismissed proposal', async () => {
    const request = await seedDraftRequest()
    const proposal = await createPurposeProposal(MEMBER, {
      intakeItemId: request.id,
      text: 'Новая подписка',
    })
    expect((await dismissPurposeProposal(ADMIN, proposal.id)).status).toBe('dismissed')

    await expect(assertRequestPurposeReady(request.id)).rejects.toBeInstanceOf(FinanceRefusal)
  })

  it('EARS-526: the transaction-scoped posting seam accepts the resolved real purpose', async () => {
    const request = await seedDraftRequest()
    const proposal = await createPurposeProposal(MEMBER, {
      intakeItemId: request.id,
      text: 'Новая подписка',
    })
    const purpose = await createPurpose(ADMIN, {
      name: proposal.text,
      productBinding: 'forbidden',
    })
    expect(
      (await resolvePurposeProposal(ADMIN, proposal.id, { purposeId: purpose.id })).status,
    ).toBe('resolved')

    expect((await observe(assertRequestPurposeReady(request.id)).outcome).ok).toBe(true)
  })

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

  it('EARS-526: a pending proposal prevents deletion of its draft request', async () => {
    const request = await seedDraftRequest()
    const proposal = await createPurposeProposal(MEMBER, {
      intakeItemId: request.id,
      text: 'Новая подписка',
    })

    await expect(transitionIntakeItem(MEMBER, request.id, 'delete')).rejects.toBeInstanceOf(
      FinanceRefusal,
    )
    expect(await getIntakeItem(MEMBER, request.id)).toMatchObject({ id: request.id })
    expect(await listPurposeProposals(MEMBER)).toEqual([proposal])
  })

  it('EARS-526: a dismissed proposal survives draft deletion with its audit provenance', async () => {
    const request = await seedDraftRequest()
    const proposal = await createPurposeProposal(MEMBER, {
      intakeItemId: request.id,
      text: 'Новая подписка',
    })
    await dismissPurposeProposal(ADMIN, proposal.id)
    const mark = await auditWatermark(db)

    await expect(transitionIntakeItem(MEMBER, request.id, 'delete')).resolves.toBeNull()
    expect(await listPurposeProposals(MEMBER)).toEqual([
      expect.objectContaining({ id: proposal.id, intakeItemId: null, status: 'dismissed' }),
    ])
    const unlink = (await auditEventsSince(db, mark)).find(
      (event) =>
        event.table_name === 'finance_purpose_proposal' &&
        event.event_type === 'data.finance_purpose_proposal.update',
    )
    expect(unlink?.actor_email).toBe(MEMBER.email)
    expect(unlink?.diff.intake_item_id).toEqual({ old: request.id, new: null })
  })

  it('EARS-526: a resolved proposal survives draft deletion with its audit provenance', async () => {
    const request = await seedDraftRequest()
    const proposal = await createPurposeProposal(MEMBER, {
      intakeItemId: request.id,
      text: 'Новая подписка',
    })
    const purpose = await createPurpose(ADMIN, {
      name: proposal.text,
      productBinding: 'forbidden',
    })
    await resolvePurposeProposal(ADMIN, proposal.id, { purposeId: purpose.id })
    const mark = await auditWatermark(db)

    await expect(transitionIntakeItem(MEMBER, request.id, 'delete')).resolves.toBeNull()
    expect(await listPurposeProposals(MEMBER)).toEqual([
      expect.objectContaining({
        id: proposal.id,
        intakeItemId: null,
        status: 'resolved',
        resolvedPurposeId: purpose.id,
      }),
    ])
    const unlink = (await auditEventsSince(db, mark)).find(
      (event) =>
        event.table_name === 'finance_purpose_proposal' &&
        event.event_type === 'data.finance_purpose_proposal.update',
    )
    expect(unlink?.actor_email).toBe(MEMBER.email)
    expect(unlink?.diff.intake_item_id).toEqual({ old: request.id, new: null })
  })

  it('EARS-526: resolve and draft deletion serialize without a deadlock', async () => {
    const request = await seedDraftRequest()
    const proposal = await createPurposeProposal(MEMBER, {
      intakeItemId: request.id,
      text: 'Новая подписка',
    })
    const purpose = await createPurpose(ADMIN, {
      name: proposal.text,
      productBinding: 'forbidden',
    })
    const blocker = new Client({ connectionString: requirePlatformDatabaseUrl(process.env) })
    await blocker.connect()

    let transactionOpen = false
    let deleting: ReturnType<typeof observe<Awaited<ReturnType<typeof transitionIntakeItem>>>>
    let resolving: ReturnType<typeof observe<Awaited<ReturnType<typeof resolvePurposeProposal>>>>
    try {
      await blocker.query('begin')
      transactionOpen = true
      const pid = Number(
        (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid,
      )
      await blocker.query('select id from core.finance_intake_item where id = $1 for update', [
        request.id,
      ])

      deleting = observe(transitionIntakeItem(MEMBER, request.id, 'delete'))
      await waitForBlockedBy(blocker, pid, 1)
      resolving = observe(resolvePurposeProposal(ADMIN, proposal.id, { purposeId: purpose.id }))
      await waitForBlockedBy(blocker, pid, 2)
      expect(deleting.settled()).toBe(false)
      expect(resolving.settled()).toBe(false)

      await blocker.query('commit')
      transactionOpen = false
    } finally {
      if (transactionOpen) await blocker.query('rollback')
      await blocker.end()
    }

    const [deleted, resolved] = await Promise.all([deleting!.outcome, resolving!.outcome])
    const errors = [deleted, resolved]
      .filter((outcome) => !outcome.ok)
      .map((outcome) => (outcome as { ok: false; error: unknown }).error)
    expect(errors.map(sqlState)).not.toContain('40P01')
    expect(deleted.ok).toBe(false)
    expect((deleted as { ok: false; error: unknown }).error).toBeInstanceOf(FinanceRefusal)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.value.status).toBe('resolved')
    expect(await getIntakeItem(MEMBER, request.id)).toMatchObject({ purposeId: purpose.id })
  }, 10_000)
})
