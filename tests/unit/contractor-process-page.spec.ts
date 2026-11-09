import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { ContractorProcessLoad } from '@/lib/contractor-process'

/**
 * `/p/finance/contractor-process` (#545): a thin mount over what
 * `getContractorProcess` read. Pinned here: it renders per request (the
 * (platform) cache gate — an invalid file shows its errors instead of failing
 * the build), the public example is drawn with the «показан пример» notice,
 * and each failure has its OWN readable Russian state — a stale copy is drawn
 * with «данные могли устареть», a failed read names the source and never
 * shows the shared client's «карта» wording, invalid data lists its field
 * errors. `getContractorProcess` is mocked per case; the first case uses the
 * real one (no token in the test env → the local example).
 */

const loadMock = vi.hoisted(() => vi.fn<() => Promise<ContractorProcessLoad> | undefined>())

vi.mock('@/lib/contractor-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/contractor-process')>()
  return {
    ...actual,
    getContractorProcess: (...args: Parameters<typeof actual.getContractorProcess>) =>
      loadMock() ?? actual.getContractorProcess(...args),
  }
})

async function render() {
  const page = await import('@/app/(platform)/p/finance/contractor-process/page')
  return renderToStaticMarkup(await page.default())
}

const base = {
  file: 'bbm-academy-org/path-maps · processes/contractors.json',
  origin: { kind: 'github', repo: 'bbm-academy-org/path-maps', path: 'processes/contractors.json' },
  asOf: '2026-11-09T12:30:00.000Z',
} as const

describe('/p/finance/contractor-process page', () => {
  it('opts out of static/route caching', async () => {
    const page = await import('@/app/(platform)/p/finance/contractor-process/page')
    expect(page.dynamic).toBe('force-dynamic')
  })

  it('draws the public example with the «показан пример» notice when there is no token', async () => {
    loadMock.mockReturnValueOnce(undefined)
    const html = await render()
    expect(html).toContain('Как работаем с исполнителями')
    expect(html).toContain('Показан пример')
    expect(html).toContain('data-cp-notice="example"')
    // The diagram is laid out on the client: the server sends its placeholder.
    expect(html).toContain('Схема рисуется')
    expect(html).not.toContain('data-cp-error')
  })

  it('draws a stale copy with «данные могли устареть» and the cause', async () => {
    loadMock.mockReturnValueOnce(
      (async () => {
        const { getContractorProcess } = await vi.importActual<
          typeof import('@/lib/contractor-process')
        >('@/lib/contractor-process')
        const local = await getContractorProcess({ env: {} })
        return { ...local, ...base, stale: true, staleReason: 'rate-limit' as const }
      })(),
    )
    const html = await render()
    expect(html).toContain('Данные могли устареть')
    expect(html).toContain('превышен лимит запросов к GitHub')
    expect(html).toContain('15:30')
    expect(html).toContain('Схема рисуется')
  })

  it('says what went wrong on a failed read, names the source, and never says «карта»', async () => {
    loadMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        errors: ['нет доступа к репозиторию карт'],
        failure: { kind: 'read', reason: 'auth', message: 'нет доступа к репозиторию карт' },
        stale: false,
        ...base,
      }),
    )
    const html = await render()
    expect(html).toContain('data-cp-error="read"')
    expect(html).toContain('Нет доступа к репозиторию path-maps')
    expect(html).toContain('bbm-academy-org/path-maps · processes/contractors.json')
    expect(html).not.toMatch(/карт/i)
    expect(html).not.toContain('Схема рисуется')
  })

  it('a path that is not a readable file says so, and does not send the operator to the env', async () => {
    loadMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        errors: ['не файл'],
        failure: { kind: 'read', reason: 'not-a-file', message: 'не файл' },
        stale: false,
        ...base,
      }),
    )
    const html = await render()
    expect(html).toContain('data-cp-error="read"')
    expect(html).toContain('По пути процесса в GitHub не файл')
    expect(html).toContain('больше 1 МБ')
    expect(html).not.toContain('PATH_MAPS_REPO')
    expect(html).not.toContain('PATH_MAPS_BRANCH')
    expect(html).not.toMatch(/карт/i)
  })

  it('a failed read of the local example is not also announced as «показан пример»', async () => {
    loadMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        errors: ['файл процесса не найден: content/finance/contractor-process.example.json'],
        failure: {
          kind: 'read',
          reason: 'local',
          message: 'файл процесса не найден: content/finance/contractor-process.example.json',
        },
        stale: false,
        file: 'content/finance/contractor-process.example.json',
        origin: { kind: 'local', path: 'content/finance/contractor-process.example.json' },
        asOf: base.asOf,
      }),
    )
    const html = await render()
    expect(html).toContain('Пример процесса не прочитан')
    expect(html).not.toContain('Показан пример')
    expect(html).not.toContain('data-cp-notice="example"')
    expect(html).not.toContain('Схема рисуется')
  })

  it('lists the field errors of an invalid file', async () => {
    loadMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        errors: ['steps[2].lane: дорожки «l9» нет в lanes'],
        failure: { kind: 'parse' },
        stale: false,
        ...base,
      }),
    )
    const html = await render()
    expect(html).toContain('data-cp-error="parse"')
    expect(html).toContain('В файле процесса ошибки')
    expect(html).toContain('steps[2].lane: дорожки «l9» нет в lanes')
    expect(html).not.toContain('Схема рисуется')
  })
})
