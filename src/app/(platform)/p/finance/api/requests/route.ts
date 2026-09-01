import { z } from 'zod'

import {
  createCounterparty,
  createExpenseRequest,
  createPurposeProposal,
  FINANCE_APPROVE_ROLE,
  FINANCE_ENTRY_ROLE,
  liabilityBalances,
  listAccounts,
  listCategories,
  listCounterparties,
  listCurrencies,
  listExpenseRequests,
  listFinanceDocuments,
  listProducts,
  listProjects,
  listPurposeProposals,
  listPurposes,
  type FinanceIntakeItemView,
} from '@/lib/finance'
import { findMemberByEmail } from '@/lib/member'

import { financeRequestActor, jsonResponse, requestApiError, textResponse } from './request-utils'

export const dynamic = 'force-dynamic'

const createRequestSchema = z
  .object({
    occurredOn: z.iso.date(),
    accountId: z.number().int().positive().nullable(),
    amount: z.string().regex(/^\d+$/),
    currency: z.string().trim().min(1).max(12),
    paidAmount: z.string().regex(/^\d+$/).nullable().optional(),
    paidCurrency: z.string().trim().min(1).max(12).nullable().optional(),
    purposeId: z.number().int().positive().nullable().optional(),
    purposeProposal: z.string().trim().min(1).max(500).nullable().optional(),
    projectId: z.number().int().positive(),
    productId: z.number().int().positive().nullable().optional(),
    counterpartyId: z.number().int().positive().nullable().optional(),
    counterpartyName: z.string().trim().min(1).max(200).nullable().optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
    alreadyPaid: z.boolean(),
    personalFunds: z.boolean(),
  })
  .superRefine((value, context) => {
    if ((value.purposeId ?? null) === null && !value.purposeProposal) {
      context.addIssue({ code: 'custom', message: 'Выберите назначение или предложите новое.' })
    }
    if ((value.counterpartyId ?? null) === null && !value.counterpartyName) {
      context.addIssue({ code: 'custom', message: 'Выберите или создайте контрагента.' })
    }
    if (value.personalFunds && !value.alreadyPaid) {
      context.addIssue({
        code: 'custom',
        message: 'Оплата своими средствами возможна только для уже потраченных денег.',
      })
    }
  })

function byId<T extends { id: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((row) => [row.id, row]))
}

function serializeItem(
  item: FinanceIntakeItemView,
  context: {
    accounts: Map<number, { id: number; name: string; currency: string }>
    counterparties: Map<number, { id: number; name: string }>
    products: Map<number, { id: number; name: string }>
    projects: Map<number, { id: number; name: string }>
    purposes: Map<number, { id: number; name: string; categoryId: number | null }>
    categories: Map<number, { id: number; name: string }>
    proposals: Map<number, { id: number; text: string; status: string }>
    actorMemberId: number | null
    documents: Awaited<ReturnType<typeof listFinanceDocuments>>
  },
) {
  const purpose = item.purposeId === null ? null : (context.purposes.get(item.purposeId) ?? null)
  const project = context.projects.get(item.projectId)
  if (project === undefined) throw new Error(`Finance request #${item.id} has no project view.`)
  return {
    id: item.id,
    own: item.createdBy === context.actorMemberId,
    status: item.status,
    occurredOn: item.occurredOn,
    amount: item.amount.toString(),
    currency: item.currency,
    paidAmount: item.paidAmount?.toString() ?? null,
    paidCurrency: item.paidCurrency,
    note: item.note,
    alreadyPaid: item.alreadyPaid,
    personalFunds: item.personalFunds,
    createdBy: item.createdBy,
    decidedBy: item.decidedBy,
    decidedAt: item.decidedAt?.toISOString() ?? null,
    refusalReason: item.refusalReason,
    operationId: item.operationId,
    purpose: purpose
      ? {
          id: purpose.id,
          name: purpose.name,
          categoryId: purpose.categoryId,
          categoryName:
            purpose.categoryId === null
              ? null
              : (context.categories.get(purpose.categoryId)?.name ?? null),
        }
      : null,
    proposal: context.proposals.get(item.id) ?? null,
    project: { id: project.id, name: project.name },
    product:
      item.productId === null
        ? null
        : ((product) => (product ? { id: product.id, name: product.name } : null))(
            context.products.get(item.productId),
          ),
    account:
      item.accountId === null
        ? null
        : ((account) =>
            account ? { id: account.id, name: account.name, currency: account.currency } : null)(
            context.accounts.get(item.accountId),
          ),
    counterparty:
      item.counterpartyId === null
        ? null
        : ((counterparty) =>
            counterparty ? { id: counterparty.id, name: counterparty.name } : null)(
            context.counterparties.get(item.counterpartyId),
          ),
    documents: context.documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      mime: document.mime,
      size: document.size,
      kind: document.kind,
      uploadedAt: document.uploadedAt.toISOString(),
    })),
  }
}

