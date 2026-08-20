import { core } from '../core'

export const member = core.table(
  'member',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull(),
    note: text('note'),
  },
  (table) => [uniqueIndex('member_slug_unique').on(table.slug)],
)
