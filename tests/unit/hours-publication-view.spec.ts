import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { buildMattermostPreview } from '@/lib/hours'
import type {
  HoursDocument,
  Period,
  Publication,
  PublicationPreview,
  PublicationStatus,
} from '@/lib/hours'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const authState = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/auth', () => ({ auth: async () => authState.session }))
vi.mock('@/modules/hours/actions', () => {
  const idle = async () => ({ status: 'idle', message: '', warnings: [], saved: null })
  return {
    createPeriodAction: idle,
    deletePeriodAction: idle,
    publishHoursToMattermostAction: idle,
    saveAssessmentAction: idle,
    saveParticipantAction: idle,
    setPeriodStatusAction: idle,
    updatePeriodAction: idle,
  }
})

interface PanelProps {
  preview: PublicationPreview
  publication: Publication | null
}

type Panel = React.ComponentType<PanelProps>

async function panelComponent(): Promise<Panel> {
  const view = await import('@/modules/hours/view/AdminForms')
  const candidate = (
    view as unknown as {
      MattermostVerificationPanel?: Panel
    }
  ).MattermostVerificationPanel
  expect(
    candidate,
    'PHASE B3: export MattermostVerificationPanel from the hours admin view',
  ).toBeTypeOf('function')
  return candidate as Panel
}

function document(status: 'open' | 'closed' = 'closed'): HoursDocument {
  return {
    participants: [
      {
        email: 'anton@bbm.academy',
        name: 'Антон',
        role: 'Продукт',
        fork_min: 150_000,
        fork_max: 250_000,
        grade: 'II',
      },
      { email: 'new@bbm.academy', name: 'Новый' },
    ],
    periods: [
      {
        id: 'p-july',
        label: 'Июль 2026',
        date_from: '2026-07-01',
        date_to: '2026-07-31',
        status,
      },
    ],
    assessments: [
      {
        period_id: 'p-july',
        email: 'anton@bbm.academy',
        hours: 160,
        method: 'period',
        weekend_hours: 0,
        split_percent: 30,
        monthly_rate: 200_000,
        hourly_rate: 200_000 / 184,
        accrual: 173_913,
        cash_amount: 121_739,
        invest_amount: 52_174,
        weekday_count: 23,
        saved_at: '2026-08-01T09:00:00.000Z',
      },
      {
        period_id: 'p-july',
        email: 'new@bbm.academy',
        hours: 40,
        method: 'day',
        weekend_hours: 0,
        split_percent: 20,
        monthly_rate: null,
        hourly_rate: null,
        accrual: 0,
        cash_amount: 0,
        invest_amount: 0,
        weekday_count: 23,
        saved_at: '2026-08-01T09:01:00.000Z',
      },
    ],
  }
}

function storedPublication(
  preview: PublicationPreview,
  status: 'sending' | 'published' | 'incomplete',
  deliveries?: Array<'pending' | 'sent' | 'failed' | 'unknown'>,
): Publication {
  return {
    period_id: preview.period_id,
    status,
    started_at: '2026-08-02T00:00:00.000Z',
    published_at: status === 'published' ? '2026-08-02T00:00:02.000Z' : null,
    preview_fingerprint: preview.preview_fingerprint,
    messages: preview.messages.map((message, index) => {
      const delivery =
        deliveries?.[index] ?? (status === 'published' ? ('sent' as const) : ('pending' as const))
      return {
        ...message,
        delivery,
        sent_at: delivery === 'sent' ? `2026-08-02T00:00:0${index + 1}.000Z` : null,
      }
    }),
  }
}

function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

function staticRender(Component: Panel, props: PanelProps): HTMLElement {
  const host = window.document.createElement('div')
  host.innerHTML = renderToStaticMarkup(React.createElement(Component, props))
  return host
}

