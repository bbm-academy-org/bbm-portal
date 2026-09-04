import {
  createExpenseRequest,
  createPurposeProposal,
  submitExpenseRequest,
  FINANCE_APPROVE_ROLE,
  FINANCE_ENTRY_ROLE,
  liabilityBalances,
  listAccounts,
  listCategories,
  listCounterparties,
  listCurrencies,
  listExpenseRequests,
  listFinanceDocumentsByItems,
  listProducts,
  listProjects,
  listPurposeProposals,
  listPurposes,
  registerEntriesByIds,
  type FinanceDocumentView,
  type FinanceIntakeItemView,
} from '@/lib/finance'
import { findMemberByEmail, getMembersByIds } from '@/lib/member'

import {
  expenseRequestBodySchema,
  expenseRequestInput,
  financeRequestActor,
  jsonResponse,
  requestApiError,
  resolveRequestCounterpartyId,
  textResponse,
} from './request-utils'

export const dynamic = 'force-dynamic'

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
    members: Map<number, { id: number; name: string }>
    operations: Map<
      number,
      {
        operationId: number
        occurredOn: string
        postings: Array<{ accountName: string; amount: bigint; currency: string }>
      }
    >
    actorMemberId: number | null
    documents: FinanceDocumentView[]
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
    createdByName: context.members.get(item.createdBy)?.name ?? `Участник #${item.createdBy}`,
    decidedBy: item.decidedBy,
    decidedByName:
      item.decidedBy === null
        ? null
        : (context.members.get(item.decidedBy)?.name ?? `Участник #${item.decidedBy}`),
    decidedAt: item.decidedAt?.toISOString() ?? null,
    refusalReason: item.refusalReason,
    operationId: item.operationId,
    postedByName:
      item.postedBy === null
        ? null
        : (context.members.get(item.postedBy)?.name ?? `Участник #${item.postedBy}`),
    operation:
      item.operationId === null
        ? null
        : ((operation) =>
            operation
              ? {
                  id: operation.operationId,
                  occurredOn: operation.occurredOn,
                  postings: operation.postings.map((posting) => ({
                    accountName: posting.accountName,
                    amount: posting.amount.toString(),
                    currency: posting.currency,
                  })),
                }
              : null)(context.operations.get(item.operationId)),
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
    const memberIds = [
      ...new Set(
        requests.flatMap((request) =>
          [request.createdBy, request.decidedBy, request.postedBy].filter(
            (id): id is number => id !== null,
          ),
        ),
      ),
    ].sort((left, right) => left - right)
    const operationIds = [
      ...new Set(
        requests.flatMap((request) => (request.operationId === null ? [] : [request.operationId])),
      ),
    ]
    // ONE read for the whole board, not one transaction per row (#470): a
    // transaction holds a pooled client, so a per-row fan-out exhausted the pool
    // and deadlocked the request on a board of ten or more.
    const [members, documentsByItem, register] = await Promise.all([
      getMembersByIds(memberIds),
      listFinanceDocumentsByItems(
        actor,
        requests.map((request) => request.id),
      ),
      registerEntriesByIds(operationIds),
    ])
    const accountMap = byId(accounts)
    const counterpartyMap = byId(counterparties)
    const productMap = byId(products)
    const projectMap = byId(projects)
    const purposeMap = byId(purposes)
    const categoryMap = byId(categories)
    const memberMap = byId(members)
    const operationMap = new Map(register.map((operation) => [operation.operationId, operation]))
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
      requests: requests.map((request) =>
        serializeItem(request, {
          accounts: accountMap,
          counterparties: counterpartyMap,
          products: productMap,
          projects: projectMap,
          purposes: purposeMap,
          categories: categoryMap,
          proposals: proposalMap,
          members: memberMap,
          operations: operationMap,
          actorMemberId: actorMember?.id ?? null,
          documents: documentsByItem.get(request.id) ?? [],
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

  const parsed = expenseRequestBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return textResponse(400, parsed.error.issues[0]?.message)
  const body = parsed.data

  try {
    const counterpartyId = await resolveRequestCounterpartyId(gate.actor, body)
    const expenseRequest = await createExpenseRequest(
      gate.actor,
      expenseRequestInput(body, counterpartyId),
    )
    let proposal = null
    if (body.purposeProposal) {
      try {
        proposal = await createPurposeProposal(gate.actor, {
          intakeItemId: expenseRequest.id,
          text: body.purposeProposal,
        })
      } catch {
        return jsonResponse(
          {
            status: 'saved-draft',
            request: {
              id: expenseRequest.id,
              status: expenseRequest.status,
              purposeId: expenseRequest.purposeId,
            },
            proposal: null,
            message: 'Черновик сохранён, но предложение назначения не создано.',
            recovery: {
              method: 'PATCH',
              href: `/p/finance/api/requests/${expenseRequest.id}`,
              purposeProposal: body.purposeProposal,
            },
          },
          503,
        )
      }
    }
    // FILING IS SUBMITTING (EARS-508/509, acceptance scenario 2). The module
    // keeps `create` and `submit` apart on purpose — a `draft` is what
    // EARS-526 needs — but the REQUEST FORM is one act for the member: what it
    // files must stand in the approvers' queue, not in a status the board has
    // no column for and a second, undiscoverable act away from being seen.
    // The one request that stays a draft is the one that has no purpose yet,
    // only a proposal: there is nothing for an approver to decide until an
    // admin turns that proposal into a purpose (EARS-526).
    let filed = expenseRequest
    let message: string | null = null
    if (proposal === null && expenseRequest.purposeId !== null) {
      try {
        filed = await submitExpenseRequest(gate.actor, expenseRequest.id)
      } catch (cause) {
        // The item EXISTS — losing it to report a failed transition would be
        // worse than answering with what was really kept. The client reads the
        // status back and says «черновик», not «подана».
        message =
          cause instanceof Error
            ? `Заявка сохранена черновиком: ${cause.message}`
            : 'Заявка сохранена черновиком: подать её не удалось.'
      }
    }
    return jsonResponse(
      {
        request: {
          id: filed.id,
          status: filed.status,
          purposeId: filed.purposeId,
        },
        proposal,
        ...(message === null ? {} : { message }),
      },
      201,
    )
  } catch (cause) {
    return requestApiError(cause)
  }
}
