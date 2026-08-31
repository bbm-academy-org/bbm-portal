import type { HttpError } from '@refinedev/core'
import type { z } from 'zod'

import { errorEnvelopeSchema, listEnvelopeSchema, oneEnvelopeSchema } from '../api/contract'

export const MODULE_API_ROOT = '/api/p'

export type CabinetEnvelopeKind = 'list' | 'one'

export type CabinetValidationResult =
  { success: true; data: unknown } | { success: false; issues: string }

export type CabinetResponseValidator = (
  resource: string,
  envelope: CabinetEnvelopeKind,
  payload: unknown,
) => Promise<CabinetValidationResult>

export interface ModuleApiClientOptions {
  validateResponse: CabinetResponseValidator
  fetchImpl?: typeof fetch
  apiRoot?: string
}

interface ModuleApiRequest {
  resource: string
  path: string
  init?: RequestInit
}

function httpError(statusCode: number, message: string): HttpError {
  return { statusCode, message }
}

function requestUrl(apiRoot: string, path: string): string {
  return `${apiRoot.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function refusalMessage(payload: unknown, resource: string, status: number): string {
  const parsed = errorEnvelopeSchema.safeParse(payload)
  if (parsed.success) return parsed.data.error.message
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = payload.error
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const message = error.message
      if (typeof message === 'string' && message.trim()) return message
    }
  }
  return `Запрос к «${resource}» отклонён (HTTP ${status}).`
}

export function createSchemaResponseValidator(schema: z.ZodType): CabinetResponseValidator {
  return async (_resource, envelope, payload) => {
    const parsed = (
      envelope === 'list' ? listEnvelopeSchema(schema) : oneEnvelopeSchema(schema)
    ).safeParse(payload)
    if (parsed.success) return { success: true, data: parsed.data }
    return {
      success: false,
      issues: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'response'}: ${issue.message}`)
        .join('; '),
    }
  }
}

export function createModuleApiClient(options: ModuleApiClientOptions) {
  const apiRoot = options.apiRoot ?? MODULE_API_ROOT
  const doFetch: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args))

  async function call(request: ModuleApiRequest, envelope: CabinetEnvelopeKind): Promise<unknown> {
    const response = await doFetch(requestUrl(apiRoot, request.path), {
      ...request.init,
      headers: {
        accept: 'application/json',
        ...(request.init?.body ? { 'content-type': 'application/json' } : {}),
        ...request.init?.headers,
      },
    })

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }

    if (!response.ok) {
      throw httpError(response.status, refusalMessage(payload, request.resource, response.status))
    }

    const parsed = await options.validateResponse(request.resource, envelope, payload)
    if (!parsed.success) {
      throw httpError(
        500,
        `Ответ «${request.resource}» не соответствует схеме модуля: ${parsed.issues}`,
      )
    }
    return parsed.data
  }

  return {
    async list<T>(request: ModuleApiRequest): Promise<{ data: T[]; total: number }> {
      return (await call(request, 'list')) as { data: T[]; total: number }
    },

    async one<T>(request: ModuleApiRequest): Promise<T> {
      const envelope = (await call(request, 'one')) as { data: T }
      return envelope.data
    },
  }
}
