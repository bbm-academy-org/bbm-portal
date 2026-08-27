// FIXTURE — guard-test data, not shipped code. A gated cabinet handler.
import { adminRoute } from '@/lib/platform/api'
import { okrParametersSchema } from '@/lib/okr/contract'
export const GET = adminRoute({ output: okrParametersSchema, handler: async () => ({}) })
