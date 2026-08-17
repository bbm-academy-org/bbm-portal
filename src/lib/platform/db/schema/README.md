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
module's internals (EARS-8). The hours tables land with the rest of #255.
Pipeline: [`../README.md`](../README.md).
