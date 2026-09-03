import { z } from 'zod'

import type {
  CreateRequestBody,
  RequestBoardItem,
  RequestBoardReferences,
} from './request-board-contract'
import { currencyPrecision } from './request-board-model'

/**
 * The EARS-508 field contract of the request form, in ONE place.
 *
 * WHY A SCHEMA AND NOT AN `if` LADDER. The rules here are not «required» flags:
 * `personal_funds` is accepted only together with `already_paid` and only with
 * NO company account (EARS-513); a purpose comes from the reference OR as a
 * proposal, never both and never neither (EARS-526); a counterparty is picked
 * or created inline (EARS-532); the account-side amount is demanded exactly
 * when the paying account is in another currency. Written as one zod schema
 * they are also the messages `<FormMessage>` renders under the field that is
 * wrong — the shape #434 established for the member form and #433 filed against
 * the previous version of THIS form.
 *
 * The form is typed in MAJOR units — a member types «45 000,00», not 4500000 —
 * and the ledger stores minor units, so the conversion is part of the contract
 * rather than a detail of the submit handler.
 */

/** Reads a typed amount in major units into the minor units the ledger stores. */
export function toMinorUnits(text: string, precision: number): string | null {
  const normalized = text.replace(/\s| /g, '').replace(',', '.')
  if (normalized === '' || !/^\d+(\.\d+)?$/.test(normalized)) return null
  const [integer, fraction = ''] = normalized.split('.')
  if (fraction.length > precision) return null
  const minor = `${integer}${fraction.padEnd(precision, '0')}`.replace(/^0+(?=\d)/, '')
  return BigInt(minor) > 0n ? minor : null
}

/** Writes a stored amount back into the field it was typed in. */
export function fromMinorUnits(minor: string | null, precision: number): string {
  if (minor === null || minor === '') return ''
  const value = BigInt(minor)
  const sign = value < 0n ? '-' : ''
  const digits = (value < 0n ? -value : value).toString().padStart(precision + 1, '0')
  const integer = precision === 0 ? digits : digits.slice(0, -precision)
  return precision === 0 ? `${sign}${integer}` : `${sign}${integer},${digits.slice(-precision)}`
}

export type RequestFormValue = {
  occurredOn: string
  amount: string
  currency: string
  accountId: string
  paidAmount: string
  purposeId: string
  purposeProposal: string
  projectId: string
  productId: string
  counterpartyId: string
  counterpartyName: string
  note: string
  alreadyPaid: boolean
  personalFunds: boolean
}

const baseSchema = z.object({
  occurredOn: z.string().min(1, 'Укажите дату движения денег.'),
  amount: z.string(),
  currency: z.string().min(1, 'Выберите валюту документа.'),
  accountId: z.string(),
  paidAmount: z.string(),
  purposeId: z.string(),
  purposeProposal: z.string(),
  projectId: z.string().min(1, 'Выберите проект.'),
  productId: z.string(),
  counterpartyId: z.string(),
  counterpartyName: z.string(),
  note: z.string(),
  alreadyPaid: z.boolean(),
  personalFunds: z.boolean(),
})

function accountOf(references: RequestBoardReferences, accountId: string) {
  return references.accounts.find((account) => String(account.id) === accountId) ?? null
}

function purposeOf(references: RequestBoardReferences, purposeId: string) {
  return references.purposes.find((purpose) => String(purpose.id) === purposeId) ?? null
}

/** The products the chosen purpose's binding and the chosen project allow. */
export function productOptions(
  references: RequestBoardReferences,
  purposeId: string,
  projectId: string,
): RequestBoardReferences['products'] {
  const purpose = purposeOf(references, purposeId)
  if (purpose === null || purpose.productBinding === 'forbidden') return []
  return references.products.filter((product) => String(product.projectId) === projectId)
}

