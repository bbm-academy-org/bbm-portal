## Stage-A layout decision — owner pick

**Owner:** Anton Sidorov
**Date:** 2026-08-30
**Pick:** option A — separate, calm resource pages.

The hours cabinet keeps the four sidebar items fixed by EARS-446:

- **Periods:** table → separate create/edit page; lifecycle actions and recompute/publication-lock warnings remain prominent on the record page.
- **Rates and grades:** searchable participant table → separate create/edit page; email is the immutable lookup key on edit.
- **Export:** a dedicated action page with an explanation and JSON download control, not a CRUD resource.
- **Mattermost publication:** a dedicated page for period selection, preview, eligibility/refusal state, and the publish action.

The layout reuses the accepted `/p/admin` shell and the default neutral shadcn/ui system recorded at #360. The current `/p/hours/admin` build is a behavioural reference only, not a visual source.

**States not depicted by the described happy path and required in delivery:** loading, empty, read/save error, permission denied before shell entry, publication-locked period, no eligible publication, narrow viewport, hover, focus-visible, active, and disabled actions.

**Design-fidelity: GO — Anton Sidorov, 2026-08-30 — option A for the four hours cabinet pages on the accepted shadcn/ui system.**

Implementation remains within issue #317: `/p/hours` is unchanged, finance and production deployment are out of scope.
