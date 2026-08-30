// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  approveExpenseRequest,
  cancelExpenseRequest,
  confirmExpenseRequest,
  createCurrency,
  createExpenseRequest,
  createProduct,
  editExpenseRequest,
  FinanceAccessRefusal,
  FinanceRefusal,
  getExpenseRequest,
  listExpenseRequests,
  listFinanceDocuments,
  readFinanceDocument,
  refuseExpenseRequest,
  submitExpenseRequest,
  type CreateExpenseRequestInput,
  type FinanceActor,
  type FinanceDocumentVerifier,
} from '@/lib/finance'
import type { FinanceDocumentStorage } from '@/lib/finance/documents/storage'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

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
