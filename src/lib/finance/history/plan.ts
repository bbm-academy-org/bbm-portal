import { createHash } from 'node:crypto'

import type { FinanceDocumentKind } from '@/lib/platform/db/schema/finance/finance-document'
import type { FinanceIntakeKind } from '@/lib/platform/db/schema/finance/finance-intake-item'

import { FinanceRefusal } from '../core/errors'
import { financePostingShapeRefusals } from '../intake/posting-shape'

export const FINANCE_HISTORY_PLAN_VERSION = 1 as const

export type FinanceHistorySourcePost = {
  id: string
  rootId: string | null
  createdAt: string
  message: string
  fileIds: readonly string[]
}

export type FinanceHistorySourceFile = {
  id: string
  postId: string
  filename: string
  mime: string
  size: number
  contentDigest: string
  sourcePath: string
}

export type FinanceHistorySnapshot = {
  version: 1
  channel: { id: string; name: string }
  posts: readonly FinanceHistorySourcePost[]
  files: readonly FinanceHistorySourceFile[]
}

export type FinanceHistoryPurpose = {
  id: number
  name: string
  categoryId: number | null
}

export type FinanceHistoryOperationMapping = {
  kind: FinanceIntakeKind
  occurredOn: string
  amount: string
  currency: string
  projectId: number
  accountId?: number | null
  counterAccountId?: number | null
  paidAmount?: string | null
  paidCurrency?: string | null
  feeAmount?: string | null
  feeCurrency?: string | null
  purpose?: FinanceHistoryPurpose | null
  productId?: number | null
  counterpartyId?: number | null
  memberId?: number | null
  note?: string | null
  alreadyPaid?: boolean
  personalFunds?: boolean
  documentFileIds: readonly string[]
  documentKinds?: Readonly<Record<string, FinanceDocumentKind>>
}

export type FinanceHistoryMapping = {
  sourcePostId: string | null
  documentNumber?: string | null
  operation: FinanceHistoryOperationMapping
}

export type ExistingFinanceHistoryOperation = {
  id: number
  source: string
  sourceRef: string | null
}

export type FinanceHistoryPlanOperation = {
  sourcePostId: string | null
  sourceRef: string
  documentNumber: string | null
  kind: FinanceIntakeKind
  occurredOn: string
  amount: string
  currency: string
  projectId: number
  accountId: number | null
  counterAccountId: number | null
  paidAmount: string | null
  paidCurrency: string | null
  feeAmount: string | null
  feeCurrency: string | null
  purpose: FinanceHistoryPurpose | null
  productId: number | null
  counterpartyId: number | null
  memberId: number | null
  note: string | null
  alreadyPaid: boolean
  personalFunds: boolean
  documents: readonly (FinanceHistorySourceFile & { kind: FinanceDocumentKind })[]
  validation: { valid: boolean; reasons: readonly string[] }
}

export type FinanceHistoryPlan = {
  version: typeof FINANCE_HISTORY_PLAN_VERSION
  sourceSnapshotDigest: string
  planDigest: string
  source: {
    system: 'mattermost'
    channelId: string
    channelName: string
  }
  operations: readonly FinanceHistoryPlanOperation[]
  duplicates: readonly {
    sourcePostId: string | null
    sourceRef: string
    existingOperationId: number | null
    duplicateOfSourcePostId: string | null
  }[]
  invalidRows: readonly {
    sourcePostId: string | null
    sourceRef: string
    reasons: readonly string[]
  }[]
  purposeGroups: readonly {
    purposeId: number
    purposeName: string
    operationCount: number
    totals: readonly { currency: string; amount: string }[]
    uncategorizedSourceRefs: readonly string[]
  }[]
  summary: {
    firstOccurredOn: string | null
    lastOccurredOn: string | null
    candidateCount: number
    validCount: number
    duplicateCount: number
    invalidCount: number
    sourcePostCount: number
    sourceDocumentCount: number
    referencedDocumentCount: number
    operationsWithDocuments: number
    operationsWithoutDocuments: number
    uncategorizedCount: number
    kindCounts: Readonly<Record<FinanceIntakeKind, number>>
  }
}

