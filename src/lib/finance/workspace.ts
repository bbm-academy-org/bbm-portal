import type { InternalWorkspaceEntry } from '@/lib/workspace/contract'

import { financeAdminSection } from './contract'

/** Finance is readable by every platform member; only its references are admin-only. */
export const financeWorkspaceEntry: InternalWorkspaceEntry = {
  kind: 'internal',
  slug: 'finance',
  name: 'Финансы',
  description: 'Счета и деньги BBM',
  href: '/p/finance',
  icon: 'finance',
  admin: financeAdminSection,
}
