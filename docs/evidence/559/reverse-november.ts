/* #559 evidence, second pass: reverse the stand's November §J operations so «Этот месяц» is an empty period. */
import {
  reverseOperation,
  FINANCE_APPROVE_ROLE,
  FINANCE_ENTRY_ROLE,
  type FinanceActor,
} from '@/lib/finance'
import { marketChainFacts, marketIntakeFacts } from '@/lib/finance/market-facts'
import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'
import { closePlatformDb } from '@/lib/platform/db/client'
import { assertDevPlatformDatabase } from '../../../tools/platform/dev-database-guard.mjs'
import { DEV_SEED_MEMBERS } from '../../../tools/platform/dev-seed-plan'
import { loadPlatformToolEnv } from '../../../tools/platform/load-env.mjs'
async function main() {
  loadPlatformToolEnv()
  assertDevPlatformDatabase(process.env.PLATFORM_DATABASE_URL, process.env)
  const actor: FinanceActor = {
    email: DEV_SEED_MEMBERS.find((m) => m.slug === 'seed-member-02')!.email,
    roles: [PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE, FINANCE_APPROVE_ROLE, FINANCE_ENTRY_ROLE],
  }
  const period = { from: '2026-11-01' }
  const ids = new Set<number>()
  for (const f of await marketIntakeFacts({ period }))
    if (f.operationId !== null && !f.operationReversed) ids.add(f.operationId)
  for (const f of await marketChainFacts({ period })) ids.add(f.operationId)
  for (const id of [...ids].sort((a, b) => b - a)) {
    await reverseOperation(actor, id)
    console.log('reversed', id)
  }
  await closePlatformDb()
}
void main()
