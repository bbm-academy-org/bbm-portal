// FIXTURE — guard-test data, not shipped code. A gated member-facing handler.
import { memberRoute } from '@/lib/platform/api'
import { periodSchema } from '@/lib/hours/contract'
export const GET = memberRoute({ output: periodSchema, handler: async () => [] })
