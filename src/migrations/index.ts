import * as migration_20260612_074828_initial from './20260612_074828_initial';
import * as migration_20260612_083133_bbmp_28_content_surfaces from './20260612_083133_bbmp_28_content_surfaces';
import * as migration_20260616_034002_leads from './20260616_034002_leads';
import * as migration_20260618_083728_cms_14_drafts_versions from './20260618_083728_cms_14_drafts_versions';

export const migrations = [
  {
    up: migration_20260612_074828_initial.up,
    down: migration_20260612_074828_initial.down,
    name: '20260612_074828_initial',
  },
  {
    up: migration_20260612_083133_bbmp_28_content_surfaces.up,
    down: migration_20260612_083133_bbmp_28_content_surfaces.down,
    name: '20260612_083133_bbmp_28_content_surfaces',
  },
  {
    up: migration_20260616_034002_leads.up,
    down: migration_20260616_034002_leads.down,
    name: '20260616_034002_leads'
  },
  {
    up: migration_20260618_083728_cms_14_drafts_versions.up,
    down: migration_20260618_083728_cms_14_drafts_versions.down,
    name: '20260618_083728_cms_14_drafts_versions'
  },
];
