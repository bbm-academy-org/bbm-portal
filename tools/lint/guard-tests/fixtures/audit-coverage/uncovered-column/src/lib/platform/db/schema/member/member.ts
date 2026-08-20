import { core } from '../core'

export const member = core.table('member', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  nickname: text('nickname'),
})
