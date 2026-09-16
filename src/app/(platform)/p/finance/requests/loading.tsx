import { RequestsSkeleton } from './RequestsSkeleton'

/**
 * The route-level grey frame. It can only promise the DEFAULT view — a server
 * has no `localStorage` to ask which one this browser last chose — and since
 * decision 35 (Антон, 2026-09-14) the default is the TABLE. Promising the
 * kanban here made the route paint four grey columns and then swap the whole
 * layout (#388 defect C).
 */
export default function RequestsLoading() {
  return <RequestsSkeleton view="table" />
}
