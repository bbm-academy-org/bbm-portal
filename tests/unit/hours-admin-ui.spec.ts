import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HoursParticipantCreateScreen } from '@/app/(platform)/p/admin/hours/participants/HoursParticipantCreateScreen'
import { HoursParticipantsScreen } from '@/app/(platform)/p/admin/hours/participants/HoursParticipantsScreen'
import { HoursPeriodCreateScreen } from '@/app/(platform)/p/admin/hours/periods/HoursPeriodCreateScreen'
import { HoursPeriodRecordScreen } from '@/app/(platform)/p/admin/hours/periods/HoursPeriodRecordScreen'
import { HoursPeriodsScreen } from '@/app/(platform)/p/admin/hours/periods/HoursPeriodsScreen'
import { HoursPublicationScreen } from '@/app/(platform)/p/admin/hours/publication/HoursPublicationScreen'
import type { HoursPeriodRecord } from '@/lib/hours'

const refine = vi.hoisted(() => ({
  list: {} as Record<string, unknown>,
  listCalls: [] as Array<Record<string, unknown>>,
  one: {} as Record<string, unknown>,
  create: { mutate: vi.fn(), mutation: { isPending: false, error: null } },
  update: { mutate: vi.fn(), mutation: { isPending: false, error: null } },
  remove: { mutate: vi.fn(), mutation: { isPending: false, error: null } },
  navigation: { create: vi.fn(), edit: vi.fn(), list: vi.fn() },
}))

vi.mock('@refinedev/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@refinedev/core')>()),
  useList: (params: Record<string, unknown>) => {
    refine.listCalls.push(params)
    return refine.list
  },
  useOne: () => refine.one,
  useCreate: () => refine.create,
  useUpdate: () => refine.update,
  useDelete: () => refine.remove,
  useNavigation: () => refine.navigation,
}))