type BuildFinanceHistoryPlanInput = {
  snapshot: FinanceHistorySnapshot
  mappings: readonly FinanceHistoryMapping[]
  existingOperations: readonly ExistingFinanceHistoryOperation[]
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  )
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`
}

function normalizedSnapshot(snapshot: FinanceHistorySnapshot): FinanceHistorySnapshot {
  return {
    version: snapshot.version,
    channel: { ...snapshot.channel },
    posts: [...snapshot.posts]
      .map((post) => ({ ...post, fileIds: [...post.fileIds].sort() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    files: [...snapshot.files].sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function positiveInteger(value: string | null, label: string, reasons: string[]): void {
  if (value === null || !/^[1-9]\d*$/.test(value))
    reasons.push(`${label} must be a positive integer`)
}

function positiveId(value: number | null, label: string, reasons: string[]): void {
  if (value === null || !Number.isInteger(value) || value <= 0) reasons.push(`${label} is required`)
}

function naturalSourceRef(operation: FinanceHistoryOperationMapping): string {
  return [
    operation.occurredOn,
    operation.accountId ?? 'personal-funds',
    operation.amount,
    operation.counterpartyId ?? 'no-counterparty',
  ].join('|')
}

function sourceRef(mapping: FinanceHistoryMapping): string {
  const documentNumber = mapping.documentNumber?.trim()
  if (documentNumber) return documentNumber
  const postId = mapping.sourcePostId?.trim()
  if (postId) return postId
  return naturalSourceRef(mapping.operation)
}

function planOperation(
  mapping: FinanceHistoryMapping,
  posts: ReadonlyMap<string, FinanceHistorySourcePost>,
  files: ReadonlyMap<string, FinanceHistorySourceFile>,
): FinanceHistoryPlanOperation {
  const operation = mapping.operation
  const reasons: string[] = []
  if (mapping.sourcePostId !== null && !posts.has(mapping.sourcePostId)) {
    reasons.push(`Mattermost post ${mapping.sourcePostId} is absent from the source snapshot`)
  }
  if (!isIsoDate(operation.occurredOn)) reasons.push('occurredOn must be a real YYYY-MM-DD date')
  positiveInteger(operation.amount, 'amount', reasons)
  positiveId(operation.projectId, 'projectId', reasons)
  if (operation.currency.trim() === '') reasons.push('currency is required')

  const accountId = operation.accountId ?? null
  const counterAccountId = operation.counterAccountId ?? null
  if (!operation.personalFunds) positiveId(accountId, 'accountId', reasons)
  if (
    operation.kind === 'expense' &&
    (operation.purpose === null || operation.purpose === undefined)
  ) {
    reasons.push('an expense requires a purpose')
  }
  if (operation.kind === 'transfer' || operation.kind === 'conversion') {
    positiveId(counterAccountId, 'counterAccountId', reasons)
  }
  const paidAmount = operation.paidAmount ?? null
  const paidCurrency = operation.paidCurrency?.trim().toUpperCase() || null
  const feeAmount = operation.feeAmount ?? null
  const feeCurrency = operation.feeCurrency?.trim().toUpperCase() || null
  const normalizedCurrency = operation.currency.trim().toUpperCase()
  const parsedAmount = /^[1-9]\d*$/.test(operation.amount) ? BigInt(operation.amount) : 0n
  const parsedPaidAmount =
    paidAmount !== null && /^[1-9]\d*$/.test(paidAmount)
      ? BigInt(paidAmount)
      : paidAmount === null
        ? null
        : 0n
  const parsedFeeAmount =
    feeAmount !== null && /^[1-9]\d*$/.test(feeAmount)
      ? BigInt(feeAmount)
      : feeAmount === null
        ? null
        : 0n
  reasons.push(
    ...financePostingShapeRefusals({
      kind: operation.kind,
      amount: parsedAmount,
      currency: normalizedCurrency,
      accountId,
      counterAccountId,
      paidAmount: parsedPaidAmount,
      paidCurrency,
      feeAmount: parsedFeeAmount,
      feeCurrency,
      purposeId: operation.purpose?.id ?? null,
      memberId: operation.memberId ?? null,
      alreadyPaid: operation.alreadyPaid ?? true,
      personalFunds: operation.personalFunds ?? false,
    }),
  )

  const documents = operation.documentFileIds.flatMap((fileId) => {
    const file = files.get(fileId)
    if (file === undefined) {
      reasons.push(`Mattermost file ${fileId} is absent from the source snapshot`)
      return []
    }
    return [{ ...file, kind: operation.documentKinds?.[fileId] ?? 'other' }]
  })

  return {
    sourcePostId: mapping.sourcePostId,
    sourceRef: sourceRef(mapping),
    documentNumber: mapping.documentNumber?.trim() || null,
    kind: operation.kind,
    occurredOn: operation.occurredOn,
    amount: operation.amount,
    currency: normalizedCurrency,
    projectId: operation.projectId,
    accountId,
    counterAccountId,
    paidAmount,
    paidCurrency,
    feeAmount,
    feeCurrency,
    purpose: operation.purpose ?? null,
    productId: operation.productId ?? null,
    counterpartyId: operation.counterpartyId ?? null,
    memberId: operation.memberId ?? null,
    note: operation.note?.trim() || null,
    alreadyPaid: operation.alreadyPaid ?? true,
    personalFunds: operation.personalFunds ?? false,
    documents,
    validation: { valid: reasons.length === 0, reasons },
  }
}

function groupPurposes(
  operations: readonly FinanceHistoryPlanOperation[],
  duplicateRefs: ReadonlySet<string>,
): FinanceHistoryPlan['purposeGroups'] {
  const groups = new Map<
    number,
    {
      purposeName: string
      operationCount: number
      totals: Map<string, bigint>
      uncategorizedSourceRefs: string[]
    }
  >()
  for (const operation of operations) {
    if (!operation.validation.valid || duplicateRefs.has(operation.sourceRef)) continue
    if (operation.kind !== 'expense' || operation.purpose === null) continue
    const current = groups.get(operation.purpose.id) ?? {
      purposeName: operation.purpose.name,
      operationCount: 0,
      totals: new Map<string, bigint>(),
      uncategorizedSourceRefs: [],
    }
    current.operationCount += 1
    current.totals.set(
      operation.currency,
      (current.totals.get(operation.currency) ?? 0n) + BigInt(operation.amount),
    )
    if (operation.purpose.categoryId === null) {
      current.uncategorizedSourceRefs.push(operation.sourceRef)
    }
    groups.set(operation.purpose.id, current)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([purposeId, group]) => ({
      purposeId,
      purposeName: group.purposeName,
      operationCount: group.operationCount,
      totals: [...group.totals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amount]) => ({ currency, amount: amount.toString() })),
      uncategorizedSourceRefs: [...group.uncategorizedSourceRefs].sort(),
    }))
}

export function buildFinanceHistoryPlan(input: BuildFinanceHistoryPlanInput): FinanceHistoryPlan {
  if (input.snapshot.version !== 1) {
    throw new FinanceRefusal(`Unsupported Mattermost snapshot version: ${input.snapshot.version}`)
  }
  const snapshot = normalizedSnapshot(input.snapshot)
  const posts = new Map(snapshot.posts.map((post) => [post.id, post]))
  const files = new Map(snapshot.files.map((file) => [file.id, file]))
  const operations = input.mappings
    .map((mapping) => planOperation(mapping, posts, files))
    .sort(
      (left, right) =>
        left.occurredOn.localeCompare(right.occurredOn) ||
        left.sourceRef.localeCompare(right.sourceRef) ||
        (left.sourcePostId ?? '').localeCompare(right.sourcePostId ?? '') ||
        digest(left).localeCompare(digest(right)),
    )
  const existingByRef = new Map(
    input.existingOperations
      .filter(
        (operation): operation is ExistingFinanceHistoryOperation & { sourceRef: string } =>
          operation.source === 'backfill' && operation.sourceRef !== null,
      )
      .map((operation) => [operation.sourceRef, operation]),
  )
  const existingDuplicates: FinanceHistoryPlan['duplicates'] = operations.flatMap((operation) => {
    const existing = existingByRef.get(operation.sourceRef)
    return existing === undefined
      ? []
      : [
          {
            sourcePostId: operation.sourcePostId,
            sourceRef: operation.sourceRef,
            existingOperationId: existing.id,
            duplicateOfSourcePostId: null,
          },
        ]
  })
  const firstInPlan = new Map<string, FinanceHistoryPlanOperation>()
  const planDuplicates: Array<FinanceHistoryPlan['duplicates'][number]> = []
  for (const operation of operations) {
    const first = firstInPlan.get(operation.sourceRef)
    if (first === undefined) {
      firstInPlan.set(operation.sourceRef, operation)
    } else if (!existingByRef.has(operation.sourceRef)) {
      planDuplicates.push({
        sourcePostId: operation.sourcePostId,
        sourceRef: operation.sourceRef,
        existingOperationId: null,
        duplicateOfSourcePostId: first.sourcePostId,
      })
    }
  }
  const duplicates = [...existingDuplicates, ...planDuplicates].sort(
    (left, right) =>
      left.sourceRef.localeCompare(right.sourceRef) ||
      (left.sourcePostId ?? '').localeCompare(right.sourcePostId ?? ''),
  )
  const duplicateRefs = new Set(duplicates.map((duplicate) => duplicate.sourceRef))
  const invalidRows = operations
    .filter((operation) => !operation.validation.valid)
    .map((operation) => ({
      sourcePostId: operation.sourcePostId,
      sourceRef: operation.sourceRef,
      reasons: operation.validation.reasons,
    }))
  const purposeGroups = groupPurposes(operations, duplicateRefs)
  const actionable = operations.filter(
    (operation) => operation.validation.valid && !duplicateRefs.has(operation.sourceRef),
  )
  const dates = operations
    .filter((operation) => operation.validation.valid)
    .map((operation) => operation.occurredOn)
    .sort()
  const kindCounts: Record<FinanceIntakeKind, number> = {
    expense: 0,
    income: 0,
    transfer: 0,
    conversion: 0,
  }
  for (const operation of actionable) kindCounts[operation.kind] += 1
  const unsigned = {
    version: FINANCE_HISTORY_PLAN_VERSION,
    sourceSnapshotDigest: digest(snapshot),
    source: {
      system: 'mattermost' as const,
      channelId: snapshot.channel.id,
      channelName: snapshot.channel.name,
    },
    operations,
    duplicates,
    invalidRows,
    purposeGroups,
    summary: {
      firstOccurredOn: dates.at(0) ?? null,
      lastOccurredOn: dates.at(-1) ?? null,
      candidateCount: operations.length,
      validCount: actionable.length,
      duplicateCount: duplicates.length,
      invalidCount: invalidRows.length,
      sourcePostCount: snapshot.posts.length,
      sourceDocumentCount: snapshot.files.length,
      referencedDocumentCount: new Set(
        actionable.flatMap((operation) => operation.documents.map((d) => d.id)),
      ).size,
      operationsWithDocuments: actionable.filter((operation) => operation.documents.length > 0)
        .length,
      operationsWithoutDocuments: actionable.filter((operation) => operation.documents.length === 0)
        .length,
      uncategorizedCount: purposeGroups.reduce(
        (total, group) => total + group.uncategorizedSourceRefs.length,
        0,
      ),
      kindCounts,
    },
  }
  return { ...unsigned, planDigest: digest(unsigned) }
}

export function verifyFinanceHistoryPlanDigest(
  plan: FinanceHistoryPlan,
  expectedDigest: string,
): FinanceHistoryPlan {
  const { planDigest: claimedDigest, ...unsigned } = plan
  const actualDigest = digest(unsigned)
  if (claimedDigest !== actualDigest || expectedDigest !== actualDigest) {
    throw new FinanceRefusal(
      `Finance history plan digest mismatch: expected ${expectedDigest}, plan claims ${claimedDigest}, actual ${actualDigest}.`,
    )
  }
  return plan
}