async function mount(Component: Panel, props: PanelProps) {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(Component, props))
  })
  return {
    container,
    click: async (element: Element) => {
      await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    },
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function buttonByText(container: ParentNode, label: RegExp): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((button) => label.test(text(button))) as
    | HTMLButtonElement
    | undefined
}

describe('Mattermost verification panel — collapsed/preview states', () => {
  it('shows the counter, reveals exact full cards, then places publish below preview', async () => {
    const Component = await panelComponent()
    const preview = buildMattermostPreview(document(), 'p-july')
    const rendered = await mount(Component, { preview, publication: null })
    try {
      expect(text(rendered.container)).toContain('2 сохранённые оценки')
      const previewButton = buttonByText(rendered.container, /Предпросмотр сообщений/)
      expect(previewButton).toBeDefined()
      expect(previewButton?.className).toContain('hours-btn--ghost')
      expect(rendered.container.querySelectorAll('[data-mattermost-message]')).toHaveLength(0)
      expect(buttonByText(rendered.container, /Отправить 2 сообщения/)).toBeUndefined()

      await rendered.click(previewButton!)

      const cards = [...rendered.container.querySelectorAll('[data-mattermost-message]')]
      expect(cards).toHaveLength(2)
      expect(cards.map((card) => card.textContent)).toEqual(
        preview.messages.map((message) => message.text),
      )
      const publish = buttonByText(rendered.container, /Отправить 2 сообщения в „BBM Финансы“/)
      expect(publish).toBeDefined()
      expect(publish?.className).toContain('hours-btn')
      expect(cards[1].compareDocumentPosition(publish!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
    } finally {
      rendered.cleanup()
    }
  })

  it('open period keeps preview available but disables publish with an explicit reason', async () => {
    const Component = await panelComponent()
    const preview = buildMattermostPreview(document('open'), 'p-july')
    const rendered = await mount(Component, { preview, publication: null })
    try {
      expect(text(rendered.container)).toMatch(/сначала закрой период/i)
      const previewButton = buttonByText(rendered.container, /Предпросмотр сообщений/)
      expect(previewButton?.disabled).toBe(false)
      await rendered.click(previewButton!)
      expect(buttonByText(rendered.container, /Отправить 2 сообщения/)?.disabled).toBe(true)
    } finally {
      rendered.cleanup()
    }
  })

  it('empty period names the reason instead of exposing an empty preview action', async () => {
    const Component = await panelComponent()
    const source = document()
    source.assessments = []
    const preview = buildMattermostPreview(source, 'p-july')
    const host = staticRender(Component, { preview, publication: null })
    expect(text(host)).toContain('0 сохранённых оценок')
    expect(text(host)).toMatch(/нет сохранённых оценок/i)
    expect(buttonByText(host, /Предпросмотр сообщений/)?.disabled).toBe(true)
  })
})

describe('Mattermost verification panel — loading/published/error states', () => {
  it('persisted sending is unfinished, blocked and requires manual reconciliation', async () => {
    const Component = await panelComponent()
    const preview = buildMattermostPreview(document(), 'p-july')
    const sending = storedPublication(preview, 'sending')
    const host = staticRender(Component, { preview, publication: sending })

    expect(text(host)).toMatch(/публикация не завершена/i)
    expect(text(host)).toMatch(/отправлено 0 из 2/i)
    expect(text(host)).toMatch(/автоматический повтор заблокирован/i)
    expect(text(host)).toMatch(/ручн.*сверк/i)
    expect(host.querySelector('[aria-live]')).not.toBeNull()
    expect(buttonByText(host, /Отправля/)).toBeUndefined()
    expect(buttonByText(host, /Отправить \d/)).toBeUndefined()
  })

  it('published state shows time/count and previews stored texts despite current identity drift', async () => {
    const Component = await panelComponent()
    const original = document()
    const originalPreview = buildMattermostPreview(original, 'p-july')
    const published = storedPublication(originalPreview, 'published')
    const changed = document()
    changed.participants[0].name = 'Изменённое имя'
    changed.assessments[0].hours = 999
    changed.publications = [published]
    const currentPreview = buildMattermostPreview(changed, 'p-july')
    const rendered = await mount(Component, { preview: currentPreview, publication: published })
    try {
      expect(text(rendered.container)).toMatch(/Опубликовано/i)
      expect(text(rendered.container)).toContain('02.08.2026')
      expect(text(rendered.container)).toMatch(/2 (поста|сообщения)/)
      expect(buttonByText(rendered.container, /Отправить \d/)).toBeUndefined()

      await rendered.click(buttonByText(rendered.container, /Предпросмотр сообщений/)!)
      const cards = [...rendered.container.querySelectorAll('[data-mattermost-message]')]
      expect(cards.map((card) => card.textContent)).toEqual(
        published.messages.map((message) => message.text),
      )
      expect(text(rendered.container)).not.toContain('Изменённое имя')
    } finally {
      rendered.cleanup()
    }
  })

  it('incomplete/unknown shows stored progress and blocks retry', async () => {
    const Component = await panelComponent()
    const originalPreview = buildMattermostPreview(document(), 'p-july')
    const incomplete = storedPublication(originalPreview, 'incomplete', ['sent', 'unknown'])
    const changed = document()
    changed.participants[0].role = 'Новая роль'
    changed.publications = [incomplete]
    const currentPreview = buildMattermostPreview(changed, 'p-july')
    const rendered = await mount(Component, { preview: currentPreview, publication: incomplete })
    try {
      expect(text(rendered.container)).toMatch(/1 из 2/)
      expect(text(rendered.container)).toMatch(/результат доставки неизвестен/i)
      expect(buttonByText(rendered.container, /Отправить \d/)).toBeUndefined()
      await rendered.click(buttonByText(rendered.container, /Предпросмотр сообщений/)!)
      expect(
        [...rendered.container.querySelectorAll('[data-mattermost-message]')].map(
          (card) => card.textContent,
        ),
      ).toEqual(incomplete.messages.map((message) => message.text))
      expect(text(rendered.container)).not.toContain('Новая роль')
    } finally {
      rendered.cleanup()
    }
  })
})

describe('publication-batch PeriodRowActions freeze', () => {
  it.each<PublicationStatus>(['sending', 'incomplete', 'published'])(
    'proactively removes reopen and label/date edit controls for %s',
    async (publicationStatus) => {
      const view = await import('@/modules/hours/view/AdminForms')
      const PeriodRowActions = view.PeriodRowActions as unknown as React.ComponentType<{
        period: Period
        hasAssessments: boolean
        publicationStatus: PublicationStatus
      }>
      const period = { ...document().periods[0], status: 'closed' as const }
      const host = window.document.createElement('div')
      host.innerHTML = renderToStaticMarkup(
        React.createElement(PeriodRowActions, {
          period,
          hasAssessments: true,
          publicationStatus,
        }),
      )

      expect(buttonByText(host, /Открыть/)).toBeUndefined()
      expect(host.querySelector('input[name="label"]')).toBeNull()
      expect(host.querySelector('input[name="dateFrom"]')).toBeNull()
      expect(host.querySelector('input[name="dateTo"]')).toBeNull()
      expect(text(host)).toMatch(
        publicationStatus === 'published'
          ? /опубликован.*нельзя|нельзя.*опубликован/i
          : /публикация начата.*ручн.*сверк|ручн.*сверк.*публикация начата/i,
      )
    },
  )
})

describe('prototype state styling contract', () => {
  const css = readFileSync(
    join(__dirname, '..', '..', 'src', 'modules', 'hours', 'view', 'hours.css'),
    'utf8',
  )

  it('panel buttons inherit explicit hover, keyboard-focus and disabled/loading affordances', () => {
    expect(css).toMatch(/\.hours-btn--ghost:hover/)
    expect(css).toMatch(/\.hours-root :focus-visible/)
    expect(css).toMatch(/\.hours-btn\[disabled\]/)
  })
})

describe('admin page wiring', () => {
  it('passes the period selected for the summary to the inline verification panel', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bbm-hours-publication-page-'))
    const file = join(directory, 'hours.json')
    const originalDataFile = process.env.HOURS_DATA_FILE
    const originalAdmins = process.env.HOURS_ADMIN_EMAILS
    const source = document('open')
    source.periods.push({
      id: 'p-june',
      label: 'Июнь 2026',
      date_from: '2026-06-01',
      date_to: '2026-06-30',
      status: 'closed',
    })
    source.assessments.push({
      ...source.assessments[0],
      period_id: 'p-june',
      hours: 80,
      saved_at: '2026-07-01T09:00:00.000Z',
    })
    try {
      process.env.HOURS_DATA_FILE = file
      process.env.HOURS_ADMIN_EMAILS = 'anton@bbm.academy'
      authState.session = { user: { email: 'anton@bbm.academy' } }
      writeFileSync(file, JSON.stringify(source), 'utf8')

      const { default: HoursAdminPage } = await import('@/app/(platform)/p/hours/admin/page')
      const element = await HoursAdminPage({
        searchParams: Promise.resolve({ period: 'p-june' }),
      })
      const html = renderToStaticMarkup(element).replace(/ /g, ' ')

      expect(html).toContain('data-verification-period="p-june"')
      expect(html).toContain('1 сохранённая оценка')
      expect(html).not.toContain('2 сохранённые оценки')
    } finally {
      if (originalDataFile === undefined) delete process.env.HOURS_DATA_FILE
      else process.env.HOURS_DATA_FILE = originalDataFile
      if (originalAdmins === undefined) delete process.env.HOURS_ADMIN_EMAILS
      else process.env.HOURS_ADMIN_EMAILS = originalAdmins
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each<PublicationStatus>(['sending', 'incomplete'])(
    'passes %s batch state to period controls and removes reopen/edit affordances',
    async (publicationStatus) => {
      const directory = mkdtempSync(join(tmpdir(), 'bbm-hours-publication-lock-page-'))
      const file = join(directory, 'hours.json')
      const originalDataFile = process.env.HOURS_DATA_FILE
      const originalAdmins = process.env.HOURS_ADMIN_EMAILS
      const source = document('closed')
      const preview = buildMattermostPreview(source, 'p-july')
      source.publications = [storedPublication(preview, publicationStatus)]
      try {
        process.env.HOURS_DATA_FILE = file
        process.env.HOURS_ADMIN_EMAILS = 'anton@bbm.academy'
        authState.session = { user: { email: 'anton@bbm.academy' } }
        writeFileSync(file, JSON.stringify(source), 'utf8')

        const { default: HoursAdminPage } = await import('@/app/(platform)/p/hours/admin/page')
        const element = await HoursAdminPage({ searchParams: Promise.resolve({}) })
        const host = window.document.createElement('div')
        host.innerHTML = renderToStaticMarkup(element)

        expect(text(host)).toMatch(/публикация начата.*ручн.*сверк/i)
        const periodItem = [...host.querySelectorAll('.hours-months > li')].find((item) =>
          text(item).includes('Июль 2026'),
        )
        expect(periodItem).toBeDefined()
        expect(buttonByText(periodItem!, /Открыть/)).toBeUndefined()
        expect(periodItem?.querySelector('input[name="label"]')).toBeNull()
        expect(periodItem?.querySelector('input[name="dateFrom"]')).toBeNull()
        expect(periodItem?.querySelector('input[name="dateTo"]')).toBeNull()
      } finally {
        if (originalDataFile === undefined) delete process.env.HOURS_DATA_FILE
        else process.env.HOURS_DATA_FILE = originalDataFile
        if (originalAdmins === undefined) delete process.env.HOURS_ADMIN_EMAILS
        else process.env.HOURS_ADMIN_EMAILS = originalAdmins
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
})
