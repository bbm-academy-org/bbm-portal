import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readCached } from '@/lib/path-map/cache'
import type { EditCommand } from '@/lib/path-map/edit'
import {
  githubPathMapSource,
  localPathMapSource,
  PathMapConflictError,
  PathMapSourceError,
  pathMapSourceFromEnv,
  resetPathMapCache,
} from '@/lib/path-map'
import {
  commitMessage,
  editAvailability,
  runPathMapEdit,
  savePathMapEdit,
} from '@/lib/path-map/save'

/**
 * «Карта пути» v2, task D (#539) — the write path: `GithubPathMapSource.write()`
 * (contents API PUT, a stale sha is a typed conflict and never forced), the
 * save that re-reads, checks the base sha, applies the command and commits with
 * the member's name, and the gate in front of it. Every GitHub response is a
 * mocked `fetch` — no network.
 */

const repoRoot = join(import.meta.dirname, '..', '..')
const example = readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8')
  .split('\r\n')
  .join('\n')

const TOKEN = 'github_pat_test_SECRET_value_never_logged'
const CONFIG = { token: TOKEN, repo: 'bbm-academy-org/path-maps', path: 'maps/doctor-school.yaml' }

function contentsResponse(text: string, sha: string) {
  return new Response(
    JSON.stringify({
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(text, 'utf8').toString('base64'),
      sha,
    }),
    { status: 200 },
  )
}

function putResponse(sha: string) {
  return new Response(JSON.stringify({ content: { sha }, commit: { sha: 'commit-1' } }), {
    status: 200,
  })
}

const member = { user: { name: 'Антон Сидоров', email: 'a@bbm.academy', roles: ['platform-user'] } }

beforeEach(() => {
  resetPathMapCache()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('githubPathMapSource.write', () => {
  it('PUTs base64 content with the sha, message and branch', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => putResponse('sha-2'))
    const source = githubPathMapSource({ ...CONFIG, branch: 'scratch' }, fetchMock)
    await expect(source.write('title: x\n', 'sha-1', 'msg')).resolves.toEqual({
      sha: 'sha-2',
      commit: 'commit-1',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.github.com/repos/bbm-academy-org/path-maps/contents/maps/doctor-school.yaml',
    )
    expect(init?.method).toBe('PUT')
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({
      message: 'msg',
      content: Buffer.from('title: x\n').toString('base64'),
      sha: 'sha-1',
      branch: 'scratch',
    })
  })

  it.each([409, 422])('turns a %i into a typed conflict, never a retry', async (status) => {
    const fetchMock = vi.fn(async () => new Response('{}', { status }))
    const source = githubPathMapSource(CONFIG, fetchMock)
    const error = await source.write('x', 'old', 'msg').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PathMapConflictError)
    expect((error as PathMapConflictError).reason).toBe('stale')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a missing write permission without the token', async () => {
    const source = githubPathMapSource(CONFIG, async () => new Response('{}', { status: 403 }))
    const error = (await source.write('x', 'sha', 'm').catch((e: unknown) => e)) as Error
    expect(error).toBeInstanceOf(PathMapSourceError)
    expect(error.message).toMatch(/нет прав на запись/)
    expect(error.message).not.toContain(TOKEN)
  })
})

describe('commitMessage', () => {
  it('names the member, the action and the page; strips line breaks', () => {
    expect(commitMessage('Антон\nСидоров', 'добавить станцию «X»')).toBe(
      'Антон Сидоров: добавить станцию «X» (/p/path)',
    )
  })

  it('flattens the WHOLE message — a title cannot add forged trailers (#541 review)', () => {
    const message = commitMessage(
      'Антон',
      'добавить станцию «X\n\nCo-authored-by: Mallory <m@evil.example>\r\nSigned-off-by: M»',
    )
    expect(message).not.toMatch(/[\r\n]/)
    expect(message).toBe(
      'Антон: добавить станцию «X Co-authored-by: Mallory <m@evil.example> Signed-off-by: M» (/p/path)',
    )
  })

  it('caps the message at 200 characters and keeps the page suffix', () => {
    const message = commitMessage('Антон', `изменить станцию «${'а'.repeat(400)}»`)
    expect(message.length).toBeLessThanOrEqual(200)
    expect(message.endsWith('… (/p/path)')).toBe(true)
    expect(message.startsWith('Антон: изменить станцию «ааа')).toBe(true)
  })
})

describe('editAvailability', () => {
  it('is on only for the live map with a known version, and always says why it is off', () => {
    expect(editAvailability({ origin: 'github', sha: 'sha-1' })).toEqual({ enabled: true })
    expect(editAvailability({ origin: 'local', sha: null })).toEqual({
      enabled: false,
      reason: 'редактирование доступно только для живой карты',
    })
    expect(editAvailability({ origin: 'misconfigured', sha: null }).enabled).toBe(false)
    const unknownVersion = editAvailability({ origin: 'github', sha: null })
    expect(unknownVersion.enabled).toBe(false)
    expect(unknownVersion.reason).toMatch(/версия файла карты неизвестна/)
  })
})

