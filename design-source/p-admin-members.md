Stage-A owner pick (Anton, 2026-08-29): **Option A — profile and aliases side by side**.

Picked layout:
- member record/create/edit uses a two-column workspace: profile form on the left, nested aliases list/actions on the right;
- on narrow viewports the columns stack vertically;
- create starts with the profile form; aliases become available only after the member's first successful save;
- member delete is absent; status change/deactivation is the supported act;
- existing email is read-only; aliases support create/update/delete.

The already accepted `design-source/p-admin-shell.html` remains the source for the list/search/table/actions layout. The visual language remains `system: shadcn/ui via ui.refine.dev @ default neutral theme`; this pick changes composition only.

Design-fidelity: GO — Anton Sidorov, 2026-08-29 — member list uses the accepted admin wireframe; member create/edit/detail uses Option A with profile and aliases side by side on the adopted shadcn/Refine neutral system.

States not depicted by the described happy-path layout and required in delivery: hover, focus-visible, disabled/pending save, loading, empty member list, empty aliases, validation error, read/save failure, duplicate-alias refusal, permission-denied. Narrow behavior is specified as vertical stacking.
