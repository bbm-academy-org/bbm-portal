// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FinanceDocumentUploadPending } from '@/lib/finance'
import { PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

const routeState = vi.hoisted(() => ({
  read: vi.fn(),
  session: null as unknown,
  resume: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: async () => routeState.session }))
vi.mock('@/lib/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance')>()
  return {
    ...actual,
    readFinanceDocument: routeState.read,
    resumeFinanceDocumentUpload: routeState.resume,
    uploadFinanceDocument: routeState.upload,
  }
})

const URL = 'http://portal.test/p/finance/api/documents'

beforeEach(() => {
  routeState.session = {
    user: {
      email: 'entry@bbm.academy',
      roles: [PLATFORM_USER_ROLE, 'finance-entry'],
    },
  }
  routeState.resume.mockReset().mockResolvedValue({
    id: 17,
    filename: 'invoice.pdf',
    mime: 'application/pdf',
    size: 20,
    kind: 'ru_invoice',
    uploadedAt: new Date('2026-08-28T00:00:00Z'),
  })
  routeState.read.mockReset().mockResolvedValue({
    id: 17,
    filename: 'invoice.pdf',
    mime: 'application/pdf',
    size: 999,
    kind: 'ru_invoice',
    uploadedBy: 1,
    uploadedAt: new Date('2026-08-28T00:00:00Z'),
    bytes: Buffer.from('%PDF-1.7\nfixture'),
  })
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

async function resume(id: string, bytes = Buffer.from('%PDF-1.7\nfixture')): Promise<Response> {
  const route = await import('@/app/(platform)/p/finance/api/documents/[id]/route')
  return route.PUT(new Request(`${URL}/${id}`, { method: 'PUT', body: bytes }), {
    params: Promise.resolve({ id }),
  })
}

async function read(id: string, query = ''): Promise<Response> {
  const route = await import('@/app/(platform)/p/finance/api/documents/[id]/route')
  return route.GET(new Request(`${URL}/${id}${query}`), { params: Promise.resolve({ id }) })
}

function validForm(bytes: Uint8Array = Buffer.from('%PDF-1.7\nfixture')): FormData {
  const form = new FormData()
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  form.set('file', new File([body], 'invoice.pdf', { type: 'application/pdf' }))
  form.set('kind', 'ru_invoice')
  form.set('intakeItemId', '1')
  return form
}

describe('finance document upload trust boundary (spec 339 EARS-514)', () => {
  it('EARS-514: a valid multipart upload reaches the module and returns only the public document contract', async () => {
    const response = await post(validForm())

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(routeState.upload).toHaveBeenCalledWith(
      {
        email: 'entry@bbm.academy',
        roles: [PLATFORM_USER_ROLE, 'finance-entry'],
      },
      {
        filename: 'invoice.pdf',
        mime: 'application/pdf',
        bytes: expect.any(Buffer),
        kind: 'ru_invoice',
        intakeItemIds: [1],
      },
    )
    const body = await response.json()
    expect(body).toEqual({
      id: 1,
      filename: 'invoice.pdf',
      mime: 'application/pdf',
      size: 20,
      kind: 'ru_invoice',
      uploadedAt: '2026-08-28T00:00:00.000Z',
    })
    expect(JSON.stringify(body)).not.toMatch(/storage|bucket|key/i)
  })

  it('EARS-514: a partial upload response exposes a stable id and authenticated recovery address', async () => {
    routeState.upload.mockRejectedValue(new FinanceDocumentUploadPending(17))

    const response = await post(validForm())

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toEqual({
      id: 17,
      uploadStatus: 'pending',
      recovery: {
        method: 'PUT',
        href: '/p/finance/api/documents/17',
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/storageKey|bucket/i)
  })

  it('EARS-514: PUT retries a pending upload through the module and returns no raw storage internals', async () => {
    const response = await resume('17')

    expect(response.status).toBe(200)
    expect(routeState.resume).toHaveBeenCalledWith(
      {
        email: 'entry@bbm.academy',
        roles: [PLATFORM_USER_ROLE, 'finance-entry'],
      },
      17,
      expect.any(Buffer),
    )
    const body = await response.json()
    expect(body).toEqual({
      id: 17,
      filename: 'invoice.pdf',
      mime: 'application/pdf',
      size: 20,
      kind: 'ru_invoice',
      uploadedAt: '2026-08-28T00:00:00.000Z',
    })
    expect(JSON.stringify(body)).not.toMatch(/storage|bucket|key/i)
  })

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
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(26 * 1024 * 1024))
        controller.close()
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
    expect(routeState.upload).not.toHaveBeenCalled()
  })

  it('EARS-514: a rebuilt bounded multipart request keeps content type but drops caller framing headers', async () => {
    const form = validForm()
    const original = new Request(URL, { method: 'POST', body: form })
    const bytes = Buffer.from(await original.arrayBuffer())
    const request = new Request(URL, {
      method: 'POST',
      headers: {
        'content-type': original.headers.get('content-type')!,
        'content-length': '1',
        'transfer-encoding': 'chunked',
      },
      body: bytes,
    })
    const NativeRequest = globalThis.Request
    let rebuiltHeaders: Headers | null = null
    class CapturingRequest extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init)
        if (init?.body !== undefined) rebuiltHeaders = new Headers(init.headers)
      }
    }
    vi.stubGlobal('Request', CapturingRequest)

    try {
      const route = await import('@/app/(platform)/p/finance/api/documents/route')
      const response = await route.POST(request)

      expect(response.status).toBe(201)
      const captured = rebuiltHeaders as Headers | null
      expect(captured?.get('content-type')).toBe(original.headers.get('content-type'))
      expect(captured?.has('content-length')).toBe(false)
      expect(captured?.has('transfer-encoding')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('EARS-514: refuses unknown multipart parts instead of silently buffering and ignoring them', async () => {
    const form = validForm()
    form.set('ignored', 'x')

    const response = await post(form)

    expect(response.status).toBe(400)
    expect(routeState.upload).not.toHaveBeenCalled()
  })
})

describe('finance document read response (spec 339 EARS-523)', () => {
  it('uses the byte count actually read from storage for content-length', async () => {
    const response = await read('17')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(
      String(Buffer.from('%PDF-1.7\nfixture').byteLength),
    )
  })

  it('keeps direct reads as safe downloads and permits authenticated inline PDF reading explicitly', async () => {
    routeState.read.mockResolvedValue({
      id: 17,
      filename: "owner's Q3 (final).pdf",
      mime: 'application/pdf',
      size: 999,
      kind: 'ru_invoice',
      uploadedBy: 1,
      uploadedAt: new Date('2026-08-28T00:00:00Z'),
      bytes: Buffer.from('%PDF-1.7\nfixture'),
    })

    const download = await read('17')
    const inline = await read('17', '?disposition=inline')

    expect(download.headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''owner%27s%20Q3%20%28final%29.pdf",
    )
    expect(inline.headers.get('content-disposition')).toBe(
      "inline; filename*=UTF-8''owner%27s%20Q3%20%28final%29.pdf",
    )
    expect(routeState.read).toHaveBeenCalledTimes(2)
  })

  it('does not turn non-PDF documents inline even when the flag is supplied', async () => {
    routeState.read.mockResolvedValue({
      id: 18,
      filename: 'receipt.png',
      mime: 'image/png',
      size: 4,
      kind: 'bank_screenshot',
      uploadedBy: 1,
      uploadedAt: new Date('2026-08-28T00:00:00Z'),
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    })

    const response = await read('18', '?disposition=inline')

    expect(response.headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''receipt.png",
    )
  })
})
