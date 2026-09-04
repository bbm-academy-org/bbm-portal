// Specifies the /p/finance/requests form model:
// src/app/(platform)/p/finance/requests/request-form-model.ts — the EARS-508
// field contract as one schema, and the major↔minor unit conversion the money
// fields are typed in.
import { describe, expect, it } from 'vitest'

import {
  createRequestFormSchema,
  fromMinorUnits,
  productFieldMode,
  productOptions,
  requestFormDefaults,
  toMinorUnits,
  toRequestBody,
  type RequestFormValue,
} from '@/app/(platform)/p/finance/requests/request-form-model'
import type {
  RequestBoardItem,
  RequestBoardReferences,
} from '@/app/(platform)/p/finance/requests/request-board-contract'

const references: RequestBoardReferences = {
  accounts: [
    { id: 1, name: 'Банк RUB', currency: 'RUB' },
    { id: 2, name: 'Карта THB', currency: 'THB' },
  ],
  counterparties: [{ id: 7, name: 'ООО «Студия-7»' }],
  currencies: [
    { code: 'RUB', name: 'Российский рубль', precision: 2 },
    { code: 'THB', name: 'Тайский бат', precision: 2 },
    { code: 'JPY', name: 'Иена', precision: 0 },
  ],
  products: [
    { id: 11, name: 'Урок №14', projectId: 3 },
    { id: 12, name: 'Урок №15', projectId: 4 },
  ],
  projects: [
    { id: 3, name: 'Doctor.School' },
    { id: 4, name: 'Фонд BBM' },
    // A project that carries NO products at all — the shape that made the
    // request form refuse silently (#388 journey, state 09).
    { id: 5, name: 'Общие расходы' },
  ],
  purposes: [
    { id: 21, name: 'Продакшн', categoryId: 5, productBinding: 'required' },
    { id: 22, name: 'Хостинг', categoryId: 6, productBinding: 'forbidden' },
  ],
}

/**
 * A PRE-SPEND request — the default shape since the owner's 2026-09-03 ruling
 * (#388): an intent names no paying account and no money date (EARS-508/533).
 */
function value(overrides: Partial<RequestFormValue> = {}): RequestFormValue {
  return {
    ...requestFormDefaults(references),
    amount: '45 000,00',
    currency: 'RUB',
    purposeId: '21',
    projectId: '3',
    productId: '11',
    counterpartyId: '7',
    ...overrides,
  }
}

/** «Уже потрачено» — the one variant that still carries both in the form. */
function spent(overrides: Partial<RequestFormValue> = {}): RequestFormValue {
  return value({
    alreadyPaid: true,
    occurredOn: '2026-08-22',
    accountId: '1',
    ...overrides,
  })
}

describe('request form money conversion (spec 339 EARS-508)', () => {
  it('EARS-508: reads a typed amount in major units into the minor units the ledger stores', () => {
    expect(toMinorUnits('45 000,00', 2)).toBe('4500000')
    expect(toMinorUnits('720', 2)).toBe('72000')
    expect(toMinorUnits('2100.5', 2)).toBe('210050')
    expect(toMinorUnits('980', 0)).toBe('980')
  })

  it('EARS-508: refuses an amount that is not a positive number of money units', () => {
    expect(toMinorUnits('', 2)).toBeNull()
    expect(toMinorUnits('0', 2)).toBeNull()
    expect(toMinorUnits('-5', 2)).toBeNull()
    expect(toMinorUnits('45,678', 2)).toBeNull()
    expect(toMinorUnits('пятьсот', 2)).toBeNull()
  })

  it('EARS-508: writes a stored amount back into the field it was typed in', () => {
    expect(fromMinorUnits('4500000', 2)).toBe('45000,00')
    expect(fromMinorUnits('980', 0)).toBe('980')
    expect(fromMinorUnits(null, 2)).toBe('')
  })
})

