import type { WorkspaceModule } from '@/lib/workspace/contract'

/**
 * The path map's workspace declaration (spec 311 EARS-401): a launcher tile and
 * a switcher entry for `/p/path` (#530). Read-only surface over a committed
 * file — no pulse (nothing changes between deploys that a tile could report)
 * and no cabinet section (editing is editing the file).
 */
export const pathMapWorkspaceEntry: WorkspaceModule = {
  kind: 'internal',
  slug: 'path',
  name: 'Карта пути',
  description: 'Дорога к маяку Doctor.School',
  href: '/p/path',
  icon: 'path',
}
