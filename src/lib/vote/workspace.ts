import { z } from 'zod'

import type { WorkspaceAdminSection, WorkspaceModule } from '@/lib/workspace/contract'

import { POLL_KINDS, POLL_STATUSES } from './rules'

/**
 * The vote module's workspace declaration (spec 311 EARS-401; #575): a
 * launcher tile and a switcher entry for `/p/vote`, and one cabinet resource,
 * «Голосования» under `/p/admin/vote/polls`. No pulse — a tile that says
 * «открыто голосование» would be the one place that has to stay in sync with
 * the facilitator's screen, and the session runs on the screen.
 *
 * The cabinet screens are server-rendered and post Server Actions, so the
 * schema below is declared for the contract's sake (the data provider never
 * fetches this resource) and describes one poll as the list shows it.
 */
export const votePollRecordSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().min(1),
    kind: z.enum(POLL_KINDS),
    options: z.array(z.string()),
    status: z.enum(POLL_STATUSES),
    sourcePollId: z.number().int().positive().nullable(),
    ballotCount: z.number().int().nonnegative(),
  })
  .strict()

export const voteAdminSection: WorkspaceAdminSection = {
  label: 'Голосование',
  resources: [
    {
      name: 'polls',
      label: 'Голосования',
      operations: ['list', 'show'],
      schema: votePollRecordSchema,
    },
  ],
}

export const voteWorkspaceEntry: WorkspaceModule = {
  kind: 'internal',
  slug: 'vote',
  name: 'Голосование',
  description: 'Рейтинг и согласие',
  href: '/p/vote',
  icon: 'vote',
  admin: voteAdminSection,
}
