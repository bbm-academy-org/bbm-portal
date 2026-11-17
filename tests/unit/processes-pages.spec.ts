import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProcessModelLoad } from '@/lib/processes'
import { PROCESS_CATALOG, processBySlug, processesWorkspaceEntry } from '@/lib/processes'

/**
 * The «Процессы» workspace (#553, spec 553): the registry entry that gives the
 * launcher tile and the switcher entry, the index of processes, and the IDEF0
 * page's three states around the viewer — fresh, stale copy, no model at all.
 * The viewer itself is a browser-only module (it measures text on a canvas),
 * so it is stubbed here and exercised in `processes-viewer.spec.ts`.
 */

vi.mock('@/modules/processes/idef0/Idef0ViewerClient', () => ({
  Idef0ViewerClient: ({ model }: { model: { index: { root: string } } }) =>
    React.createElement('div', { 'data-testid': 'viewer' }, `viewer:${model.index.root}`),
}))

const el = React.createElement
afterEach(cleanup)

const ENTRY = processBySlug('ds-content-production')!
const MODEL = {
  index: { root: 'A-0', diagrams: [{ id: 'A-0', file: 'A-0.yaml', parent: null }] },
  diagrams: [{ id: 'A-0', parent: null, title: 'Пример', boxes: [], arrows: [] }],
  knowledge: null,
  knowledgeError: null,
}
const GITHUB = {
  kind: 'github' as const,
  repo: 'bbm-academy-org/bbm-kb',
  ref: 'main',
  dir: 'content/processes/ds-content-production',
}

describe('the workspace entry (spec 553 EARS-601)', () => {
  it('EARS-601: «Процессы» is an internal app at /p/processes with no cabinet section and no pulse', () => {
    expect(processesWorkspaceEntry).toMatchObject({
      kind: 'internal',
      slug: 'processes',
      name: 'Процессы',
      href: '/p/processes',
    })
    expect('admin' in processesWorkspaceEntry).toBe(false)
    expect('status' in processesWorkspaceEntry).toBe(false)
  })
})

describe('/p/processes (spec 553 EARS-602)', () => {
  it('EARS-602: lists every process of the catalog, «Производство контента DS» first, each a link to its page', async () => {
    const page = await import('@/app/(platform)/p/processes/page')
    render(el(page.default))
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(PROCESS_CATALOG.length)
    expect(links[0].getAttribute('href')).toBe('/p/processes/ds-content-production')
    expect(links[0].textContent).toContain('Производство контента DS')
    expect(links[0].textContent).toContain(PROCESS_CATALOG[0].description)
  })
})

describe('the IDEF0 page around the viewer (spec 553 EARS-606, EARS-607, EARS-608)', () => {
  it('renders per request', async () => {
    const page = await import('@/app/(platform)/p/processes/ds-content-production/page')
    expect(page.dynamic).toBe('force-dynamic')
  })

  it('EARS-603: a fresh live model renders the viewer and no notice, with a link to the KB package', async () => {
    const { ProcessModelScreen } = await import('@/modules/processes/view/ProcessModelScreen')
    const loaded: ProcessModelLoad = {
      ok: true,
      model: MODEL,
      origin: GITHUB,
      revision: 'abc',
      stale: false,
      asOf: '2026-11-17T10:00:00Z',
    }
    render(el(ProcessModelScreen, { entry: ENTRY, loaded }))
    expect(screen.getByTestId('viewer').textContent).toBe('viewer:A-0')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'Производство контента DS',
    )
    const kb = screen.getByRole('link', { name: /база знаний|пакет модели/i })
    expect(kb.getAttribute('href')).toBe(ENTRY.kbUrl)
  })

  it('EARS-606: a stale copy renders the viewer with a notice naming the time (MSK) and the reason', async () => {
    const { ProcessModelScreen } = await import('@/modules/processes/view/ProcessModelScreen')
    const loaded: ProcessModelLoad = {
      ok: true,
      model: MODEL,
      origin: GITHUB,
      revision: 'abc',
      stale: true,
      staleReason: 'invalid',
      staleMessage: 'model/A0.yaml: не YAML',
      asOf: '2026-11-17T10:05:00Z',
    }
    render(el(ProcessModelScreen, { entry: ENTRY, loaded }))
    expect(screen.getByTestId('viewer')).toBeTruthy()
    const notice = screen.getByRole('status').textContent ?? ''
    expect(notice).toMatch(/могли устареть/)
    expect(notice).toContain('13:05')
    expect(notice).toContain('model/A0.yaml')
  })

  it('EARS-607: no model at all renders an error state naming the source and the reason, never a blank page', async () => {
    const { ProcessModelScreen } = await import('@/modules/processes/view/ProcessModelScreen')
    const loaded: ProcessModelLoad = {
      ok: false,
      origin: GITHUB,
      failure: {
        reason: 'not-found',
        message: 'файл модели не найден: bbm-academy-org/bbm-kb@main · model/index.yaml (404)',
      },
      asOf: '2026-11-17T10:00:00Z',
    }
    render(el(ProcessModelScreen, { entry: ENTRY, loaded }))
    expect(screen.queryByTestId('viewer')).toBeNull()
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toMatch(/не удалось прочитать модель/i)
    expect(alert).toContain('bbm-academy-org/bbm-kb@main')
    expect(alert).toContain('(404)')
  })

  it('EARS-608: the example says it is not the live model', async () => {
    const { ProcessModelScreen } = await import('@/modules/processes/view/ProcessModelScreen')
    const loaded: ProcessModelLoad = {
      ok: true,
      model: MODEL,
      origin: { kind: 'example', dir: 'content/processes/example' },
      revision: null,
      stale: false,
      asOf: '2026-11-17T10:00:00Z',
    }
    render(el(ProcessModelScreen, { entry: ENTRY, loaded }))
    expect(screen.getByRole('status').textContent).toMatch(/выдуманный пример.*не рабочая модель/i)
  })
})
