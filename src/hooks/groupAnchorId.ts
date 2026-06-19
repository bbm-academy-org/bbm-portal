import type { GlobalAfterReadHook, GlobalBeforeValidateHook } from 'payload'

/**
 * Payload reserves the field name `id` inside a GROUP and silently drops it
 * (no column is created). But the contract requires `participate.roles.id` and
 * `privacy.operator.id` — anchor slugs the site links to. So those two groups
 * store the slug under `slug`, and these hooks mirror `id <-> slug` on write/read
 * so both the API and editors transparently see `id`.
 *
 * (Inside an ARRAY a field named `id` IS honored as the row id, so
 * `privacy.sections[].id` and `participate.forms[].id` keep `id` natively.)
 */
const GROUP_ID_PATHS: ReadonlyArray<readonly [string, string]> = [
  ['participate', 'roles'],
  ['privacy', 'operator'],
]

const groupNode = (root: unknown, group: string, sub: string): Record<string, unknown> | undefined => {
  const g = (root as Record<string, unknown> | null | undefined)?.[group]
  const s = (g as Record<string, unknown> | null | undefined)?.[sub]
  return s !== null && typeof s === 'object' ? (s as Record<string, unknown>) : undefined
}

/**
 * The per-page globals (`pageParticipate.participate.roles`,
 * `pagePrivacy.privacy.operator`) carry the same slug-bearing groups the old
 * `pages` collection did (#18). On write we stash the incoming `id` as `slug`
 * (the actual stored field); on read we surface the stored `slug` back as `id`.
 */
export const stashGroupAnchorIdsGlobal: GlobalBeforeValidateHook = ({ data }) => {
  for (const [group, sub] of GROUP_ID_PATHS) {
    const node = groupNode(data, group, sub)
    if (node && node.id !== undefined) {
      node.slug = node.id
      delete node.id
    }
  }
  return data
}

export const restoreGroupAnchorIdsGlobal: GlobalAfterReadHook = ({ doc }) => {
  for (const [group, sub] of GROUP_ID_PATHS) {
    const node = groupNode(doc, group, sub)
    if (node && node.slug !== undefined) {
      node.id = node.slug
      delete node.slug
    }
  }
  return doc
}
