import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HoursExportScreen } from '@/app/(platform)/p/admin/hours/export/HoursExportScreen'
import { HoursParticipantCreateScreen } from '@/app/(platform)/p/admin/hours/participants/HoursParticipantCreateScreen'
import { HoursParticipantsScreen } from '@/app/(platform)/p/admin/hours/participants/HoursParticipantsScreen'
import { HoursPeriodCreateScreen } from '@/app/(platform)/p/admin/hours/periods/HoursPeriodCreateScreen'
import { HoursPeriodRecordScreen } from '@/app/(platform)/p/admin/hours/periods/HoursPeriodRecordScreen'
import { HoursPeriodsScreen } from '@/app/(platform)/p/admin/hours/periods/HoursPeriodsScreen'
import { HoursPublicationScreen } from '@/app/(platform)/p/admin/hours/publication/HoursPublicationScreen'
import type { HoursPeriodRecord, HoursPublicationRecord } from '@/lib/hours'

const refine = vi.hoisted(() => ({
  list: {} as Record<string, unknown>,
  one: {} as Record<string, unknown>,
  create: { mutate: vi.fn(), mutation: { isPending: false, error: null } },
  update: { mutate: vi.fn(), mutation: { isPending: false, error: null } },
  remove: { mutate: vi.fn(), mutation: { isPending: false, error: null } },
  navigation: { create: vi.fn(), edit: vi.fn(), list: vi.fn() },
}))

vi.mock('@refinedev/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@refinedev/core')>()),
  useList: () => refine.list,
  useOne: () => refine.one,
  useCreate: () => refine.create,
  useUpdate: () => refine.update,
  useDelete: () => refine.remove,
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
    const view = render(React.createElement(HoursPeriodsScreen))
    expect(screen.getByRole('heading', { name: 'Периоды' })).toBeTruthy()
    expect(screen.getByText('Периодов пока нет')).toBeTruthy()
    view.rerender(React.createElement(HoursPeriodCreateScreen))
    expect(screen.getByRole('heading', { name: 'Новый период' })).toBeTruthy()
  })

  it('renders the searchable rates table and separate participant create page', async () => {
    const view = render(React.createElement(HoursParticipantsScreen))
    expect(screen.getByRole('heading', { name: 'Ставки и грейды' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Поиск участников' })).toBeTruthy()
    view.rerender(React.createElement(HoursParticipantCreateScreen))
    expect(screen.getByRole('heading', { name: 'Новый участник' })).toBeTruthy()
  })

  it('renders dedicated export and Mattermost publication action pages', async () => {
    const view = render(React.createElement(HoursExportScreen))
    expect(screen.getByRole('heading', { name: 'Экспорт' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Скачать JSON' })).toBeTruthy()
    view.rerender(React.createElement(HoursPublicationScreen))
    expect(screen.getByRole('heading', { name: 'Публикация в Mattermost' })).toBeTruthy()
    expect(screen.getByLabelText('Период')).toBeTruthy()
  })

  it('renders locked periods and assessments as a read-only table', () => {
    const period: HoursPeriodRecord = {
      id: '2026-08',
      label: 'Август 2026',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      status: 'closed',
      locked: true,
      publicationStatus: 'published',
      warnings: [],
      assessments: [
        {
          email: 'anna@bbm.academy',
          name: 'Анна',
          hours: 8,
          method: 'period',
          weekendHours: 0,
          splitPercent: 20,
          monthlyRate: 120_000,
          hourlyRate: 750,
          accrual: 6_000,
          cashAmount: 4_800,
          investAmount: 1_200,
          weekdayCount: 20,
          savedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
    }
    refine.one = { query: { isLoading: false, error: null }, result: period }
    render(React.createElement(HoursPeriodRecordScreen, { id: period.id }))

    expect(screen.getByText('Период заблокирован публикацией')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Сохранить период' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('button', { name: 'Открыть период' })).toHaveProperty('disabled', true)
    const assessments = screen.getByRole('table')
    expect(within(assessments).getByText('Анна')).toBeTruthy()
    expect(within(assessments).queryByRole('button')).toBeNull()
  })

  it('shows an eligible exact preview and publishes only after the explicit action', async () => {
    const period = {
      id: '2026-08',
      label: 'Август 2026',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      status: 'closed',
      locked: false,
      publicationStatus: null,
      warnings: [],
      assessments: [],
    } satisfies HoursPeriodRecord
    const preview = {
      id: 'mattermost-publication',
      periodId: period.id,
      previewFingerprint: 'sha256:preview',
      messages: [{ email: 'anna@bbm.academy', text: '**Верификация часов — Анна**' }],
      eligibility: { status: 'eligible', canPublish: true, reason: null },
      publicationStatus: null,
    } satisfies HoursPublicationRecord
    refine.list = { query: { isLoading: false, error: null }, result: { data: [period], total: 1 } }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: preview }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            ...preview,
            eligibility: {
              status: 'published',
              canPublish: false,
              reason: 'Период уже опубликован в Mattermost.',
            },
            publicationStatus: 'published',
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(HoursPublicationScreen))

    expect(await screen.findByText('**Верификация часов — Анна**')).toBeTruthy()
    const publish = screen.getByRole('button', { name: 'Опубликовать в Mattermost' })
    expect(publish).toHaveProperty('disabled', false)
    fireEvent.click(publish)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
    expect(await screen.findByText('Опубликовано 1 сообщений в Mattermost.')).toBeTruthy()
  })

  it('names preview refusal and disables publication for an empty period', async () => {
    const period = {
      id: '2026-08',
      label: 'Август 2026',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      status: 'closed',
      locked: false,
      publicationStatus: null,
      warnings: [],
      assessments: [],
    } satisfies HoursPeriodRecord
    refine.list = { query: { isLoading: false, error: null }, result: { data: [period], total: 1 } }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            id: 'mattermost-publication',
            periodId: period.id,
            previewFingerprint: 'sha256:empty',
            messages: [],
            eligibility: {
              status: 'empty',
              canPublish: false,
              reason: 'За этот период нет сохранённых оценок.',
            },
            publicationStatus: null,
          },
        }),
      ),
    )
    render(React.createElement(HoursPublicationScreen))
    expect(await screen.findByText('За этот период нет сохранённых оценок.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Опубликовать в Mattermost' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('renders a readable preview transport error', async () => {
    const period = {
      id: '2026-08',
      label: 'Август 2026',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      status: 'closed',
      locked: false,
      publicationStatus: null,
      warnings: [],
      assessments: [],
    } satisfies HoursPeriodRecord
    refine.list = { query: { isLoading: false, error: null }, result: { data: [period], total: 1 } }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: { message: 'Mattermost временно недоступен' } }, { status: 503 }),
      ),
    )
    render(React.createElement(HoursPublicationScreen))
    expect(await screen.findByText('Mattermost временно недоступен')).toBeTruthy()
  })
})
