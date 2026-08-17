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
    {
      name: 'hours-must-not-import-cms',
      comment:
        'ADR-002 (spec 081 req.28): the hours module (src/lib/hours + src/modules/hours) must not ' +
        'import CMS internals — collections/globals/endpoints/hooks/fields/admin/seed/migrations ' +
        'or the Payload config. The module owns a JSON document on disk, not a Payload collection.',
      severity: 'error',
      from: { path: '^src/(lib/hours|modules/hours)' },
      to: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations)|^src/payload\\.config|^src/payload-types',
      },
    },
    {
      name: 'hours-must-not-import-okr-internals',
      comment:
        'ADR-002 (spec 081 req.28): two modules of the same monolith stay independent — hours may ' +
        'not reach into OKR internals (and vice versa, see okr-must-not-import-hours-internals). ' +
        'Anything genuinely shared belongs in src/lib/platform.',
      severity: 'error',
      from: { path: '^src/(lib/hours|modules/hours)' },
      to: { path: '^src/(lib/okr|modules/okr)' },
    },
    {
      name: 'okr-must-not-import-hours-internals',
      comment: 'ADR-002 (spec 081 req.28): the mirror rule — OKR may not reach into hours.',
      severity: 'error',
      from: { path: '^src/(lib/okr|modules/okr)' },
      to: { path: '^src/(lib/hours|modules/hours)' },
    },
    {
      name: 'cms-must-not-import-hours-internals',
      comment:
        'ADR-002/ADR-003 (spec 081 req.28): the CMS side may not reach into hours module internals. ' +
        'Only the (platform) route group mounts the hours surface (the Zitadel-gated /p/hours) — it ' +
        'is deliberately absent from this from-set, exactly as in the OKR rule above.',
      severity: 'error',
      from: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations|app/\\(payload\\)|app/\\(frontend\\))|^src/payload\\.config',
      },
      to: { path: '^src/(lib/hours|modules/hours)' },
    },
    {
      name: 'hours-must-import-member-only-via-api',
      comment:
        'spec 124 EARS-8: the hours module reaches `member` data ONLY through the member module ' +
        'public API (src/lib/member/index.ts) — never through member internals. ADR-004 §6 alone ' +
        'is not enough here: `module-must-not-import-foreign-tables` guards the TABLE files ' +
        '(src/lib/platform/db/schema/member/), so without this rule an import of ' +
        '`@/lib/member/repository` would keep every boundary green while pinning hours to the ' +
        'member module internal shape. The exception is the barrel file itself, which is exactly ' +
        'what `@/lib/member` resolves to.',
      severity: 'error',
      from: { path: '^src/(lib/hours|modules/hours)' },
      to: {
        path: '^src/lib/member/',
        pathNot: '^src/lib/member/index\\.ts$',
      },
    },
    {
      name: 'cms-and-okr-must-not-import-member',
      comment:
        'spec 124 EARS-8, the mirror half: the CMS side and the OKR module have no business with ' +
        'the member registry AT ALL — not its internals and not its API. Same shape as ' +
        '`cms-must-not-import-hours-internals` / `okr-must-not-import-hours-internals`: a module ' +
        'that needs people data gets its own reviewed rule (hours has one above), rather than ' +
        'inheriting access because the barrel happens to be importable. The (platform) route ' +
        'group is deliberately absent from the from-set, as in every rule above.',
      severity: 'error',
      from: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations|app/\\(payload\\)|app/\\(frontend\\)|lib/okr|modules/okr)|^src/payload\\.config',
      },
      to: { path: '^src/lib/member' },
    },
    {
      name: 'cms-must-not-import-platform-db',
      comment:
        'ADR-002/ADR-003 (#125): the CMS side may not open the PLATFORM database. Payload owns ' +
        'the `cms` database through its own adapter; src/lib/platform/db is the only door to the ' +
        'separate `platform` database and its `core` schema (spec 2026-08-04 §4). Same from-set ' +
        'as the two rules above — the (platform) route group is deliberately absent, since that ' +
        'is where the platform surfaces legitimately live.',
      severity: 'error',
      from: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations|app/\\(payload\\)|app/\\(frontend\\))|^src/payload\\.config',
      },
      to: { path: '^src/lib/platform/db' },
    },
    {
      name: 'module-must-not-import-foreign-tables',
      comment:
        'ADR-002 (#125, spec 2026-08-04 §4): «модуль не импортирует внутренности чужого модуля и ' +
        'не трогает чужие таблицы напрямую». A module owns the tables under the schema directory ' +
        'that BEARS ITS NAME (src/lib/platform/db/schema/<module>/) and reaches every other ' +
        "module's data through that module's API, never through its tables. Expressed as a group " +
        'match rather than as one pair of rules per module — unlike the okr/hours pairs above, ' +
        'this rule has to hold for modules that do not exist yet (member, hours tables land with ' +
        'their product cycles, #124). src/lib/platform/ is excluded from the from-set so the ' +
        'schema files may reference each other and the shared schema/core.ts handle (which sits ' +
        'flat, outside any module directory, and is therefore not matched by the to-set at all). ' +
        'The `$1` in the to-set is dependency-cruiser group matching — it carries the module name ' +
        'captured in `from.path` into the exception. NUMBERED, not named: the implementation ' +
        '(src/utl/regex-util.mjs, replaceGroupPlaceholders) substitutes `$1`, `$2`, … only, so a ' +
        '`$<module>` placeholder would never be replaced and the rule would fire on every module ' +
        'touching its OWN tables.',
      severity: 'error',
      from: {
        path: '^src/(?:lib|modules)/([^/]+)/',
        pathNot: '^src/lib/platform/',
      },
      to: {
        path: '^src/lib/platform/db/schema/[^/]+/',
        pathNot: '^src/lib/platform/db/schema/$1/',
      },
    },
    {
      name: 'route-layer-must-not-import-tables',
      comment:
        'ADR-002/ADR-004 §6 (#125): the route layer never holds a table handle. ' +
        '`module-must-not-import-foreign-tables` keys on ^src/(lib|modules)/<module>/ and ' +
        '`cms-must-not-import-platform-db` deliberately omits the (platform) route group, so ' +
        'without this rule a page under src/app/(platform)/ could import ANY module\'s tables ' +
        'directly and both other rules would stay green — the invariant would be stated but not ' +
        'enforced. A route renders; it asks a module for data through the module\'s API, and the ' +
        'module talks to its own tables. Hence no per-module exception here: unlike the rule ' +
        'above, there is no module name a route legitimately owns.',
      severity: 'error',
      from: { path: '^src/app/' },
      to: { path: '^src/lib/platform/db/schema/[^/]+/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.(css|scss)$' },
  },
}
