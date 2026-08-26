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
      name: 'finmodel-must-not-import-cms',
      comment:
        'ADR-002 (#192): the finmodel module (src/lib/finmodel + src/modules/finmodel) must not ' +
        'import CMS internals — collections/globals/endpoints/hooks/fields/admin/seed/migrations ' +
        'or the Payload config. The module owns no persisted data at all: its variables come from ' +
        'a committed snapshot of the bbm-kb master (src/lib/finmodel/snapshot, `pnpm ssot:pull`).',
      severity: 'error',
      from: { path: '^src/(lib/finmodel|modules/finmodel)' },
      to: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations)|^src/payload\\.config|^src/payload-types',
      },
    },
    {
      name: 'finmodel-must-not-import-hours-internals',
      comment:
        'ADR-002 (#192): two modules of the same monolith stay independent. The duplication this ' +
        'forbids is deliberate and already present — src/lib/finmodel/format.ts carries its own ' +
        'copy of formatRub/formatPercent with that reason written above it. Anything genuinely ' +
        'shared belongs in src/lib/platform, not in a cross-module import.',
      severity: 'error',
      from: { path: '^src/(lib/finmodel|modules/finmodel)' },
      to: { path: '^src/(lib/hours|modules/hours)' },
    },
    {
      name: 'hours-must-not-import-finmodel-internals',
      comment: 'ADR-002 (#192): the mirror rule — hours may not reach into finmodel.',
      severity: 'error',
      from: { path: '^src/(lib/hours|modules/hours)' },
      to: { path: '^src/(lib/finmodel|modules/finmodel)' },
    },
    {
      name: 'finmodel-must-not-import-okr-internals',
      comment: 'ADR-002 (#192): the same independence towards OKR.',
      severity: 'error',
      from: { path: '^src/(lib/finmodel|modules/finmodel)' },
      to: { path: '^src/(lib/okr|modules/okr)' },
    },
    {
      name: 'okr-must-not-import-finmodel-internals',
      comment: 'ADR-002 (#192): the mirror rule — OKR may not reach into finmodel.',
      severity: 'error',
      from: { path: '^src/(lib/okr|modules/okr)' },
      to: { path: '^src/(lib/finmodel|modules/finmodel)' },
    },
    {
      name: 'cms-must-not-import-finmodel-internals',
      comment:
        'ADR-002/ADR-003 (#192): the CMS side may not reach into finmodel module internals. ' +
        'The from-set is the SAME as the hours and OKR mirrors above, but for a different ' +
        'reason, and the difference is the point: those two modules HAVE a surface, and their ' +
        'route group is the door left out of the from-set. This module has NO surface at all ' +
        'today. #192 expected a public one in app/(frontend); #193 built a gated one at ' +
        '/p/model/rules and the owner then dropped it (2026-08-24) — the normative document is ' +
        'rendered by the KB (kb.bbm.academy/finmodel), and what stays here is the snapshot, the ' +
        'calculations and the text-vs-code guard. So no route group is excused: every CMS-side ' +
        'entry point, app/(frontend) included, is closed out of this module. WHEN a surface ' +
        'appears, whoever builds it decides its route group and removes exactly that path from ' +
        'this from-set — deliberately, in that PR, not by inheriting a hole nobody chose.',
      severity: 'error',
      from: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations|app/\\(payload\\)|app/\\(frontend\\))|^src/payload\\.config',
      },
      to: { path: '^src/(lib/finmodel|modules/finmodel)' },
    },
    {
      name: 'finance-must-not-import-cms',
      comment:
        'ADR-002 §3 / spec 338 EARS-323 (#356): the finance module (src/lib/finance + ' +
        'src/modules/finance) must not import CMS internals. The ledger is platform data in the ' +
        '`platform` database (ADR-004 §1); Payload knows nothing about it and must stay that way, ' +
        'the same closure `cms-must-not-import-platform-db` states from the other side.',
      severity: 'error',
      from: { path: '^src/(lib/finance|modules/finance)' },
      to: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations)|^src/payload\\.config|^src/payload-types',
      },
    },
    {
      name: 'cms-must-not-import-finance-internals',
      comment:
        'ADR-002/ADR-003 (#356): the mirror. The finance surfaces are `/p/finance` and ' +
        '/p/admin/finance/* (spec 338 EARS-324/325, delivered by #357), i.e. the (platform) route ' +
        'group — which is why that group is the one left out of the from-set, exactly as in the ' +
        'hours and OKR mirrors. app/(frontend) IS closed out: BBM money has no public surface at ' +
        'all (EARS-325), and that is a product decision, not an oversight.',
      severity: 'error',
      from: {
        path: '^src/(collections|globals|endpoints|hooks|fields|admin|seed|migrations|app/\\(payload\\)|app/\\(frontend\\))|^src/payload\\.config',
      },
      to: { path: '^src/(lib/finance|modules/finance)' },
    },
    {
      name: 'finance-must-not-import-hours-internals',
      comment:
        'ADR-002 §3 (#356): two modules of the same monolith stay independent. Finance will need ' +
        "hours data eventually — F2's accruals (spec 338, Out of scope) — and when it does it " +
        "asks through `@/lib/hours`'s public API and gets its own reviewed rule pair, the way " +
        'hours got one for member. It does not inherit the access by importing an internal.',
      severity: 'error',
      from: { path: '^src/(lib/finance|modules/finance)' },
      to: { path: '^src/(lib/hours|modules/hours)' },
    },
    {
      name: 'hours-must-not-import-finance-internals',
      comment: 'ADR-002 §3 (#356): the mirror rule — hours may not reach into finance.',
      severity: 'error',
      from: { path: '^src/(lib/hours|modules/hours)' },
      to: { path: '^src/(lib/finance|modules/finance)' },
    },
    {
      name: 'finance-must-not-import-okr-internals',
      comment: 'ADR-002 §3 (#356): the same independence towards OKR.',
      severity: 'error',
      from: { path: '^src/(lib/finance|modules/finance)' },
      to: { path: '^src/(lib/okr|modules/okr)' },
    },
    {
      name: 'okr-must-not-import-finance-internals',
      comment: 'ADR-002 §3 (#356): the mirror rule — OKR may not reach into finance.',
      severity: 'error',
      from: { path: '^src/(lib/okr|modules/okr)' },
      to: { path: '^src/(lib/finance|modules/finance)' },
    },
    {
      name: 'finance-must-not-import-finmodel-internals',
      comment:
        'ADR-002 §3 / ADR-005 §2 (#356): the finmodel snapshot is the PLAN (a committed snapshot ' +
        'of the bbm-kb master), the finance ledger is the FACT. Two things that look adjacent and ' +
        'must not be wired together: a plan variable leaking into a recorded amount would make ' +
        'the ledger restate itself whenever `pnpm ssot:pull` runs, which is the opposite of ' +
        'EARS-319. Comparing plan against fact is a report (F3), computed from both, owned by ' +
        'neither.',
      severity: 'error',
      from: { path: '^src/(lib/finance|modules/finance)' },
      to: { path: '^src/(lib/finmodel|modules/finmodel)' },
    },
    {
      name: 'finmodel-must-not-import-finance-internals',
      comment: 'ADR-002 §3 (#356): the mirror rule — finmodel may not reach into finance.',
      severity: 'error',
      from: { path: '^src/(lib/finmodel|modules/finmodel)' },
      to: { path: '^src/(lib/finance|modules/finance)' },
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
        "without this rule a page under src/app/(platform)/ could import ANY module's tables " +
        'directly and both other rules would stay green — the invariant would be stated but not ' +
        "enforced. A route renders; it asks a module for data through the module's API, and the " +
        'module talks to its own tables. Hence no per-module exception here: unlike the rule ' +
        'above, there is no module name a route legitimately owns.',
      severity: 'error',
      from: { path: '^src/app/' },
      to: { path: '^src/lib/platform/db/schema/[^/]+/' },
    },
    {
      name: 'ui-kit-must-not-import-src',
      comment:
        'Spec 311 EARS-458 / consolidation §10: «любой модуль может импортировать `src/ui`; ' +
        '`src/ui` не импортирует ни один модуль». The half that needs a rule is the second one — ' +
        'the first is the ABSENCE of a rule, and the fixture `module-imports-ui` pins that it ' +
        'stays absent. Written wider than the word "module" on purpose: a kit that may not ' +
        'import src/lib/hours but MAY import src/app, src/collections or src/lib/platform/db is ' +
        'not context-free, it has just leaked through a door nobody named. So the to-set is ALL ' +
        'of src/ with src/ui/ excepted — the kit is composed of its own files and of nothing ' +
        'else. That is what makes it reusable by every module at once: it has no opinion about ' +
        'the session, the registry or the database, because it cannot reach any of them. ' +
        'Note the asymmetry with every rule above: those wall two peers off from each other and ' +
        'each names a route group it deliberately leaves out. This one has no exception at all — ' +
        'there is no caller src/ui is allowed to know about.',
      severity: 'error',
      from: { path: '^src/ui/' },
      to: { path: '^src/', pathNot: '^src/ui/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.(css|scss)$' },
  },
}
