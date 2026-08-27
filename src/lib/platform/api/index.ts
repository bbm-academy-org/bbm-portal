/**
 * The workspace modules' HTTP frame — `/api/p/<slug>/*`.
 *
 * The one door a route handler under `src/app/(platform)/api/p/**` imports.
 * What lives behind it: the wire envelope and the error taxonomy
 * (`contract.ts`, pure zod — also imported by the cabinet's data provider in
 * the browser), and the two gated route factories (`moduleRoute.ts`, server
 * only: it reaches Auth.js).
 *
 * Spec 311 §D/§B, consolidation §5/§6.
 */
export {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  type ApiErrorCode,
  type ErrorEnvelope,
  errorEnvelopeSchema,
  type ListQuery,
  listEnvelopeSchema,
  listQuerySchema,
  ModuleApiError,
  oneEnvelopeSchema,
} from './contract'
export {
  adminRoute,
  memberRoute,
  type ModuleRouteContext,
  type ModuleRouteHandler,
  type ModuleRouteSpec,
  type RouteSegment,
} from './moduleRoute'
