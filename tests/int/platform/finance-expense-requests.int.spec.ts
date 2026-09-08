// @vitest-environment node
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { afterAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'

import {
  approveExpenseRequest,
  cancelExpenseRequest,
  confirmExpenseRequest,
  createCurrency,
  createExpenseRequest,
  createIntakeItem,
  createIntakeItems,
  createProduct,
  createProject,
  createPurpose,
  createPurposeProposal,
  detachFinanceDocument,
  editExpenseRequest,
  editIntakeItem,
  FinanceAccessRefusal,
  FinanceRefusal,
  getExpenseRequest,
  listExpenseRequests,
  listFinanceDocuments,
  postIntakeItem,
  readFinanceDocument,
  refuseExpenseRequest,
  submitExpenseRequest,
  transitionIntakeItem,
  type CreateExpenseRequestInput,
  type FinanceActor,
  type FinanceDocumentVerifier,
} from '@/lib/finance'
import type { FinanceDocumentStorage } from '@/lib/finance/documents/storage'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { requirePlatformMigrateDatabaseUrl } from '@/lib/platform/db/config'

import {
  ADMIN,
  APPROVER,
  ENTRY,
  MEMBER,
  seedIntakeReferences,
  seedMember,
  truncateFinanceTables,
} from './finance-helpers'
import { asMigrator } from './privilege-helpers'

const db = getPlatformDb()
const PDF = Buffer.from('%PDF-1.7 expense request receipt')
const blobs = new Map<string, Buffer>()
const storage: FinanceDocumentStorage = {
  driver: 'local',
  bucket: null,
  async put(key, body) {
    blobs.set(key, Buffer.from(body))
  },
  async get(key) {
    const body = blobs.get(key)
    if (body === undefined) throw new Error(`Missing fixture object ${key}`)
    return Buffer.from(body)
  },
  async remove(key) {
    blobs.delete(key)
  },
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
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

beforeEach(async () => {
  blobs.clear()
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

type Refs = Awaited<ReturnType<typeof seedIntakeReferences>>

function requestInput(
  refs: Refs,
  overrides: Partial<CreateExpenseRequestInput> = {},
): CreateExpenseRequestInput {
  return {
    occurredOn: '2026-08-20',
    accountId: refs.accountId,
    amount: 120_000n,
    currency: 'RUB',
    purposeId: refs.purposeId,
    projectId: refs.projectId,
    counterpartyId: refs.counterpartyId,
    ...overrides,
  }
}

async function uploadReceipt(actor: FinanceActor, intakeItemId: number) {
  const { uploadFinanceDocument } = await import('@/lib/finance')
  return uploadFinanceDocument(
    actor,
    {
      filename: 'receipt.pdf',
      mime: 'application/pdf',
      bytes: PDF,
      kind: 'fiscal_receipt',
      intakeItemIds: [intakeItemId],
    },
    storage,
  )
}

describe('expense request member lifecycle (EARS-502/508/509)', () => {
  it('EARS-508: the public generic create APIs exclude and refuse request-source input', async () => {
    type PublicIntakeSource = Parameters<typeof createIntakeItem>[1]['source']
    expectTypeOf<Extract<PublicIntakeSource, 'request'>>().toEqualTypeOf<never>()

    const refs = await seedIntakeReferences()
    const rawRequest = {
      source: 'request',
      kind: 'expense',
      ...requestInput(refs),
    }
    const attempts = await Promise.allSettled([
      createIntakeItem(MEMBER, rawRequest as never),
      createIntakeItems(MEMBER, [rawRequest] as never),
    ])

    expect(attempts.map((attempt) => attempt.status)).toEqual(['rejected', 'rejected'])
    for (const attempt of attempts) {
      expect(attempt).toMatchObject({
        reason: expect.objectContaining({
          message: expect.stringMatching(/createExpenseRequest|EARS-508/i),
        }),
      })
    }
    expect(await listExpenseRequests(MEMBER)).toEqual([])
  })

  it('EARS-508: the public generic edit API refuses a facade-owned request', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs))

    await expect(editIntakeItem(MEMBER, request.id, { amount: 1n })).rejects.toThrow(
      /editExpenseRequest|EARS-508/i,
    )
    expect(await getExpenseRequest(MEMBER, request.id)).toMatchObject({ amount: 120_000n })
  })

  it('EARS-526: the expense facade keeps a missing-purpose proposal in draft until resolution', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs, { purposeId: null }))
    const proposal = await createPurposeProposal(MEMBER, {
      intakeItemId: request.id,
      text: 'Новая аренда оборудования',
    })

    expect(request).toMatchObject({ status: 'draft', purposeId: null })
    expect(proposal).toMatchObject({ intakeItemId: request.id, status: 'pending' })
    await expect(submitExpenseRequest(MEMBER, request.id)).rejects.toThrow(/EARS-508|EARS-526/)
  })

  it('EARS-510/531: the public generic transition API cannot approve a request', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs))
    await submitExpenseRequest(MEMBER, request.id)

    await expect(transitionIntakeItem(APPROVER, request.id, 'approve')).rejects.toThrow(
      /approveExpenseRequest|EARS-510|EARS-531/i,
    )
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({
      status: 'submitted',
      decidedBy: null,
    })
  })

  it('EARS-503/524: the public generic APIs still create, edit and transition non-request intake', async () => {
    const refs = await seedIntakeReferences()
    const directInput = {
      source: 'manual' as const,
      kind: 'expense' as const,
      ...requestInput(refs),
    }
    const item = await createIntakeItem(ENTRY, directInput)
    const bulk = await createIntakeItems(ENTRY, [{ ...directInput, amount: 121_000n }])
    const edited = await editIntakeItem(ENTRY, item.id, { note: 'Direct intake remains public' })
    const submitted = await transitionIntakeItem(ENTRY, item.id, 'submit')
    const approved = await transitionIntakeItem(APPROVER, item.id, 'approve')

    expect(bulk.created).toHaveLength(1)
    expect(edited.note).toBe('Direct intake remains public')
    expect(submitted).toMatchObject({ status: 'submitted' })
    expect(approved).toMatchObject({ status: 'approved', decidedBy: refs.approverMemberId })
  })

  it('EARS-502: a role-less member creates, edits, submits, lists and cancels only their own request, including its documents', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs))
    const editedDraft = await editExpenseRequest(MEMBER, request.id, {
      note: 'Оплатить до пятницы',
    })
    const document = await uploadReceipt(MEMBER, request.id)
    const submitted = await submitExpenseRequest(MEMBER, request.id)
    const editedSubmitted = await editExpenseRequest(MEMBER, request.id, { amount: 125_000n })

    expect(request).toMatchObject({ source: 'request', kind: 'expense', status: 'draft' })
    expect(editedDraft.note).toBe('Оплатить до пятницы')
    expect(submitted.status).toBe('submitted')
    expect(editedSubmitted).toMatchObject({ status: 'submitted', amount: 125_000n })
    expect((await listExpenseRequests(MEMBER)).map((item) => item.id)).toEqual([request.id])
    expect(
      (await listFinanceDocuments(MEMBER, { intakeItemId: request.id })).map((item) => item.id),
    ).toEqual([document.id])

    const stranger = { email: 'request-stranger@bbm.academy', roles: ['platform-user'] }
    await seedMember(stranger.email, 'Request Stranger')
    expect(await listExpenseRequests(stranger)).toEqual([])
    await expect(editExpenseRequest(stranger, request.id, { amount: 1n })).rejects.toBeInstanceOf(
      FinanceAccessRefusal,
    )

    const cancelled = await cancelExpenseRequest(MEMBER, request.id)
    expect(cancelled.status).toBe('cancelled')
    expect((await readFinanceDocument(MEMBER, document.id, storage)).bytes.equals(PDF)).toBe(true)
  })

  it('EARS-508: the request validates document/account currencies, product binding and personal-funds coupling before submit', async () => {
    const refs = await seedIntakeReferences()
    await createCurrency(ADMIN, { code: 'THB', name: 'Бат', precision: 2 })
    const forbiddenProduct = await createProduct(ADMIN, {
      projectId: refs.projectId,
      name: 'Запрещённый для назначения продукт',
    })

    const crossCurrency = await createExpenseRequest(
      MEMBER,
      requestInput(refs, {
        amount: 350_000n,
        currency: 'THB',
        paidAmount: 875_000n,
        paidCurrency: 'RUB',
        alreadyPaid: true,
      }),
    )
    expect(crossCurrency).toMatchObject({
      amount: 350_000n,
      currency: 'THB',
      paidAmount: 875_000n,
      paidCurrency: 'RUB',
    })

    await expect(
      createExpenseRequest(MEMBER, requestInput(refs, { amount: 350_000n, currency: 'THB' })),
    ).rejects.toThrow(/фактическ|RUB|кросс/i)
    await expect(
      createExpenseRequest(MEMBER, requestInput(refs, { productId: forbiddenProduct.id })),
    ).rejects.toThrow(/product_binding = forbidden/)
    await expect(
      createExpenseRequest(
        MEMBER,
        requestInput(refs, { accountId: null, personalFunds: true, alreadyPaid: false }),
      ),
    ).rejects.toThrow(/уже оплачено/)

    const personal = await createExpenseRequest(
      MEMBER,
      requestInput(refs, { accountId: null, personalFunds: true, alreadyPaid: true }),
    )
    expect(personal).toMatchObject({
      accountId: null,
      personalFunds: true,
      alreadyPaid: true,
      memberId: refs.memberMemberId,
    })
  })

  it('EARS-508: a racing request edit validates the final merged row under its write lock', async () => {
    const refs = await seedIntakeReferences()
    const firstProject = await createProject(ADMIN, { name: 'First request project' })
    const secondProject = await createProject(ADMIN, { name: 'Second request project' })
    const purpose = await createPurpose(ADMIN, {
      name: 'Optional request product',
      productBinding: 'optional',
    })
    const product = await createProduct(ADMIN, {
      projectId: firstProject.id,
      name: 'First project product',
    })
    const request = await createExpenseRequest(
      MEMBER,
      requestInput(refs, {
        purposeId: purpose.id,
        projectId: firstProject.id,
        productId: null,
      }),
    )
    const blocker = new Client({
      connectionString: requirePlatformMigrateDatabaseUrl(process.env),
    })
    await blocker.connect()

    let transactionOpen = false
    let edit: PromiseSettledResult<unknown> | undefined
    try {
      await blocker.query('begin')
      transactionOpen = true
      const pid = Number(
        (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid,
      )
      await blocker.query('update core.finance_intake_item set project_id = $1 where id = $2', [
        secondProject.id,
        request.id,
      ])

      const addProduct = editExpenseRequest(MEMBER, request.id, { productId: product.id })
      await waitForBlockedBy(blocker, pid, 1)

      await blocker.query('commit')
      transactionOpen = false
      ;[edit] = await Promise.allSettled([addProduct])
    } finally {
      if (transactionOpen) await blocker.query('rollback')
      await blocker.end()
    }

    expect(edit?.status).toBe('rejected')
    const final = await getExpenseRequest(MEMBER, request.id)
    expect(final).toMatchObject({ projectId: secondProject.id, productId: null })
  }, 10_000)

  it('EARS-509: submit exposes the request to the approver queue and every later status to its member', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs))
    await uploadReceipt(MEMBER, request.id)
    await submitExpenseRequest(MEMBER, request.id)

    expect(await listExpenseRequests(APPROVER, { status: ['submitted'] })).toEqual([
      expect.objectContaining({ id: request.id, status: 'submitted' }),
    ])
    expect(await listFinanceDocuments(APPROVER, { intakeItemId: request.id })).toHaveLength(1)

    const decided = await approveExpenseRequest(APPROVER, request.id)
    expect((await getExpenseRequest(MEMBER, request.id))?.status).toBe(decided.status)
  })
})

