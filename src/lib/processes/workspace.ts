import type { WorkspaceModule } from '@/lib/workspace/contract'

/**
 * The processes workspace declaration (spec 311 EARS-401, spec 553 EARS-601):
 * a launcher tile and a switcher entry for `/p/processes`. Read-only surface
 * over models mastered in other repos — no pulse and no cabinet section
 * (a model is edited by a PR to its repo, not here).
 */
export const processesWorkspaceEntry: WorkspaceModule = {
  kind: 'internal',
  slug: 'processes',
  name: 'Процессы',
  description: 'Модели процессов: схемы, роли, шаги',
  href: '/p/processes',
  icon: 'processes',
}
