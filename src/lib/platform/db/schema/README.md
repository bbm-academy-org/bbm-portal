# `core` schema — one directory per module

Layout (#125). The shape is not cosmetic: it is what makes "a module does not
touch another module's tables" a **path rule** in
[`.dependency-cruiser.cjs`](../../../../../.dependency-cruiser.cjs) rather than a
convention nobody can check. The decision, and why the rule is a group match
rather than one pair per module, is
[ADR-004 §6](../../../../../docs/adr/004-platform-persistence-foundation.md).

```
schema/
  core.ts              the pgSchema('core') handle — shared, importable by all
  <module>/tables.ts   the tables OWNED by src/lib/<module> (and src/modules/<module>)
```

- **The directory name IS the module name.** `schema/hours/` belongs to
  `src/lib/hours` / `src/modules/hours`; the rule
  `module-must-not-import-foreign-tables` allows a module to import
  `schema/<its own name>/…` and nothing else under `schema/*/`.
- **`core.ts` stays flat**, outside any module directory, so every module may
  import it — that is exactly what the rule's `^…/schema/[^/]+/` shape permits.
- **No barrel.** There is deliberately no `schema/index.ts` re-exporting every
  module's tables: a barrel is a legal one-hop path from any module to any
  table, so it would defeat the rule while leaving it green.

**The first product tables live in `member/`** — `core.member` and
`core.member_alias`, the shared people registry (spec
[`docs/specs/124-hours-on-core.md`](../../../../../docs/specs/124-hours-on-core.md),
EARS-1/2/17, issue #255). Their module is `src/lib/member`, whose
`index.ts` is the ONLY door other modules use: on top of
`module-must-not-import-foreign-tables` (which guards these table files), the
member module carries its own rule pair —
`hours-must-import-member-only-via-api` and `cms-and-okr-must-not-import-member`
— because a table rule alone does not stop a module from importing another
module's internals (EARS-8).

**`hours/`** holds the four tables of the hours module (`src/lib/hours` /
`src/modules/hours`, same spec, EARS-1/3/4/5/6): `hours_period`,
`hours_participant`, `hours_assessment`, `hours_publication`. They reference
`core.member`, and those two foreign keys are written **by hand in the
migration** (`migrations/0002_hours.sql`) rather than declared in drizzle: a
`references(() => member.id)` needs the member table OBJECT, i.e. an import of
`schema/member/` from inside `schema/hours/` — the very thing ADR-004 §6 keeps
out of a module. `tests/int/platform/hours-core.int.spec.ts` reads both
constraints back out of `information_schema` (EARS-1), so the arrangement is
asserted rather than trusted. Note the consequence for future work: a
hand-written constraint is invisible to `platform:migrate:generate` (it diffs the
schema files against `meta/*_snapshot.json`, never the live database), so it is
neither dropped nor re-proposed — and it must be repeated by hand if the table is
ever recreated.

Pipeline: [`../README.md`](../README.md).
