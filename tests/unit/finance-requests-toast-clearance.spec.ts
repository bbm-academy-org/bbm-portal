// The ONE notification channel and the ONE overlay of `/p/finance/requests`
// share a screen corner (#473 item 1). This file specifies what the reader
// gets when both are on screen; the board's own behaviour is
// `finance-requests-ui.spec.ts`.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}

import type {
  RequestBoardItem,
  RequestBoardReferences,
} from '@/app/(platform)/p/finance/requests/request-board-contract'
import { RequestDetailsSheet } from '@/app/(platform)/p/finance/requests/RequestDetailsSheet'
import { RequestsToaster } from '@/app/(platform)/p/finance/requests/RequestsToaster'

const references: RequestBoardReferences = {
  accounts: [{ id: 1, name: 'Банк RUB', currency: 'RUB' }],
  counterparties: [{ id: 7, name: 'ООО «Студия-7»' }],
  currencies: [{ code: 'RUB', name: 'Российский рубль', precision: 2 }],
  products: [],
  projects: [{ id: 3, name: 'Doctor.School' }],
  purposes: [{ id: 21, name: 'Продакшн', categoryId: 5, productBinding: 'optional' }],
}

const request: RequestBoardItem = {
  id: 1,
  own: true,
  status: 'approved',
  occurredOn: '2026-08-22',
  createdAt: '2026-08-20T09:30:00.000Z',
  sourceRef: null,
  sourceUrl: null,
  sourceLabel: null,
  amount: '4500000',
  currency: 'RUB',
  paidAmount: null,
  paidCurrency: null,
  note: 'Аренда студии',
  alreadyPaid: false,
  personalFunds: false,
  createdByName: 'М. Иванова',
  refusalReason: null,
  operationId: null,
  purpose: { id: 21, name: 'Продакшн', categoryId: 5, categoryName: 'Производство' },
  project: { id: 3, name: 'Doctor.School' },
  product: null,
  account: { id: 1, name: 'Банк RUB', currency: 'RUB' },
  counterparty: { id: 7, name: 'ООО «Студия-7»' },
  documents: [],
}

function sheet() {
  return React.createElement(RequestDetailsSheet, {
    request,
    references,
    canApprove: true,
    canEnter: true,
    pending: false,
    pendingAct: null,
    uploading: false,
    onAct: vi.fn(),
    onAttach: vi.fn(),
    onEdit: vi.fn(),
    onClose: vi.fn(),
  })
}

/** Sonner paints nothing until it carries a toast — so the act is raised first. */
async function raiseToast(): Promise<void> {
  await act(async () => {
    toast.success('Документ приложен.')
  })
  await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull())
}

function toaster(): HTMLElement {
  const node = document.querySelector('[data-sonner-toaster]')
  if (node === null) throw new Error('the notification channel is not on the page')
  return node as HTMLElement
}

/** The bottom offset sonner is actually rendering with, in px. */
function bottomOffsetPx(): number {
  const raw = toaster().style.getPropertyValue('--offset-bottom').trim()
  if (raw.endsWith('rem')) return Number.parseFloat(raw) * 16
  return Number.parseFloat(raw)
}

afterEach(() => {
  toast.dismiss()
  cleanup()
})

describe('the toast never sits on the details sheet’s footer (#473 item 1)', () => {
  it('leaves the corner alone while no sheet is open', async () => {
    render(React.createElement(RequestsToaster))
    await raiseToast()

    expect(bottomOffsetPx()).toBeLessThan(48)
  })

  it('clears the footer while the details sheet is open', async () => {
    render(React.createElement(React.Fragment, null, React.createElement(RequestsToaster), sheet()))
    await raiseToast()

    // The footer is the reason: its controls are the next act, and the toast
    // used to cover them for its whole lifetime on both breakpoints.
    expect(screen.getByRole('button', { name: 'Отклонить…' })).toBeTruthy()
    expect(bottomOffsetPx()).toBeGreaterThanOrEqual(96)
  })

  it('gives the corner back once the sheet closes', async () => {
    const view = render(
      React.createElement(React.Fragment, null, React.createElement(RequestsToaster), sheet()),
    )
    await raiseToast()
    await act(async () => {
      view.rerender(React.createElement(React.Fragment, null, React.createElement(RequestsToaster)))
    })

    expect(bottomOffsetPx()).toBeLessThan(48)
  })
})
