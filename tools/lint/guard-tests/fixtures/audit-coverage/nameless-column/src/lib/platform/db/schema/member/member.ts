import { core } from '../core'

export const member = core.table('member', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  note: text('note'),
  // drizzle's casing-inferred form: the SQL name is nowhere in the source.
  handle: text(),
})