export function createRequestFormSchema(references: RequestBoardReferences) {
  return baseSchema.superRefine((value, context) => {
    const precision = currencyPrecision(references.currencies, value.currency)
    if (toMinorUnits(value.amount, precision) === null) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Укажите сумму документа числом больше нуля.',
      })
    }

    if (value.personalFunds && !value.alreadyPaid) {
      context.addIssue({
        code: 'custom',
        path: ['personalFunds'],
        message: 'Свои деньги — это уже потраченные деньги: отметьте «уже потрачено».',
      })
    }
    if (value.personalFunds && value.accountId !== '') {
      context.addIssue({
        code: 'custom',
        path: ['accountId'],
        message: 'Трата своими средствами не списывается со счёта BBM.',
      })
    }
    if (!value.personalFunds && value.accountId === '') {
      context.addIssue({ code: 'custom', path: ['accountId'], message: 'Выберите счёт списания.' })
    }

    const account = accountOf(references, value.accountId)
    if (account !== null && account.currency !== value.currency) {
      const paidPrecision = currencyPrecision(references.currencies, account.currency)
      if (toMinorUnits(value.paidAmount, paidPrecision) === null) {
        context.addIssue({
          code: 'custom',
          path: ['paidAmount'],
          message: `Укажите сумму, списанную со счёта в ${account.currency}.`,
        })
      }
    }

    const proposal = value.purposeProposal.trim()
    if (value.purposeId === '' && proposal === '') {
      context.addIssue({
        code: 'custom',
        path: ['purposeId'],
        message: 'Выберите назначение или предложите новое.',
      })
    }
    if (value.purposeId !== '' && proposal !== '') {
      context.addIssue({
        code: 'custom',
        path: ['purposeProposal'],
        message: 'Выберите назначение или предложите новое, но не оба варианта сразу.',
      })
    }

    const purpose = purposeOf(references, value.purposeId)
    if (purpose?.productBinding === 'required' && value.productId === '') {
      context.addIssue({
        code: 'custom',
        path: ['productId'],
        message: 'Это назначение требует продукт.',
      })
    }
    if (purpose?.productBinding === 'forbidden' && value.productId !== '') {
      context.addIssue({
        code: 'custom',
        path: ['productId'],
        message: 'Это назначение не относится к продукту.',
      })
    }

    if (value.counterpartyId === '' && value.counterpartyName.trim() === '') {
      context.addIssue({
        code: 'custom',
        path: ['counterpartyId'],
        message: 'Выберите контрагента или впишите нового.',
      })
    }
  })
}

/** A blank form, or the saved request re-opened for an edit (EARS-524). */
export function requestFormDefaults(
  references: RequestBoardReferences,
  request?: RequestBoardItem,
): RequestFormValue {
  if (request === undefined) {
    return {
      occurredOn: new Date().toISOString().slice(0, 10),
      amount: '',
      currency: references.currencies[0]?.code ?? 'RUB',
      accountId: '',
      paidAmount: '',
      purposeId: '',
      purposeProposal: '',
      projectId: '',
      productId: '',
      counterpartyId: '',
      counterpartyName: '',
      note: '',
      alreadyPaid: false,
      personalFunds: false,
    }
  }
  const paidPrecision = currencyPrecision(
    references.currencies,
    request.paidCurrency ?? request.currency,
  )
  return {
    occurredOn: request.occurredOn,
    amount: fromMinorUnits(
      request.amount,
      currencyPrecision(references.currencies, request.currency),
    ),
    currency: request.currency,
    accountId: request.account === null ? '' : String(request.account.id),
    paidAmount: fromMinorUnits(request.paidAmount, paidPrecision),
    purposeId: request.purpose === null ? '' : String(request.purpose.id),
    purposeProposal: '',
    projectId: String(request.project.id),
    productId: request.product === null ? '' : String(request.product.id),
    counterpartyId: request.counterparty === null ? '' : String(request.counterparty.id),
    counterpartyName: '',
    note: request.note ?? '',
    alreadyPaid: request.alreadyPaid,
    personalFunds: request.personalFunds,
  }
}

/** The validated form as the API's own body (`CreateRequestBody`). */
export function toRequestBody(
  value: RequestFormValue,
  references: RequestBoardReferences,
): CreateRequestBody {
  const precision = currencyPrecision(references.currencies, value.currency)
  const account = accountOf(references, value.accountId)
  const crossCurrency = account !== null && account.currency !== value.currency
  const paidPrecision = crossCurrency
    ? currencyPrecision(references.currencies, account.currency)
    : precision
  const proposal = value.purposeProposal.trim()
  const counterpartyName = value.counterpartyName.trim()

  return {
    occurredOn: value.occurredOn,
    accountId: account?.id ?? null,
    amount: toMinorUnits(value.amount, precision) ?? '0',
    currency: value.currency,
    paidAmount: crossCurrency ? toMinorUnits(value.paidAmount, paidPrecision) : null,
    paidCurrency: crossCurrency ? account.currency : null,
    purposeId: value.purposeId === '' ? null : Number(value.purposeId),
    purposeProposal: proposal === '' ? null : proposal,
    projectId: Number(value.projectId),
    productId: value.productId === '' ? null : Number(value.productId),
    counterpartyId: value.counterpartyId === '' ? null : Number(value.counterpartyId),
    counterpartyName: counterpartyName === '' ? null : counterpartyName,
    note: value.note.trim() === '' ? null : value.note.trim(),
    alreadyPaid: value.alreadyPaid,
    personalFunds: value.personalFunds,
  }
}
