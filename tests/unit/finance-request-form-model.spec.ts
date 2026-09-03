// Specifies the /p/finance/requests form model:
// src/app/(platform)/p/finance/requests/request-form-model.ts — the EARS-508
// field contract as one schema, and the major↔minor unit conversion the money
// fields are typed in.
import { describe, expect, it } from 'vitest'

import {
  createRequestFormSchema,
  fromMinorUnits,
  productOptions,
  requestFormDefaults,
  toMinorUnits,
  toRequestBody,
  type RequestFormValue,
} from '@/app/(platform)/p/finance/requests/request-form-model'
import type { RequestBoardReferences } from '@/app/(platform)/p/finance/requests/request-board-contract'

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
  ],
  purposes: [
    { id: 21, name: 'Продакшн', categoryId: 5, productBinding: 'required' },
    { id: 22, name: 'Хостинг', categoryId: 6, productBinding: 'forbidden' },
  ],
}

function value(overrides: Partial<RequestFormValue> = {}): RequestFormValue {
  return {
    ...requestFormDefaults(references),
    occurredOn: '2026-08-22',
    amount: '45 000,00',
    currency: 'RUB',
    accountId: '1',
    purposeId: '21',
    projectId: '3',
    productId: '11',
    counterpartyId: '7',
    ...overrides,
  }
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

describe('request form contract (spec 339 EARS-508/513/526/532)', () => {
  const schema = createRequestFormSchema(references)

  it('EARS-508: accepts the filled contract and hands the API minor units', () => {
    const parsed = schema.safeParse(value())
    expect(parsed.success).toBe(true)
    expect(toRequestBody(value(), references)).toMatchObject({
      occurredOn: '2026-08-22',
      accountId: 1,
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

  it('EARS-508: requires the account-side amount only where the paying account is in another currency', () => {
    expect(schema.safeParse(value({ accountId: '2' })).success).toBe(false)
    const cross = value({ accountId: '2', paidAmount: '2 100,00' })
    expect(schema.safeParse(cross).success).toBe(true)
    expect(toRequestBody(cross, references)).toMatchObject({
      paidAmount: '210000',
      paidCurrency: 'THB',
    })
    expect(toRequestBody(value(), references).paidAmount).toBeNull()
  })

  it('EARS-513: takes personal funds only for money already spent and with no company account', () => {
    expect(schema.safeParse(value({ personalFunds: true, alreadyPaid: false })).success).toBe(false)
    expect(
      schema.safeParse(value({ personalFunds: true, alreadyPaid: true, accountId: '1' })).success,
    ).toBe(false)
    const own = value({ personalFunds: true, alreadyPaid: true, accountId: '' })
    expect(schema.safeParse(own).success).toBe(true)
    expect(toRequestBody(own, references).accountId).toBeNull()
  })

  it('EARS-508: insists on a paying account for money that did not leave a member card', () => {
    expect(schema.safeParse(value({ accountId: '' })).success).toBe(false)
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
})
