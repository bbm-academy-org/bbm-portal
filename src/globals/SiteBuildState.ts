import type { GlobalConfig } from 'payload'

/**
 * `siteBuildState` singleton (#41) — the publish-side TRUTH a drift indicator
 * reads. It records, machine-side, when the site was last published, when a
 * build was last dispatched, and the last dispatch error (if any).
 *
 * Deliberately VERSIONLESS / drafts-disabled. This is the load-bearing decision:
 * `publishSite.ts` and `pendingChanges.ts` derive their build surfaces from
 * `config.globals.filter(g => g.versions && g.versions.drafts)`. By having no
 * `versions`/`drafts`, this global is NOT in that set — it can never be promoted
 * or published, and the publish-rebuild hook (a later task, which keys off the
 * build surfaces) never fires on a write to it. No rebuild loop.
 *
 * Every field is `admin.readOnly` — these are machine-written (by the publish /
 * dispatch path), never edited by hand.
 */
export const SiteBuildState: GlobalConfig = {
  slug: 'siteBuildState',
  access: { read: () => true },
  fields: [
    {
      name: 'lastPublishedAt',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'lastDispatchAt',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'lastDispatchError',
      type: 'text',
      admin: { readOnly: true },
    },
  ],
}