describe('savePathMapEdit', () => {
  const command = { op: 'beacon.update', title: 'Новый маяк', why: 'зачем' } as const

  it('re-reads, applies, commits with the member name and primes the cache', async () => {
    const calls: Array<{ method: string; body?: string }> = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body as string | undefined })
      return init?.method === 'PUT' ? putResponse('sha-2') : contentsResponse(example, 'sha-1')
    })
    const source = githubPathMapSource(CONFIG, fetchMock)
    const outcome = await savePathMapEdit({ source, command, baseSha: 'sha-1', actor: 'Антон' })
    expect(outcome).toEqual({
      status: 'ok',
      sha: 'sha-2',
      commit: 'commit-1',
      summary: 'изменить маяк «Новый маяк»',
    })
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT'])
    const put = JSON.parse(calls[1].body!)
    expect(put.message).toBe('Антон: изменить маяк «Новый маяк» (/p/path)')
    expect(put.sha).toBe('sha-1')
    const written = Buffer.from(put.content, 'base64').toString('utf8')
    expect(written).toContain("title: 'Новый маяк'")

    // The next page read is the write itself — no GET.
    const cached = await readCached(source, new Date())
    expect(cached.doc).toMatchObject({ sha: 'sha-2', content: written })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses when the file changed since the member loaded it', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(example, 'sha-9'))
    const source = githubPathMapSource(CONFIG, fetchMock)
    await expect(
      savePathMapEdit({ source, command, baseSha: 'sha-1', actor: 'Антон' }),
    ).resolves.toEqual({ status: 'stale' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // «Перечитать» must show the newer file at once, not the cached copy the
    // member already had for up to a TTL: the fresh read is put in the cache.
    const cached = await readCached(source, new Date())
    expect(cached.doc.sha).toBe('sha-9')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps a conflict on the PUT itself to stale and drops the cached copy', async () => {
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response('{}', { status: 409 })
        : contentsResponse(example, 'sha-1'),
    )
    const source = githubPathMapSource(CONFIG, fetchMock)
    await readCached(source, new Date())
    await expect(
      savePathMapEdit({ source, command, baseSha: 'sha-1', actor: 'Антон' }),
    ).resolves.toEqual({ status: 'stale' })
    const before = fetchMock.mock.calls.length
    await readCached(source, new Date())
    expect(fetchMock.mock.calls.length).toBe(before + 1)
  })

  describe('GitHub returning an older version than our own write (#541 review)', () => {
    /** One successful save through the portal: GitHub had sha-1, our PUT made sha-2. */
    async function ownWrite() {
      const source = githubPathMapSource(CONFIG, async (_u, init) =>
        init?.method === 'PUT' ? putResponse('sha-2') : contentsResponse(example, 'sha-1'),
      )
      const outcome = await savePathMapEdit({ source, command, baseSha: 'sha-1', actor: 'А' })
      expect(outcome).toMatchObject({ status: 'ok', sha: 'sha-2' })
      return (await readCached(source, new Date())).doc.content
    }

    it('edits on top of our own write while GitHub still returns its parent', async () => {
      const written = await ownWrite()
      const calls: Array<{ method: string; body?: string }> = []
      const source = githubPathMapSource(CONFIG, async (_u, init) => {
        calls.push({ method: init?.method ?? 'GET', body: init?.body as string | undefined })
        // GitHub lags: the read still returns sha-1, the version our write replaced.
        return init?.method === 'PUT' ? putResponse('sha-3') : contentsResponse(example, 'sha-1')
      })
      const second: EditCommand = {
        op: 'task.add',
        nodeId: 'studio',
        parent: [],
        fields: { title: 'Сдать студию' },
      }
      const outcome = await savePathMapEdit({
        source,
        command: second,
        baseSha: 'sha-2',
        actor: 'А',
      })
      expect(outcome).toMatchObject({ status: 'ok', sha: 'sha-3' })
      const put = JSON.parse(calls[1].body!)
      // The PUT goes on top of OUR write (sha-2), built from our written text.
      expect(put.sha).toBe('sha-2')
      const text = Buffer.from(put.content, 'base64').toString('utf8')
      expect(written).toContain("title: 'Новый маяк'")
      expect(text).toContain("title: 'Новый маяк'")
      expect(text).toContain('- title: Сдать студию')
    })

    it('still returns stale when the PUT on top of our own write conflicts', async () => {
      await ownWrite()
      const source = githubPathMapSource(CONFIG, async (_u, init) =>
        init?.method === 'PUT'
          ? new Response('{}', { status: 409 })
          : contentsResponse(example, 'sha-1'),
      )
      await expect(
        savePathMapEdit({ source, command, baseSha: 'sha-2', actor: 'А' }),
      ).resolves.toEqual({ status: 'stale' })
    })

    it('does not trust a cached READ whose sha is the base — only our own write', async () => {
      const fetchMock = vi.fn(async (_u: string, init?: RequestInit) =>
        init?.method === 'PUT' ? putResponse('sha-x') : contentsResponse(example, 'sha-1'),
      )
      const source = githubPathMapSource(CONFIG, fetchMock)
      // The page was drawn from a cached read with sha-1 …
      await readCached(source, new Date())
      // … and GitHub now has sha-9: the member's base is genuinely stale.
      fetchMock.mockImplementation(async () => contentsResponse(example, 'sha-9'))
      await expect(
        savePathMapEdit({ source, command, baseSha: 'sha-1', actor: 'А' }),
      ).resolves.toEqual({ status: 'stale' })
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    })

    it('a stale save does not roll the cache back from our write to its parent', async () => {
      await ownWrite()
      const source = githubPathMapSource(CONFIG, async () => contentsResponse(example, 'sha-1'))
      // A member still on sha-0 saves while GitHub lags at sha-1.
      await expect(
        savePathMapEdit({ source, command, baseSha: 'sha-0', actor: 'А' }),
      ).resolves.toEqual({ status: 'stale' })
      expect((await readCached(source, new Date())).doc.sha).toBe('sha-2')
    })

    it('a cache refresh that returns the parent of our write keeps our write', async () => {
      await ownWrite()
      const source = githubPathMapSource(CONFIG, async () => contentsResponse(example, 'sha-1'))
      const later = new Date(Date.now() + 120_000)
      expect((await readCached(source, later)).doc.sha).toBe('sha-2')
    })
  })

  it('returns the edit errors and writes nothing for an invalid command result', async () => {
    const fetchMock = vi.fn(async () => contentsResponse(example, 'sha-1'))
    const source = githubPathMapSource(CONFIG, fetchMock)
    const outcome = await savePathMapEdit({
      source,
      command: { op: 'node.remove', nodeId: 'nope' },
      baseSha: 'sha-1',
      actor: 'Антон',
    })
    expect(outcome.status).toBe('invalid')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is disabled for the local example and a misconfigured source', async () => {
    const disabled = {
      status: 'disabled',
      reason: 'редактирование доступно только для живой карты',
    }
    await expect(
      savePathMapEdit({ source: localPathMapSource(repoRoot), command, baseSha: 'x', actor: 'a' }),
    ).resolves.toEqual(disabled)
    const misconfigured = pathMapSourceFromEnv({
      PATH_MAPS_GITHUB_TOKEN: 't',
      PATH_MAPS_REPO: 'bad',
    })
    await expect(
      savePathMapEdit({ source: misconfigured, command, baseSha: 'x', actor: 'a' }),
    ).resolves.toEqual(disabled)
  })
})