describe('expense request decisions (EARS-510/511/512/531)', () => {
  it('EARS-510: approving a request with its receipt posts once and records the approver as decider and poster', async () => {
    const refs = await seedIntakeReferences()
    await createCurrency(ADMIN, { code: 'THB', name: 'Бат', precision: 2 })
    const request = await createExpenseRequest(
      MEMBER,
      requestInput(refs, {
        amount: 350_000n,
        currency: 'THB',
        paidAmount: 875_000n,
        paidCurrency: 'RUB',
        alreadyPaid: true,
      }),
    )
    const receipt = await uploadReceipt(MEMBER, request.id)
    await submitExpenseRequest(MEMBER, request.id)

    const posted = await approveExpenseRequest(APPROVER, request.id)

    expect(posted).toMatchObject({
      status: 'posted',
      decidedBy: refs.approverMemberId,
      postedBy: refs.approverMemberId,
    })
    expect(posted.operationId).not.toBeNull()
    expect((await readFinanceDocument(APPROVER, receipt.id, storage)).bytes.equals(PDF)).toBe(true)
    const operations = await db.execute(
      sql`select count(*)::int as count from core.finance_operation where id = ${posted.operationId}`,
    )
    expect(Number((operations.rows[0] as { count: number }).count)).toBe(1)
  })

  it('EARS-510: a failed one-act post leaves the request submitted and records no decision', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs, { alreadyPaid: true }))
    await uploadReceipt(MEMBER, request.id)
    await submitExpenseRequest(MEMBER, request.id)

    await asMigrator(async (client) => {
      await client.query(`
        create or replace function core.finance_test_fail_request_post()
        returns trigger language plpgsql as $$
        begin
          raise exception 'injected request posting failure';
        end $$;
        create trigger finance_test_fail_request_post
        before insert on core.finance_operation
        for each row execute function core.finance_test_fail_request_post();
      `)
    })
    try {
      await expect(approveExpenseRequest(APPROVER, request.id)).rejects.toThrow()
    } finally {
      await asMigrator(async (client) => {
        await client.query(
          'drop trigger if exists finance_test_fail_request_post on core.finance_operation',
        )
        await client.query('drop function if exists core.finance_test_fail_request_post()')
      })
    }

    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({
      status: 'submitted',
      decidedBy: null,
      decidedAt: null,
      postedBy: null,
      operationId: null,
    })
  })

  it('EARS-510/531: verifier approval cannot post a different request and document snapshot', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs, { alreadyPaid: true }))
    const originalDocument = await uploadReceipt(MEMBER, request.id)
    await submitExpenseRequest(MEMBER, request.id)
    const verifierStarted = deferred()
    const releaseVerifier = deferred()
    const verifier: FinanceDocumentVerifier = {
      id: 'interleaving-verifier',
      async verify(context) {
        expect(context.request).toMatchObject({ id: request.id, amount: 120_000n })
        expect(context.documents.map((document) => document.id)).toEqual([originalDocument.id])
        verifierStarted.resolve()
        await releaseVerifier.promise
        return { verdict: 'verified' }
      },
    }

    const approval = approveExpenseRequest(APPROVER, request.id, { verifier })
    await verifierStarted.promise
    await editExpenseRequest(MEMBER, request.id, { amount: 125_000n })
    await detachFinanceDocument(ENTRY, {
      documentId: originalDocument.id,
      intakeItemId: request.id,
    })
    const replacementDocument = await uploadReceipt(ENTRY, request.id)
    releaseVerifier.resolve()

    await expect(approval).rejects.toThrow(/измен|сним|провер/i)
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({
      status: 'submitted',
      amount: 125_000n,
      operationId: null,
    })
    expect(
      (await listFinanceDocuments(APPROVER, { intakeItemId: request.id })).map(
        (document) => document.id,
      ),
    ).toEqual([replacementDocument.id])
  })

  it('EARS-511: pre-spend approval posts nothing; entry attaches the receipt and approve confirms with the actual money date', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs))
    await submitExpenseRequest(MEMBER, request.id)

    const authorized = await approveExpenseRequest(APPROVER, request.id)
    expect(authorized).toMatchObject({ status: 'approved', operationId: null })

    await expect(uploadReceipt(APPROVER, request.id)).rejects.toBeInstanceOf(FinanceAccessRefusal)
    await uploadReceipt(ENTRY, request.id)
    const posted = await confirmExpenseRequest(APPROVER, request.id, {
      occurredOn: '2026-08-23',
    })

    expect(posted).toMatchObject({
      status: 'posted',
      occurredOn: '2026-08-23',
      postedBy: refs.approverMemberId,
    })
    expect(posted.operationId).not.toBeNull()
  })

  it('EARS-508/533: a pre-spend request files with no account and no date, and the posting act enters both', async () => {
    const refs = await seedIntakeReferences()
    const intent = await createExpenseRequest(
      MEMBER,
      requestInput(refs, { occurredOn: null, accountId: null }),
    )
    expect(intent).toMatchObject({ occurredOn: null, accountId: null, alreadyPaid: false })

    await submitExpenseRequest(MEMBER, intent.id)
    expect(await approveExpenseRequest(APPROVER, intent.id)).toMatchObject({
      status: 'approved',
      occurredOn: null,
      accountId: null,
      operationId: null,
    })

    await uploadReceipt(ENTRY, intent.id)
    // Either fact missing is a readable refusal that says WHICH (EARS-533).
    await expect(confirmExpenseRequest(APPROVER, intent.id, {})).rejects.toThrow(
      /счёт списания.*дата движения денег/is,
    )
    await expect(
      confirmExpenseRequest(APPROVER, intent.id, { accountId: refs.accountId }),
    ).rejects.toThrow(/дата движения денег/i)
    await expect(
      confirmExpenseRequest(APPROVER, intent.id, { occurredOn: '2026-08-23' }),
    ).rejects.toThrow(/счёт списания/i)
    expect(await getExpenseRequest(APPROVER, intent.id)).toMatchObject({
      status: 'approved',
      operationId: null,
    })

    const posted = await confirmExpenseRequest(APPROVER, intent.id, {
      accountId: refs.accountId,
      occurredOn: '2026-08-23',
    })
    expect(posted).toMatchObject({
      status: 'posted',
      occurredOn: '2026-08-23',
      accountId: refs.accountId,
      postedBy: refs.approverMemberId,
    })
    expect(posted.operationId).not.toBeNull()
  })

  it('EARS-506/511/533: approving a pre-spend request with no document refuses the money facts rather than dropping them', async () => {
    const refs = await seedIntakeReferences()
    const intent = await createExpenseRequest(
      MEMBER,
      requestInput(refs, { occurredOn: null, accountId: null }),
    )
    await submitExpenseRequest(MEMBER, intent.id)

    await expect(
      approveExpenseRequest(APPROVER, intent.id, {
        accountId: refs.accountId,
        occurredOn: '2026-08-23',
      }),
    ).rejects.toBeInstanceOf(FinanceRefusal)
    expect(await getExpenseRequest(APPROVER, intent.id)).toMatchObject({
      status: 'submitted',
      occurredOn: null,
      accountId: null,
    })
  })

  it('EARS-511/531: the verifier approves the actual confirmation date that is posted', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs))
    await submitExpenseRequest(MEMBER, request.id)
    await approveExpenseRequest(APPROVER, request.id)
    await uploadReceipt(ENTRY, request.id)
    const verifiedDates: (string | null)[] = []
    const verifier: FinanceDocumentVerifier = {
      id: 'actual-date-verifier',
      async verify(context) {
        verifiedDates.push(context.request.occurredOn)
        return { verdict: 'verified' }
      },
    }

    const posted = await confirmExpenseRequest(APPROVER, request.id, {
      occurredOn: '2026-08-23',
      verifier,
    })

    expect(verifiedDates).toEqual(['2026-08-23'])
    expect(posted).toMatchObject({ status: 'posted', occurredOn: '2026-08-23' })
  })

  it('EARS-531: the public posting API cannot post a request without verifier-bound evidence', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs))
    await submitExpenseRequest(MEMBER, request.id)
    await approveExpenseRequest(APPROVER, request.id)
    await uploadReceipt(ENTRY, request.id)

    await expect(postIntakeItem(APPROVER, request.id)).rejects.toThrow(/вериф|провер|EARS-531/i)
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({
      status: 'approved',
      operationId: null,
      postedBy: null,
    })
  })

  it('EARS-512: refusal requires a reason, keeps an already-paid claim and its document, and may revoke an unposted approval', async () => {
    const refs = await seedIntakeReferences()
    const claim = await createExpenseRequest(MEMBER, requestInput(refs, { alreadyPaid: true }))
    const document = await uploadReceipt(MEMBER, claim.id)
    await submitExpenseRequest(MEMBER, claim.id)

    await expect(refuseExpenseRequest(APPROVER, claim.id, '')).rejects.toBeInstanceOf(
      FinanceRefusal,
    )
    const refused = await refuseExpenseRequest(APPROVER, claim.id, 'Не является расходом BBM')
    expect(refused).toMatchObject({
      status: 'refused',
      refusalReason: 'Не является расходом BBM',
      operationId: null,
      alreadyPaid: true,
    })
    expect((await readFinanceDocument(MEMBER, document.id, storage)).bytes.equals(PDF)).toBe(true)

    const preSpend = await createExpenseRequest(MEMBER, requestInput(refs))
    await submitExpenseRequest(MEMBER, preSpend.id)
    await approveExpenseRequest(APPROVER, preSpend.id)
    expect((await refuseExpenseRequest(APPROVER, preSpend.id, 'Лимит отозван')).status).toBe(
      'refused',
    )
  })

  it('EARS-531: a second verifier plugs into confirmation while the posting path stays unchanged', async () => {
    const refs = await seedIntakeReferences()
    const request = await createExpenseRequest(MEMBER, requestInput(refs))
    await submitExpenseRequest(MEMBER, request.id)
    await approveExpenseRequest(APPROVER, request.id)
    const document = await uploadReceipt(ENTRY, request.id)
    const calls: number[] = []
    const secondVerifier: FinanceDocumentVerifier = {
      id: 'test-double',
      async verify(context) {
        calls.push(context.request.id)
        expect(context.actor.email).toBe(APPROVER.email)
        expect(context.documents.map((item) => item.id)).toEqual([document.id])
        return { verdict: 'verified' }
      },
    }

    const posted = await confirmExpenseRequest(APPROVER, request.id, {
      verifier: secondVerifier,
    })

    expect(calls).toEqual([request.id])
    expect(posted).toMatchObject({ status: 'posted', postedBy: refs.approverMemberId })
    expect(posted.operationId).not.toBeNull()
  })
})
