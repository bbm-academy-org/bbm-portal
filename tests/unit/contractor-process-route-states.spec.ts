import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ContractorProcessError from '@/app/(platform)/p/finance/contractor-process/error'
import ContractorProcessLoading from '@/app/(platform)/p/finance/contractor-process/loading'

/**
 * The route-level states of `/p/finance/contractor-process` (#545). Without its
 * own `loading.tsx` / `error.tsx` the route inherits `/p/finance`'s: the
 * balances skeleton (a primary cash card and four account tiles) while the
 * GitHub read runs, then a swap to the swimlane map — the #388 «defect C»
 * pattern — and «Остатки временно недоступны» on a render error. Pinned here:
 * the loading frame is this section's (its header and the map's «Схема
 * рисуется…» placeholder, no balances look) and the error is worded for the
 * process, with a retry.
 *
 * Written with `React.createElement`: the vitest include glob is `*.spec.ts`.
 */

afterEach(cleanup)

describe('/p/finance/contractor-process loading.tsx', () => {
  it('paints this section’s header and the map placeholder, not the balances skeleton', () => {
    const { container } = render(React.createElement(ContractorProcessLoading))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Как работаем с исполнителями' }),
    ).toBeTruthy()
    const placeholder = screen.getByRole('status')
    expect(placeholder.textContent).toBe('Схема рисуется…')
    expect(placeholder.getAttribute('aria-busy')).toBe('true')
    // The overview's skeleton: «Загружаем финансы», the primary cash card, the tiles.
    expect(container.textContent).not.toContain('Загружаем финансы')
    expect(container.querySelector('[aria-label="Загружаем финансы"]')).toBeNull()
    expect(container.querySelector('.bg-primary')).toBeNull()
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    // No click hint: there is nothing to click yet.
    expect(container.textContent).not.toContain('нажмите на шаг')
  })
})

describe('/p/finance/contractor-process error.tsx', () => {
  it('says the process map could not be shown — never «Остатки» — and retries', () => {
    const reset = vi.fn()
    const { container } = render(
      React.createElement(ContractorProcessError, { error: new Error('boom'), reset }),
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Схема процесса не показана')
    expect(alert.textContent).toContain('Не удалось нарисовать схему работы с исполнителями')
    expect(container.textContent).not.toMatch(/Остатки|финансовый контур/)
    // The section's own header stays, so the member knows where they are.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Как работаем с исполнителями' }),
    ).toBeTruthy()
    // The raw error is not shown to the member.
    expect(container.textContent).not.toContain('boom')
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
