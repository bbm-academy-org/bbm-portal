// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

const routeState = vi.hoisted(() => ({
  session: null as unknown,
  upload: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: async () => routeState.session }))
vi.mock('@/lib/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance')>()
  return { ...actual, uploadFinanceDocument: routeState.upload }
})

const URL = 'http://portal.test/p/finance/api/documents'

beforeEach(() => {
  routeState.session = {
    user: {
      email: 'entry@bbm.academy',
      roles: [PLATFORM_USER_ROLE, 'finance-entry'],
    },
  }
  routeState.upload.mockReset().mockResolvedValue({
    id: 1,
    filename: 'invoice.pdf',
    mime: 'application/pdf',
    size: 20,
    kind: 'ru_invoice',
    uploadedAt: new Date('2026-08-28T00:00:00Z'),
  })
})

async function post(form: FormData): Promise<Response> {
  const route = await import('@/app/(platform)/p/finance/api/documents/route')
  return route.POST(new Request(URL, { method: 'POST', body: form }))
}

function validForm(bytes: Uint8Array = Buffer.from('%PDF-1.7\nfixture')): FormData {
  const form = new FormData()
  form.set('file', new File([bytes], 'invoice.pdf', { type: 'application/pdf' }))
  form.set('kind', 'ru_invoice')
  form.set('intakeItemId', '1')
  return form
}

describe('finance document upload trust boundary (spec 339 EARS-514)', () => {
  it('EARS-514: refuses declared PDF content whose bytes are not a PDF', async () => {
    const response = await post(validForm(Buffer.from('<script>alert(1)</script>')))

    expect(response.status).toBe(422)
    expect(routeState.upload).not.toHaveBeenCalled()
  })

  it('EARS-514: refuses a filename whose extension contradicts the detected format', async () => {
    const form = validForm()
    form.set(
      'file',
      new File([Buffer.from('%PDF-1.7\nfixture')], 'invoice.exe', { type: 'application/pdf' }),
    )

    const response = await post(form)

    expect(response.status).toBe(422)
    expect(routeState.upload).not.toHaveBeenCalled()
  })

  it('EARS-514: bounds the raw multipart stream before formData buffers the whole request', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls === 1) {
          controller.enqueue(new Uint8Array(26 * 1024 * 1024))
          return
        }
        throw new Error('the route read beyond its bound')
      },
    })
    const request = new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=bounded' },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    const route = await import('@/app/(platform)/p/finance/api/documents/route')

    const response = await route.POST(request)

    expect(response.status).toBe(413)
    expect(pulls).toBe(1)
    expect(routeState.upload).not.toHaveBeenCalled()
  })

  it('EARS-514: refuses unknown multipart parts instead of silently buffering and ignoring them', async () => {
    const form = validForm()
    form.set('ignored', 'x')

    const response = await post(form)

    expect(response.status).toBe(400)
    expect(routeState.upload).not.toHaveBeenCalled()
  })
})
