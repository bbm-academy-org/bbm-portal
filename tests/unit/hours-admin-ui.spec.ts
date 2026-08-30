import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refine = vi.hoisted(() => ({
  list: {} as Record<string, unknown>,
  one: {} as Record<string, unknown>,
  create: { mutate: vi.fn(), mutation: { isPending: false, error: null } },
  update: { mutate: vi.fn(), mutation: { isPending: false, error: null } },
  navigation: { create: vi.fn(), edit: vi.fn(), list: vi.fn() },
}))

vi.mock('@refinedev/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@refinedev/core')>()),
  useList: () => refine.list,
  useOne: () => refine.one,
  useCreate: () => refine.create,
  useUpdate: () => refine.update,
  useNavigation: () => refine.navigation,
}))

beforeEach(() => {
  refine.list = { query: { isLoading: false, error: null }, result: { data: [], total: 0 } }
  refine.one = { query: { isLoading: false, error: null }, result: undefined }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ data: [], total: 0 })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('hours cabinet UI (owner Option A, spec 311 EARS-446..452)', () => {
  it('renders separate calm periods list and create pages', async () => {
    const { HoursPeriodsScreen } =
      await import('@/app/(platform)/p/admin/hours/periods/HoursPeriodsScreen')
    const { HoursPeriodCreateScreen } =
      await import('@/app/(platform)/p/admin/hours/periods/HoursPeriodCreateScreen')
    const view = render(React.createElement(HoursPeriodsScreen))
    expect(screen.getByRole('heading', { name: 'Периоды' })).toBeTruthy()
    expect(screen.getByText('Периодов пока нет')).toBeTruthy()
    view.rerender(React.createElement(HoursPeriodCreateScreen))
    expect(screen.getByRole('heading', { name: 'Новый период' })).toBeTruthy()
  })

  it('renders the searchable rates table and separate participant create page', async () => {
    const { HoursParticipantsScreen } =
      await import('@/app/(platform)/p/admin/hours/participants/HoursParticipantsScreen')
    const { HoursParticipantCreateScreen } =
      await import('@/app/(platform)/p/admin/hours/participants/HoursParticipantCreateScreen')
    const view = render(React.createElement(HoursParticipantsScreen))
    expect(screen.getByRole('heading', { name: 'Ставки и грейды' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Поиск участников' })).toBeTruthy()
    view.rerender(React.createElement(HoursParticipantCreateScreen))
    expect(screen.getByRole('heading', { name: 'Новый участник' })).toBeTruthy()
  })

  it('renders dedicated export and Mattermost publication action pages', async () => {
    const { HoursExportScreen } =
      await import('@/app/(platform)/p/admin/hours/export/HoursExportScreen')
    const { HoursPublicationScreen } =
      await import('@/app/(platform)/p/admin/hours/publication/HoursPublicationScreen')
    const view = render(React.createElement(HoursExportScreen))
    expect(screen.getByRole('heading', { name: 'Экспорт' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Скачать JSON' })).toBeTruthy()
    view.rerender(React.createElement(HoursPublicationScreen))
    expect(screen.getByRole('heading', { name: 'Публикация в Mattermost' })).toBeTruthy()
    expect(screen.getByLabelText('Период')).toBeTruthy()
  })
})