describe('request form contract (spec 339 EARS-508/513/526/532/533)', () => {
  const schema = createRequestFormSchema(references)

  it('EARS-508/533: files a pre-spend request without a paying account or a money date', () => {
    const parsed = schema.safeParse(value())
    expect(parsed.success).toBe(true)
    expect(toRequestBody(value(), references)).toMatchObject({
      occurredOn: null,
      accountId: null,
      paidAmount: null,
      paidCurrency: null,
      amount: '4500000',
      currency: 'RUB',
      purposeId: 21,
      projectId: 3,
      productId: 11,
      counterpartyId: 7,
      alreadyPaid: false,
      personalFunds: false,
    })
  })

  it('EARS-533: a blank form offers no money date at all — «today» would be a guess', () => {
    expect(requestFormDefaults(references).occurredOn).toBe('')
  })

  it('EARS-533: sends neither fact even when the fields still hold what a ticked-then-unticked box left', () => {
    const stale = value({ accountId: '1', occurredOn: '2026-08-22', paidAmount: '2 100,00' })
    expect(schema.safeParse(stale).success).toBe(true)
    expect(toRequestBody(stale, references)).toMatchObject({
      occurredOn: null,
      accountId: null,
      paidAmount: null,
      paidCurrency: null,
    })
  })

  it('EARS-508: an «уже потрачено» request still names the date and how it was paid', () => {
    expect(schema.safeParse(spent()).success).toBe(true)
    expect(toRequestBody(spent(), references)).toMatchObject({
      occurredOn: '2026-08-22',
      accountId: 1,
      alreadyPaid: true,
    })
    expect(schema.safeParse(spent({ occurredOn: '' })).success).toBe(false)
    expect(schema.safeParse(spent({ accountId: '' })).success).toBe(false)
  })

  it('EARS-508: requires the account-side amount only where the paying account is in another currency', () => {
    expect(schema.safeParse(spent({ accountId: '2' })).success).toBe(false)
    const cross = spent({ accountId: '2', paidAmount: '2 100,00' })
    expect(schema.safeParse(cross).success).toBe(true)
    expect(toRequestBody(cross, references)).toMatchObject({
      paidAmount: '210000',
      paidCurrency: 'THB',
    })
    expect(toRequestBody(spent(), references).paidAmount).toBeNull()
  })

  it('EARS-513: takes personal funds only for money already spent and with no company account', () => {
    expect(schema.safeParse(value({ personalFunds: true, alreadyPaid: false })).success).toBe(false)
    expect(schema.safeParse(spent({ personalFunds: true, accountId: '1' })).success).toBe(false)
    const own = spent({ personalFunds: true, accountId: '' })
    expect(schema.safeParse(own).success).toBe(true)
    expect(toRequestBody(own, references).accountId).toBeNull()
  })

  it('EARS-533: reopens a filed pre-spend request with both money fields still empty', () => {
    const filed: RequestBoardItem = {
      id: 5,
      own: true,
      status: 'submitted',
      occurredOn: null,
      amount: '4500000',
      currency: 'RUB',
      paidAmount: null,
      paidCurrency: null,
      note: null,
      alreadyPaid: false,
      personalFunds: false,
      refusalReason: null,
      operationId: null,
      purpose: null,
      project: { id: 3, name: 'Doctor.School' },
      product: null,
      account: null,
      counterparty: null,
      documents: [],
    }
    expect(requestFormDefaults(references, filed)).toMatchObject({
      occurredOn: '',
      accountId: '',
      alreadyPaid: false,
    })
  })

  it('EARS-526: takes a purpose from the reference or a proposal, never both and never neither', () => {
    expect(schema.safeParse(value({ purposeId: '', purposeProposal: '' })).success).toBe(false)
    expect(
      schema.safeParse(value({ purposeId: '21', purposeProposal: 'Аренда студии' })).success,
    ).toBe(false)
    const proposed = value({ purposeId: '', productId: '', purposeProposal: 'Аренда студии' })
    expect(schema.safeParse(proposed).success).toBe(true)
    expect(toRequestBody(proposed, references)).toMatchObject({
      purposeId: null,
      purposeProposal: 'Аренда студии',
    })
  })

  it('EARS-532: takes a counterparty from the reference or creates one inline by name', () => {
    expect(schema.safeParse(value({ counterpartyId: '', counterpartyName: '' })).success).toBe(
      false,
    )
    const inline = value({ counterpartyId: '', counterpartyName: 'Кофейня' })
    expect(schema.safeParse(inline).success).toBe(true)
    expect(toRequestBody(inline, references)).toMatchObject({
      counterpartyId: null,
      counterpartyName: 'Кофейня',
    })
  })

  it('EARS-508: follows the purpose binding when offering products of the chosen project', () => {
    expect(productOptions(references, '21', '3').map((product) => product.id)).toEqual([11])
    expect(productOptions(references, '22', '3')).toEqual([])
    expect(schema.safeParse(value({ purposeId: '21', productId: '' })).success).toBe(false)
    expect(schema.safeParse(value({ purposeId: '22', productId: '' })).success).toBe(true)
  })

  it('EARS-508: says WHICH way the product is missing when the project carries none', () => {
    // The purpose demands a product, the chosen project has none: the member
    // can satisfy neither, so the field is still part of the form (`empty`,
    // not `hidden`) and the refusal names the real reason instead of the
    // generic «это назначение требует продукт».
    expect(productFieldMode(references, '21', '5')).toBe('empty')
    expect(productFieldMode(references, '21', '3')).toBe('options')
    expect(productFieldMode(references, '22', '3')).toBe('hidden')
    expect(productFieldMode(references, '', '3')).toBe('hidden')

    const parsed = schema.safeParse(value({ purposeId: '21', projectId: '5', productId: '' }))
    expect(parsed.success).toBe(false)
    const issue = parsed.success
      ? null
      : (parsed.error.issues.find((row) => row.path[0] === 'productId') ?? null)
    expect(issue?.message).toMatch(/нет продуктов/i)
  })
})
