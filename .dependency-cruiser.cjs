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
        'ADR-002: the OKR module (src/lib/okr + src/modules/okr) must not import CMS internals — ' +
        'collections/globals/endpoints/hooks/fields/admin/seed/migrations or the Payload config.',
      severity: 'error',
      from: { path: '^src/(lib/okr|modules/okr)' },
      to: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations)|^src/payload\\.config|^src/payload-types',
      },
    },
    {
      name: 'cms-must-not-import-okr-internals',
      comment:
        'ADR-002/ADR-003: the CMS side may not reach into OKR module internals ' +
        '(src/lib/okr, src/modules/okr). Only the (platform) route group renders the ' +
        'OKR views (the Zitadel-gated /p/okr surface) — it is deliberately absent from ' +
        'this from-set. app/(frontend) IS listed (ADR-003 consequence: the CMS frontend ' +
        'group must not import platform-module internals either).',
      severity: 'error',
      from: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations|app/\\(payload\\)|app/\\(frontend\\))|^src/payload\\.config',
      },
      to: { path: '^src/(lib/okr|modules/okr)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.(css|scss)$' },
  },
}
