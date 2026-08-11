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

**No product tables exist yet, on purpose.** The data model of `/p/hours` and
`member` is product work (#124 and the follow-ups in epic #111); this task ships
the pipeline and the boundary, and the initial migration therefore creates the
schema and nothing else. Pipeline: [`../README.md`](../README.md).
