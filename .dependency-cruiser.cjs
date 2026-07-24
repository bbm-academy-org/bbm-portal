/**
 * Module-boundary rules for the BBM Platform modular monolith (ADR-002):
 * a module = route + isolated lib; boundaries are machine-enforced, not
 * convention. Run: `pnpm boundaries` (CI job runs it on every PR).
 */
module.exports = {
  forbidden: [
    {
      name: 'okr-must-not-import-cms',
      comment:
        'ADR-002: the OKR module (src/lib/okr + its route) must not import CMS internals — ' +
        'collections/globals/endpoints/hooks/fields/admin/seed/migrations or the Payload config.',
      severity: 'error',
      from: { path: '^src/(lib/okr|app/\\(frontend\\)/okr)' },
      to: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations)|^src/payload\\.config|^src/payload-types',
      },
    },
    {
      name: 'cms-must-not-import-okr-internals',
      comment:
        'ADR-002: the CMS side may not reach into OKR module internals; the only legal consumer ' +
        'of src/lib/okr is the /okr route.',
      severity: 'error',
      from: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations|app/\\(payload\\))|^src/payload\\.config',
      },
      to: { path: '^src/lib/okr' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.(css|scss)$' },
  },
}
