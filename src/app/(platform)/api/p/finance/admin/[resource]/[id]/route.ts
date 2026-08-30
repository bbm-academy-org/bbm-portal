import type { RouteSegment } from '@/lib/platform/api'

import { itemRoute } from '../../references'

export const GET = (request: Request, segment?: RouteSegment) => itemRoute('GET', request, segment)
export const PATCH = (request: Request, segment?: RouteSegment) =>
  itemRoute('PATCH', request, segment)
export const DELETE = (request: Request, segment?: RouteSegment) =>
  itemRoute('DELETE', request, segment)
