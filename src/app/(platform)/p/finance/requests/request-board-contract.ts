import type { FinanceDocumentKind, FinanceIntakeStatus, FinanceProductBinding } from '@/lib/finance'

export type RequestReference = { id: number; name: string }

export type RequestBoardDocument = {
  id: number
  filename: string
  mime: string
  size: number
  kind: FinanceDocumentKind
  uploadedAt: string
}

export type RequestBoardItem = {
  id: number
  own: boolean
  status: FinanceIntakeStatus
  occurredOn: string
  amount: string
  currency: string
  paidAmount: string | null
  paidCurrency: string | null
  note: string | null
  alreadyPaid: boolean
  personalFunds: boolean
  createdBy?: number
  createdByName?: string
  decidedBy?: number | null
  decidedByName?: string | null
  postedByName?: string | null
  decidedAt?: string | null
  refusalReason: string | null
  operationId: number | null
  operation?: {
    id: number
    occurredOn: string
    postings: Array<{ accountName: string; amount: string; currency: string }>
  } | null
  purpose: (RequestReference & { categoryId: number | null; categoryName: string | null }) | null
  project: RequestReference
  product: RequestReference | null
  account: (RequestReference & { currency: string }) | null
  counterparty: RequestReference | null
  documents: RequestBoardDocument[]
  proposal?: { id: number; text: string; status: string } | null
}

export type RequestBoardReferences = {
  accounts: Array<RequestReference & { currency: string }>
  counterparties: RequestReference[]
  currencies: Array<{ code: string; name: string; precision: number }>
  products: Array<RequestReference & { projectId: number }>
  projects: RequestReference[]
  purposes: Array<
    RequestReference & { categoryId: number | null; productBinding: FinanceProductBinding }
  >
}

export type RequestsSnapshot = {
  permissions: { canApprove: boolean; canEnter: boolean }
  references: RequestBoardReferences
  requests: RequestBoardItem[]
  liabilities: Array<{
    memberId: number
    memberName: string
    currency: string
    balance: string
  }>
}

export type CreateRequestBody = {
  occurredOn: string
  accountId: number | null
  amount: string
  currency: string
  paidAmount?: string | null
  paidCurrency?: string | null
  purposeId: number | null
  purposeProposal?: string | null
  projectId: number
  productId?: number | null
  counterpartyId?: number | null
  counterpartyName?: string | null
  note?: string | null
  alreadyPaid: boolean
  personalFunds: boolean
}