beforeEach(() => {
  refine.list = { query: { isLoading: false, error: null }, result: { data: [], total: 0 } }
  refine.listCalls = []
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

const defaultPublicationPeriodCases: Array<{
  scenario: string
  periods: HoursPeriodRecord[]
  expectedId: string
}> = [
  {
    scenario: 'the open period when an older closed period comes first',
    periods: [
      {
        id: 'p-old',
        label: 'Old closed',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
        status: 'closed',
        locked: false,
        publicationStatus: null,
        warnings: [],
        assessments: [],
      },
      {
        id: 'p-latest-closed',
        label: 'Latest closed',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
        status: 'closed',
        locked: false,
        publicationStatus: null,
        warnings: [],
        assessments: [],
      },
      {
        id: 'p-open',
        label: 'Open',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
        status: 'open',
        locked: false,
        publicationStatus: null,
        warnings: [],
        assessments: [],
      },
    ],
    expectedId: 'p-open',
  },
  {
    scenario: 'the latest closed period by dateTo when none is open',
    periods: [
      {
        id: 'p-old',
        label: 'Old closed',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
        status: 'closed',
        locked: false,
        publicationStatus: null,
        warnings: [],
        assessments: [],
      },
      {
        id: 'p-latest-closed',
        label: 'Latest closed',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
        status: 'closed',
        locked: false,
        publicationStatus: null,
        warnings: [],
        assessments: [],
      },
      {
        id: 'p-middle',
        label: 'Middle closed',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
        status: 'closed',
        locked: false,
        publicationStatus: null,
        warnings: [],
        assessments: [],
      },
    ],
    expectedId: 'p-latest-closed',
  },
]

describe('hours cabinet UI (owner Option A, spec 311 EARS-446..452)', () => {
  it('shows the safe data-unavailable reason returned by an Hours handler', () => {
    const safeMessage =
      'Данные недоступны: база модуля часов не отвечает. Повторите попытку позже или обратитесь к владельцу.'
    refine.list = {
      query: { isLoading: false, error: { message: safeMessage, statusCode: 503 } },
      result: { data: [], total: 0 },
    }

    render(React.createElement(HoursPeriodsScreen))

    expect(screen.getByRole('alert').textContent).toContain(safeMessage)
  })

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

  it('renders the dedicated Mattermost publication action page', async () => {
    render(React.createElement(HoursPublicationScreen))
    expect(screen.getByRole('heading', { name: 'Публикация в Mattermost' })).toBeTruthy()
    expect(screen.getByLabelText('Период')).toBeTruthy()
  })

  it.each(defaultPublicationPeriodCases)(
    'EARS-447/450: defaults publication to $scenario',
    async ({ periods, expectedId }) => {
      refine.list = {
        query: { isLoading: false, error: null },
        result: { data: periods, total: periods.length },
      }
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const requestedPeriodId =
          new URL(String(input), 'http://localhost').searchParams.get('periodId') ?? ''
        return Response.json({
          data: {
            id: 'mattermost-publication',
            periodId: requestedPeriodId,
            previewFingerprint: `sha256:${requestedPeriodId}`,
            messages: [],
            eligibility: { status: 'empty', canPublish: false, reason: 'No assessments.' },
            publicationStatus: null,
            startedAt: null,
            publishedAt: null,
          },
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      render(React.createElement(HoursPublicationScreen))

      expect(screen.getByRole('combobox').textContent).toContain(
        periods.find((period) => period.id === expectedId)?.label,
      )
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('leaves participant and period order to the canonical module response', () => {
    const participants = render(React.createElement(HoursParticipantsScreen))
    participants.unmount()
    const periods = render(React.createElement(HoursPeriodsScreen))
    periods.unmount()
    render(React.createElement(HoursPublicationScreen))

    expect(refine.listCalls).toHaveLength(3)
    expect(refine.listCalls.map((call) => call.sorters)).toEqual([undefined, undefined, undefined])
    expect(refine.listCalls.map((call) => call.pagination)).toEqual([
      { mode: 'off' },
      { mode: 'off' },
      { mode: 'off' },
    ])
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

  it('EARS-447/450: keeps exact messages and the channel-specific send action behind explicit preview', async () => {
    const period = {
      id: '2026-08',
      label: 'Август 2026',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      status: 'closed',
      locked: false,
      publicationStatus: null,
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
        {
          email: 'boris@bbm.academy',
          name: 'Борис',
          hours: 7,
          method: 'period',
          weekendHours: 0,
          splitPercent: 20,
          monthlyRate: 120_000,
          hourlyRate: 750,
          accrual: 5_250,
          cashAmount: 4_200,
          investAmount: 1_050,
          weekdayCount: 20,
          savedAt: '2026-08-31T10:01:00.000Z',
        },
      ],
    } satisfies HoursPeriodRecord
    const preview = {
      id: 'mattermost-publication',
      periodId: period.id,
      previewFingerprint: 'sha256:preview',
      messages: [
        {
          email: 'anna@bbm.academy',
          text: '**Верификация часов — Анна**',
          delivery: null,
          sentAt: null,
        },
        {
          email: 'boris@bbm.academy',
          text: '**Верификация часов — Борис**',
          delivery: null,
          sentAt: null,
        },
      ],
      eligibility: { status: 'eligible', canPublish: true, reason: null },
      publicationStatus: null,
      startedAt: null,
      publishedAt: null,
    }
    refine.list = { query: { isLoading: false, error: null }, result: { data: [period], total: 1 } }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: preview }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            ...preview,
            messages: preview.messages.map((message) => ({
              ...message,
              delivery: 'sent',
              sentAt: '2026-08-31T12:01:00.000Z',
            })),
            eligibility: {
              status: 'published',
              canPublish: false,
              reason: 'Период уже опубликован в Mattermost.',
            },
            publicationStatus: 'published',
            startedAt: '2026-08-31T12:00:00.000Z',
            publishedAt: '2026-08-31T12:01:00.000Z',
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(HoursPublicationScreen))

    expect(screen.getByText('2 сохранённые оценки')).toBeTruthy()
    const disclose = screen.getByRole('button', { name: 'Предпросмотр сообщений' })
    expect(screen.queryByText('**Верификация часов — Анна**')).toBeNull()
    expect(screen.queryByRole('button', { name: /Отправить .*BBM Финансы/ })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(disclose)
    expect(await screen.findByText('**Верификация часов — Анна**')).toBeTruthy()
    expect(screen.getByText('**Верификация часов — Борис**')).toBeTruthy()
    const publish = screen.getByRole('button', {
      name: 'Отправить 2 сообщения в „BBM Финансы“',
    })
    expect(publish).toHaveProperty('disabled', false)
    fireEvent.click(publish)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
    expect(await screen.findByText('Опубликовано 2 сообщений в Mattermost.')).toBeTruthy()
  })

  it('refreshes persisted progress and keeps publish locked after a failed attempt', async () => {
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
    const eligiblePreview = {
      id: 'mattermost-publication',
      periodId: period.id,
      previewFingerprint: 'sha256:preview',
      messages: [
        {
          email: 'anna@bbm.academy',
          text: 'Текущий предпросмотр',
          delivery: null,
          sentAt: null,
        },
      ],
      eligibility: { status: 'eligible', canPublish: true, reason: null },
      publicationStatus: null,
      startedAt: null,
      publishedAt: null,
    }
    const persistedAttempt = {
      id: 'mattermost-publication',
      periodId: period.id,
      previewFingerprint: 'sha256:frozen',
      messages: [
        {
          email: 'anna@bbm.academy',
          text: 'Сохранённое сообщение 1',
          delivery: 'sent',
          sentAt: '2026-08-31T12:00:10.000Z',
        },
        {
          email: 'boris@bbm.academy',
          text: 'Сохранённое сообщение 2',
          delivery: 'unknown',
          sentAt: null,
        },
        {
          email: 'vera@bbm.academy',
          text: 'Сохранённое сообщение 3',
          delivery: 'failed',
          sentAt: null,
        },
      ],
      eligibility: {
        status: 'incomplete',
        canPublish: false,
        reason: 'У периода уже есть незавершённая попытка публикации.',
      },
      publicationStatus: 'incomplete',
      startedAt: '2026-08-31T12:00:00.000Z',
      publishedAt: null,
    }
    refine.list = { query: { isLoading: false, error: null }, result: { data: [period], total: 1 } }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: eligiblePreview }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: 'conflict',
              message:
                'Результат доставки неизвестен. Отправлено 1 из 3; автоматический повтор заблокирован.',
            },
          },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ data: persistedAttempt }))
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(HoursPublicationScreen))

    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр сообщений' }))
    const publish = await screen.findByRole('button', {
      name: 'Отправить 1 сообщение в „BBM Финансы“',
    })
    fireEvent.click(publish)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(await screen.findByText('Публикация не завершена')).toBeTruthy()
    expect(screen.getByText('Отправлено 1 из 3 сообщений.')).toBeTruthy()
    expect(screen.getByText('Результат неизвестен')).toBeTruthy()
    expect(screen.getByText('Не доставлено')).toBeTruthy()
    expect(screen.getByText('Начато')).toBeTruthy()
    expect(screen.getByText('Сохранённое сообщение 1')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Отправить 3 сообщения в „BBM Финансы“' }),
    ).toHaveProperty('disabled', true)
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
            startedAt: null,
            publishedAt: null,
          },
        }),
      ),
    )
    render(React.createElement(HoursPublicationScreen))
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр сообщений' }))
    expect(await screen.findByText('За этот период нет сохранённых оценок.')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Отправить 0 сообщений в „BBM Финансы“' }),
    ).toHaveProperty('disabled', true)
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
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр сообщений' }))
    expect(await screen.findByText('Mattermost временно недоступен')).toBeTruthy()
  })
})
