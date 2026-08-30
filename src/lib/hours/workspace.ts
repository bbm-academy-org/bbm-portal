import type { WorkspaceModule } from '@/lib/workspace/contract'

import { hoursAdminSection } from './admin-contract'
import { findOpenPeriod } from './document'
import { readHoursDocument } from './store-core'

/**
 * The hours module's own workspace declaration (spec 311 EARS-401).
 *
 * A module says what it is and what it publishes; it does not know that a
 * launcher exists. The only file that has to change when this app's tile changes
 * is this one — plus the one array element in the composition root that
 * registers it (`src/lib/workspace/registry.ts`, EARS-402/403).
 *
 * It imports `@/lib/workspace/contract` and NOT the registry: a module that
 * could read the registry could read its neighbours (D-3, enforced by
 * `pnpm boundaries` rule `module-must-not-import-workspace-registry`).
 */

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

/**
 * «до какого дня период ещё открыт», from an INCLUSIVE last day.
 *
 * A period whose `date_to` is 31 August is open until 1 September — that is what
 * `design-source/p-launcher.html` draws («Период «август 2026» открыт до 1
 * сентября») and it is also simply what an inclusive end date means. Rendering
 * «до 31 августа» would be a different, wrong claim.
 */
export function openUntilLabel(dateToInclusive: string): string {
  const day = new Date(`${dateToInclusive}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + 1)
  return `${day.getUTCDate()} ${MONTHS_GENITIVE[day.getUTCMonth()]}`
}

/**
 * The module's pulse (EARS-406). No open period is a legitimate `null` — the
 * tile then renders in its static form, which is also what a storage failure
 * yields, because a member cannot act on the difference.
 */
export async function hoursStatusLine(): Promise<string | null> {
  const doc = await readHoursDocument()
  const open = findOpenPeriod(doc)
  if (!open) return null
  return `Период «${open.label}» открыт до ${openUntilLabel(open.date_to)}`
}

export const hoursWorkspaceEntry: WorkspaceModule = {
  kind: 'internal',
  slug: 'hours',
  name: 'Часы',
  description: 'Самооценка часов',
  href: '/p/hours',
  icon: 'hours',
  status: hoursStatusLine,
  admin: hoursAdminSection,
}
