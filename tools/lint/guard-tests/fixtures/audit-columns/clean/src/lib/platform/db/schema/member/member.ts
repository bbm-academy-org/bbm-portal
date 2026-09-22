import { core } from '../core'
import { auditColumns } from '../audit-columns'

export const member = core.table('member', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  ...auditColumns(),
})