describe('runPathMapEdit — the gate in front of the save', () => {
  const okSource = () =>
    githubPathMapSource(CONFIG, async (_u, init) =>
      init?.method === 'PUT' ? putResponse('sha-2') : contentsResponse(example, 'sha-1'),
    )
  const input = { command: { op: 'beacon.update', title: 'Маяк' }, baseSha: 'sha-1' }

  it('refuses a missing session and a session without platform-user', async () => {
    const source = okSource()
    const write = vi.spyOn(source, 'write')
    for (const session of [null, { user: { name: 'x', roles: [] } }]) {
      await expect(runPathMapEdit({ session, input, source })).resolves.toEqual({
        status: 'forbidden',
        message: 'Нет доступа к правке карты — войдите заново',
      })
    }
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects a malformed request before reading anything', async () => {
    const source = okSource()
    const read = vi.spyOn(source, 'read')
    const outcome = await runPathMapEdit({
      session: member,
      input: { command: { op: 'drop' }, baseSha: 'sha-1' },
      source,
    })
    expect(outcome.status).toBe('invalid')
    expect(read).not.toHaveBeenCalled()
  })

  it('saves with the display name, falling back to the email', async () => {
    const source = okSource()
    const write = vi.spyOn(source, 'write')
    await expect(runPathMapEdit({ session: member, input, source })).resolves.toMatchObject({
      status: 'ok',
      sha: 'sha-2',
    })
    expect(write.mock.calls[0][2]).toBe('Антон Сидоров: изменить маяк «Маяк» (/p/path)')

    const noName = { user: { email: 'e@bbm.academy', roles: ['platform-user'] } }
    resetPathMapCache()
    await runPathMapEdit({ session: noName, input, source })
    expect(write.mock.calls[1][2]).toBe('e@bbm.academy: изменить маяк «Маяк» (/p/path)')
  })

  it('never puts the token into a result', async () => {
    const source = githubPathMapSource(CONFIG, async () => new Response('{}', { status: 500 }))
    const outcome = await runPathMapEdit({ session: member, input, source })
    expect(outcome.status).toBe('error')
    expect(JSON.stringify(outcome)).not.toContain(TOKEN)
  })
})
