import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPathMap, resetPathMapCache } from '@/lib/path-map'
import { PathMapReadError } from '@/modules/path-map/view/PathMapReadError'
import { PathMapSourceNotice } from '@/modules/path-map/view/PathMapSourceNotice'

/**
 * #534 review: when the map could not be READ (revoked token, wrong path,
 * GitHub down) the page must not say the file has errors and point at its
 * format — the file may be fine; the fix is on the server. Each kind gets its
 * own heading and next step. And a stale copy names why it is stale.
 */

const el = React.createElement
const FILE_ERROR_PHRASES = [/есть ошибки/, /Формат описан/, /README/]
const WHERE = 'bbm-academy-org/path-maps · maps/doctor-school.yaml'

beforeEach(() => {
  resetPathMapCache()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderFailure(
  reason: 'auth' | 'not-found' | 'rate-limit' | 'network' | 'config' | 'local',
) {
  render(el(PathMapReadError, { reason, message: 'подробность', file: WHERE }))
  return screen.getByRole('alert').textContent ?? ''
}

describe('PathMapReadError', () => {
  it('a 401 from GitHub renders the access state, none of the file-error phrases', async () => {
    const loaded = await getPathMap({
      env: { PATH_MAPS_GITHUB_TOKEN: 'github_pat_x' },
      fetch: vi.fn(async () => new Response('{}', { status: 401 })),
    })
    if (loaded.failure?.kind !== 'read') throw new Error('a 401 is a read failure')
    render(
      el(PathMapReadError, {
        reason: loaded.failure.reason,
        message: loaded.failure.message,
        file: loaded.file,
      }),
    )
    const text = screen.getByRole('alert').textContent ?? ''
    for (const phrase of FILE_ERROR_PHRASES) expect(text).not.toMatch(phrase)
    expect(text).toMatch(/нет доступа к репозиторию карт/i)
    expect(text).toMatch(/проверьте токен/i)
    expect(text).toContain('bbm-academy-org/path-maps')
  })

  it.each([
    ['auth', /нет доступа к репозиторию карт/i, /токен/],
    ['not-found', /файл карты не найден/i, /PATH_MAPS_FILE/],
    ['rate-limit', /лимит/i, /обновите страницу/i],
    ['network', /GitHub не отвечает/i, /обновите страницу/i],
    ['config', /настроен неверно/i, /PATH_MAPS_REPO/],
    ['local', /пример карты не прочитан/i, /content\/path-map/],
  ] as const)('%s: its own heading and next step', (reason, heading, step) => {
    const text = renderFailure(reason)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(heading)
    expect(text).toMatch(step)
    expect(text).toContain('подробность')
    for (const phrase of FILE_ERROR_PHRASES) expect(text).not.toMatch(phrase)
  })
})

describe('PathMapSourceNotice — the stale copy names why', () => {
  const ASOF = '2026-11-03T10:05:00Z'
  const notice = (staleReason?: 'auth' | 'not-found' | 'rate-limit' | 'network') => {
    render(el(PathMapSourceNotice, { origin: 'github', stale: true, asOf: ASOF, staleReason }))
    return screen.getByRole('status').textContent ?? ''
  }

  it('auth: no access — check the token, not «GitHub не отвечает»', () => {
    const text = notice('auth')
    expect(text).toMatch(/нет доступа к репозиторию карт/i)
    expect(text).toMatch(/проверьте токен/i)
    expect(text).not.toMatch(/не отвечает/)
    expect(text).toContain('13:05')
  })

  it('not-found: the file is gone from the repo', () => {
    const text = notice('not-found')
    expect(text).toMatch(/не найден/)
    expect(text).not.toMatch(/не отвечает/)
  })

  it('rate-limit: GitHub limited the requests', () => {
    expect(notice('rate-limit')).toMatch(/лимит/)
  })

  it('network: GitHub is not answering', () => {
    expect(notice('network')).toMatch(/GitHub сейчас не отвечает/)
  })
})
