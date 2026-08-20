import { core } from '../core'

export const widget = core.table('widget', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
})
