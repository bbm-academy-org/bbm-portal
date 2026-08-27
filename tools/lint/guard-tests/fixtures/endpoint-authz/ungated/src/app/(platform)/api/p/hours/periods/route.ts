// FIXTURE — guard-test data, not shipped code. An ungated module handler.
import { listPeriods } from '@/lib/hours'
export async function GET() {
  return Response.json({ data: await listPeriods(), total: 0 })
}