export async function GET(): Promise<Response> {
  const gate = await financeRequestActor()
  if (gate.refusal !== null) return gate.refusal
  const actor = gate.actor

  try {
    const [
      requests,
      accounts,
      counterparties,
      currencies,
      products,
      projects,
      purposes,
      categories,
      proposals,
      debts,
      actorMember,
    ] = await Promise.all([
      listExpenseRequests(actor),
      listAccounts(),
      listCounterparties(),
      listCurrencies(),
      listProducts(),
      listProjects(),
      listPurposes(),
      listCategories(),
      listPurposeProposals(actor),
      liabilityBalances(),
      findMemberByEmail(actor.email),
    ])
    const documents = await Promise.all(
      requests.map((request) => listFinanceDocuments(actor, { intakeItemId: request.id })),
    )
    const accountMap = byId(accounts)
    const counterpartyMap = byId(counterparties)
    const productMap = byId(products)
    const projectMap = byId(projects)
    const purposeMap = byId(purposes)
    const categoryMap = byId(categories)
    const proposalMap = new Map(
      proposals.flatMap((proposal) =>
        proposal.intakeItemId === null
          ? []
          : [
              [
                proposal.intakeItemId,
                { id: proposal.id, text: proposal.text, status: proposal.status },
              ] as const,
            ],
      ),
    )

    return jsonResponse({
      permissions: {
        canApprove: actor.roles.includes(FINANCE_APPROVE_ROLE),
        canEnter: actor.roles.includes(FINANCE_ENTRY_ROLE),
      },
      references: {
        accounts: accounts
          .filter((account) => !account.isSystem && account.retiredAt === null)
          .map(({ id, name, currency }) => ({ id, name, currency })),
        counterparties: counterparties.map(({ id, name }) => ({ id, name })),
        currencies: currencies
          .filter((currency) => currency.retiredAt === null)
          .map(({ code, name, precision }) => ({ code, name, precision })),
        products: products
          .filter((product) => product.retiredAt === null)
          .map(({ id, name, projectId }) => ({ id, name, projectId })),
        projects: projects
          .filter((project) => project.retiredAt === null)
          .map(({ id, name }) => ({ id, name })),
        purposes: purposes
          .filter((purpose) => purpose.retiredAt === null)
          .map(({ id, name, categoryId, productBinding }) => ({
            id,
            name,
            categoryId,
            productBinding,
          })),
      },
      requests: requests.map((request, index) =>
        serializeItem(request, {
          accounts: accountMap,
          counterparties: counterpartyMap,
          products: productMap,
          projects: projectMap,
          purposes: purposeMap,
          categories: categoryMap,
          proposals: proposalMap,
          actorMemberId: actorMember?.id ?? null,
          documents: documents[index],
        }),
      ),
      liabilities: debts.map((debt) => ({
        memberId: debt.memberId,
        memberName: debt.memberName,
        currency: debt.currency,
        balance: debt.balance.toString(),
      })),
    })
  } catch (cause) {
    return requestApiError(cause)
  }
}

export async function POST(request: Request): Promise<Response> {
  const gate = await financeRequestActor()
  if (gate.refusal !== null) return gate.refusal

  const parsed = createRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return textResponse(400, parsed.error.issues[0]?.message)
  const body = parsed.data

  try {
    const counterpartyId = body.counterpartyName
      ? (await createCounterparty(gate.actor, { name: body.counterpartyName })).id
      : body.counterpartyId!
    const expenseRequest = await createExpenseRequest(gate.actor, {
      occurredOn: body.occurredOn,
      accountId: body.accountId,
      amount: BigInt(body.amount),
      currency: body.currency,
      paidAmount: body.paidAmount ? BigInt(body.paidAmount) : null,
      paidCurrency: body.paidCurrency ?? null,
      purposeId: body.purposeId ?? null,
      projectId: body.projectId,
      productId: body.productId ?? null,
      counterpartyId,
      note: body.note ?? null,
      alreadyPaid: body.alreadyPaid,
      personalFunds: body.personalFunds,
    })
    const proposal = body.purposeProposal
      ? await createPurposeProposal(gate.actor, {
          intakeItemId: expenseRequest.id,
          text: body.purposeProposal,
        })
      : null
    return jsonResponse(
      {
        request: {
          id: expenseRequest.id,
          status: expenseRequest.status,
          purposeId: expenseRequest.purposeId,
        },
        proposal,
      },
      201,
    )
  } catch (cause) {
    return requestApiError(cause)
  }
}
