import { RequestsShell } from './RequestsShell'

/**
 * `/p/finance/requests` — the expense-request board (spec 339 §C, issue #388).
 *
 * The route is a thin mount: the claim gate that matters is the module's own,
 * re-checked by every handler behind `/p/finance/api/**` (EARS-501/502/523), and
 * the board renders whatever that gate answers — including the refusal.
 */
export const dynamic = 'force-dynamic'

export default function RequestsPage() {
  return <RequestsShell />
}
