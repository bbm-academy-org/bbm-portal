// Specifies the requests board's `custom`-only data provider
// (src/app/(platform)/p/finance/requests/request-board-provider.ts). The board
// writes JSON to the act endpoints and MULTIPART to the document endpoint
// (spec 339 EARS-514) through the same provider, so that both report through
// the one notification channel Refine gives `useCustomMutation`.
import { describe, expect, it, vi } from 'vitest'

import { createRequestBoardDataProvider } from '@/app/(platform)/p/finance/requests/request-board-provider'

function okFetch(body = '{}') {
  return vi.fn(async () => new Response(body, { status: 200 }))
}

describe('request board data provider (spec 339 §C)', () => {
  it('EARS-510: sends an act as JSON with the JSON content type', async () => {
    const fetchImpl = okFetch()
    const provider = createRequestBoardDataProvider(fetchImpl as unknown as typeof fetch)

    await provider.custom!({
      url: '/p/finance/api/requests/1/actions',
      method: 'post',
      payload: { act: 'approve' },
    })

    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(init.body).toBe('{"act":"approve"}')
  })

  it('EARS-514: sends a document upload as the multipart body itself, boundary untouched', async () => {
    const fetchImpl = okFetch('{"id":9}')
    const provider = createRequestBoardDataProvider(fetchImpl as unknown as typeof fetch)

    const form = new FormData()
    form.append('file', new File(['%PDF-1.4'], 'чек.pdf', { type: 'application/pdf' }))
    form.append('kind', 'fiscal_receipt')
    form.append('intakeItemId', '2')

    const answer = await provider.custom!({
      url: '/p/finance/api/documents',
      method: 'post',
      payload: form as unknown as Record<string, unknown>,
    })

    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(init.body).toBe(form)
    // Setting it ourselves would strip the boundary the browser writes.
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined()
    expect(answer.data).toEqual({ id: 9 })
  })

  it('EARS-514: carries the server refusal text through as the provider error', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('Файл больше предела (EARS-514).', { status: 413 }),
    )
    const provider = createRequestBoardDataProvider(fetchImpl as unknown as typeof fetch)

    await expect(
      provider.custom!({
        url: '/p/finance/api/documents',
        method: 'post',
        payload: new FormData(),
      }),
    ).rejects.toMatchObject({ statusCode: 413, message: 'Файл больше предела (EARS-514).' })
  })
})
