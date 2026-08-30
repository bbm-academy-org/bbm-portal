import type { RouteSegment } from '@/lib/platform/api'

import { collectionRoute } from '../references'

export const GET = (request: Request, segment?: RouteSegment) =>
  collectionRoute('GET', request, segment)
export const POST = (request: Request, segment?: RouteSegment) =>
  collectionRoute('POST', request, segment)
