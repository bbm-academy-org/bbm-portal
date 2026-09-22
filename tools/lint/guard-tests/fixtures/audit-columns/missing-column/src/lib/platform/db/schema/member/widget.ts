import { core } from '../core'

export const widget = core.table('widget', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: integer('created_by'),
})
