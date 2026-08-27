---
status: In dev
issue: 338
updated: 2026-08-26
---

# Finance F1 — ledger core — spec (issue #338)

- **Issues:** #338 (this spec, the F1 parent under epic #115); the build is split
  in two — **#356** «Finance F1a — ledger backend core» carries the data model,
  the migrations, the module API and every fact-core invariant — §A, §B,
  EARS-323 and EARS-330…334 — and **#357** «Finance F1b — finance surfaces»
  carries the workspace declaration, `/p/finance` and the `/p/admin/finance/*`
  resources, which are EARS-324/325/326 and nothing else: the write gate, the
  binding as master data and the exception query are enforced in the module
  (#356) and only surfaced here. #357 is blocked by #356 and by the portal-workspace frame
  it plugs into — #314 (`/p` launcher and the registry rendering) and #315
  (`/p/admin` Refine shell); #312 (UI kit) and #313 (`platform-admin` claim gate)
  are already delivered. The split follows the owner's order of 2026-08-26 that
  the backend core is built first and the front-end dependency lives in the
  native issue graph rather than in prose.

## Why

The finance epic (#115) needs its foundation: the definition of "a fact of
money" for BBM. F1 delivers the ledger itself — currencies, accounts, the
project→product dimension, immutable double-entry postings with reversal
(сторно), conversion groups with frozen rates, and the editable reference
tables — plus the `/p/admin` resources to maintain those references. Every
other finance feature (intake #339, reports #340, reconciliation #341,
scenarios #342) reads from or writes into what this spec fixes.

Product source: `docs/product/finance/338-product.md` (US-1…US-16); owner
decisions 1–22 live in the #115 issue body. The data model was validated by the
owner on the wireframe prototype (Stage A, 2026-08-25 — see "Design gate").

## Prior decisions

- **ADR-002 §3** — finance is a module in the modular monolith: a route +
  isolated library (`src/lib/finance/`) exposing a public API; it never imports
  another module's internals, and nothing imports its internals.
- **ADR-004 §1, §3** — tables live in the `platform` database, Postgres schema
  `core`, created only through the drizzle migration pipeline
  (`pnpm platform:migrate:generate` → committed migration).
- **ADR-004 §6** — table files live in `src/lib/platform/db/schema/finance/`;
  only the finance module may import them (`pnpm boundaries`); a route imports
  no table file. An FK into another module's table (here: `core.member`) is
  declared in SQL inside the migration, never as a drizzle import across module
  directories — the hours tables are the precedent, and the constraint is
  asserted by an integration test.
- **ADR-004 A1** — the application connects as the least-privilege role;
  migrations run as the migrating role. Nothing in this spec changes grants.
- **ADR-005 §2** — `/p/finance` computes and takes input, so it is a portal
  module; the normative finmodel text stays in the KB. F1 renders no text
  document.
- **Consolidation spec §8** (`docs/superpowers/specs/2026-08-04-platform-consolidation-design.md`)
  — the engineering frame, inherited and not re-decided: double-entry; postings
  immutable with reversal instead of edits; amounts as `bigint` in the
  currency's minimal units with currency-dependent precision; a conversion is a
  linked group of postings with each step's fee explicit and the rate frozen at
  the operation; links to `member` and the `/p/hours` data.
- **Spec 311 §A, §D** (EARS-401/402/409, EARS-431…439) — the workspace
  declaration contract: finance declares one `internal` entry with an `admin`
  section; its resources mount at `/p/admin/finance/<resource>` through the
  registry, with zod schemas, readable refusals and audited writes.
- **Spec 201 / ADR-004 A1** (`docs/specs/201-universal-edit-audit.md`, migration
  `0003`, coverage guard `tools/lint/audit-coverage-lint.mjs`) — every cabinet
  write runs through `platformTransaction` with the signed-in admin as actor, so
  reference edits are attributable in `core.audit_event` (spec 311 EARS-439).
  This is the who/when/what record for finance reference edits, including a
  change of a purpose's `product_binding`: F1 adds **no** dedicated
  binding-change journal on top of it (Accounting policy, ruling 2).

**Donor & benchmark pass:** the engineering constraints above are inherited from
the consolidation spec §8 and the hours schema conventions (spec 124), each
justified for this domain in place. The three accounting questions the PRD left
open (#338 OQ3/OQ4/OQ5) were researched against public canon — IAS 38.67,
IFRS 15.97(e)/15.98(a), IFRS 8.28, IAS 21 with the IFRIC June 2019 agenda
decision on cryptoassets, the IMA Conceptual Framework for Managerial Costing
(causality / attributability), CIMA's allocation-vs-apportionment distinction
and the Garrison segment-margin statement — and the resulting rulings in
"Accounting policy" below were **accepted by the owner at the stage-2 go
(2026-08-26, #338)**, the overhead ladder with five amendments. No owner
question in this spec asks what public research answers.

**Scope note on IFRS.** No IFRS standard governs management accounting; this
register is an internal decision ledger, not a statutory measurement. Where a
standard is cited below it is cited for the reasoning it supplies, never as
authority over this ledger — and **IAS 2 is deliberately not cited in support of
non-allocation**: IAS 2.12 _requires_ a systematic allocation of production
overheads, it governs the balance-sheet carrying amount of inventory (which BBM
does not hold), and its old §19 on service providers was deleted by the IFRS 15
consequential amendments. The honest anchors are IAS 38.67(a) (selling,
administrative and other general overhead expenditure is not a component of an
internally generated intangible's cost _unless_ it can be directly attributed to
preparing the asset for use — IAS 38.66 does include directly attributable
costs), IFRS 15.97(e)/15.98(a), and — for the reporting shape — IFRS 8.28's
reconciliation of segment results to entity result with unallocated corporate
costs identified and described.

**IFRS 15.97 is borrowed for one criterion, not as a ban on allocation.** The
same trap that IAS 2 sets is set by IFRS 15: **97(c) expressly permits
«allocations of costs that relate directly to the contract or to contract
activities»**, so a reader must not take the citations below as IFRS
prohibiting allocation bases. Only **97(e)** («other costs that are incurred
only because an entity entered into the contract») is used here, and only for
its «would not exist without» criterion. The design choice to post no
allocation base is a **management-accounting** choice — IMA causality /
attributability, CIMA's allocation-vs-apportionment distinction, and IAS 38.67's
direct-attribution ladder — not the application of a prohibition that no
standard states.

## Current behavior → replacement delta

There is no finance counterpart today. `src/lib/` holds `finmodel` (a CI-only
snapshot guard, never routed — ADR-005 §3), `hours`, `member`, `okr`,
`platform`; `src/modules/` holds `hours`, `okr`. Money exists in the estate only
as `/p/hours` accruals (spec 124) and the finmodel plan. F1 creates the first
ledger; nothing is replaced, and no existing surface changes.

## Design gate (stage 1b)

The owner validated the finance wireframe prototype on 2026-08-25 (Claude
Design canvas «Финконтур BBM — вайрфреймы», recorded on #115). The artboards F1
builds against are vendored verbatim in `design-source/finance/`:

- `Main.dc.html` — the data-model diagram («Модель данных леджера — что мы
  утверждаем»), the approved shape of the schema;
- `References.dc.html` — the `/p/admin` reference tables;
- `Overview.dc.html` — `/p/finance`; F1 ships only its cash-balances card.

The remaining nine artboards belong to F2–F5 and are vendored on their first
touch (design-source rule 4). F1's admin screens follow the accepted admin-shell
design (`design-source/p-admin-shell.html`, spec 311 EARS-432) — no new Stage-A
pick is needed.

## Data model (lead-level engineering decisions)

Directory `src/lib/platform/db/schema/finance/`, Postgres schema `core`, table
prefix `finance_`. No table stores a balance or a capitalization — both are
sums over postings, always.

| Table                     | Carries                                                                                                                                                                                                                                                                                                 | Key points                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `finance_currency`        | `code` PK (`RUB`, `THB`, `USDT`…), `name`, `precision` (decimal places of the minimal unit: RUB 2, THB 2, USDT 6), `retired_at`                                                                                                                                                                         | precision is frozen once a posting in the currency exists                                                             |
| `finance_account`         | `id`, `name`, `kind` (`bank`\|`card`\|`crypto`\|`cash`\|`income`\|`expense`\|`conversion`\|`fx_result`\|`liability`), `currency` FK, `is_system`, `retired_at`                                                                                                                                          | owner accounts are the four money kinds; system kinds are module-managed, one per (kind, currency), created on demand |
| `finance_project`         | `id`, `name`, `is_fund`, `retired_at`                                                                                                                                                                                                                                                                   | one flat level (decision 16); exactly one fund row («Фонд BBM») seeded by migration                                   |
| `finance_product`         | `id`, `project` FK, `name`, `sale_price` + `sale_price_currency` (both nullable), `retired_at`                                                                                                                                                                                                          | sits directly under its project (decision 16); capitalization is derived, not stored                                  |
| `finance_purpose`         | `id`, `name`, `category` FK (nullable while the category list is empty), `product_binding` (`required`\|`forbidden`\|`optional`), `retired_at`                                                                                                                                                          | decision 21: a purpose is a reference pick; the binding is declared at creation (Accounting policy, ruling 2)         |
| `finance_category`        | `id`, `name`, `allocable` (boolean: flows into unit cost vs period cost), `retired_at`                                                                                                                                                                                                                  | ships **empty** (decision 11); first content is F2's derivation, owner-approved                                       |
| `finance_operation`       | `id`, `occurred_on` (date), `purpose` FK (nullable — transfers, conversions and income carry none), `source` (`request`\|`bank_import`\|`hours`\|`manual`\|`backfill`\|`reversal`), `source_ref` (nullable text, filled by F2's intakes), `backdated` (boolean), `reverses` FK (nullable, unique, self) | the unit the register shows; a conversion chain is ONE operation                                                      |
| `finance_posting`         | `id`, `operation` FK, `account` FK, `amount` (`bigint`, signed, minimal units; debit > 0, credit < 0), `currency` FK, `project` FK (nullable), `category` FK (nullable), `product` FK (nullable), `member_id` (nullable, SQL FK → `core.member`), `conversion_step` FK (nullable)                       | the atomic fact; immutable                                                                                            |
| `finance_conversion_step` | `id`, `operation` FK, `step_no`, `from_currency` FK, `to_currency` FK, `rate` (numeric text, as recorded)                                                                                                                                                                                               | one row per exchange step; its fee is a separate posting referencing the step                                         |

Double-entry works over a chart of accounts that includes the system kinds: an
expense debits the per-currency system `expense` account and credits the money
account; the P&L dimensions (project, category, product, member) ride on the
expense-side posting. This keeps decision 11 intact (categories are data, not
accounts), keeps every operation balanced per currency, and gives F3 its
reports as plain sums.

## Requirements

Ids continue the flat corpus keyspace: this spec takes the next free
hundred-block, **EARS-301…** (spec 311 holds 401–499).

### A. Reference tables (справочники)

- **EARS-301.** The finance module shall store currencies, accounts, projects,
  products, purposes and expense categories as editable reference tables, per
  the vendored `design-source/finance/References.dc.html`.
- **EARS-302.** WHEN the owner adds a currency with its precision, the system
  shall accept postings in that currency immediately, with no release.
- **EARS-303.** IF a posting exists in a currency, THEN the system shall refuse
  a change to that currency's precision.
- **EARS-304.** The system shall seed exactly one fund project row («Фонд BBM»)
  in the migration, and shall refuse to retire it or to create a second fund
  row.
- **EARS-305.** The system shall create system accounts (income, expense,
  conversion, fx_result, liability) itself, one per kind and currency on first
  need, and the cabinet shall not offer creating, editing or retiring them.
- **EARS-306.** WHEN a purpose is created, the system shall require its
  `product_binding` (`required` / `forbidden` / `optional`) to be declared, and
  shall link the purpose to an expense category WHERE the category list is
  non-empty.
- **EARS-307.** The expense category table shall ship empty: no migration, seed
  or fixture inserts a category (decision 11); each category row shall carry an
  `allocable` flag stating whether it flows into unit cost or is a period cost.
- **EARS-308.** IF a reference row (currency, account, project, product,
  purpose, category) is referenced by any posting, operation or purpose, THEN
  the system shall refuse to delete it and shall offer retirement instead;
  a retired row shall stay valid on every existing posting and shall stop
  being offered for new ones.
- **EARS-309.** The system shall never rewrite an existing posting as a
  consequence of a reference edit — renames and retirements change how rows
  read going forward, never what was recorded.

### B. The fact core: operations, postings, reversal, conversions

- **EARS-310.** The finance module shall record money only as operations made
  of postings: each posting names its account, a signed `bigint` amount in the
  currency's minimal units, and its currency; each amount keeps the currency it
  happened in, with conversion for display left to reports (F3).
- **EARS-311.** The system shall refuse to record an operation whose postings
  do not sum to zero per currency.
- **EARS-312.** IF a posting's currency differs from its account's currency,
  THEN the system shall refuse the operation.
- **EARS-313.** The system shall refuse any update or delete of a recorded
  operation or posting, at the module API and — as an accident guard, per the
  spec-201 precedent — with database triggers on both tables; the only
  correction is reversal.
- **EARS-314.** WHEN an operation is reversed (сторно), the system shall record
  a new operation with `source = reversal`, referencing the original, whose
  postings mirror the original's with negated amounts and identical dimensions;
  both operations shall remain visible, and their sum shall be zero in every
  cut.
- **EARS-315.** IF an operation has already been reversed, THEN the system
  shall refuse a second reversal of it; a reversal operation itself shall be
  reversible (undoing a mistaken reversal).
- **EARS-316.** Every posting shall be traceable to its source: the operation
  carries one of `request` / `bank_import` / `hours` / `manual` / `backfill` /
  `reversal` (decision 3); backfilled operations carry the `backdated` flag
  (decision 17 context). F1 fixes the enum and the columns; the intake flows
  that fill `source_ref` are F2's.
- **EARS-317.** The system shall provide no opening-balance mechanism: every
  account starts at zero and its balance is exclusively the sum of its postings
  (decision 17).
- **EARS-318.** The system shall record a currency conversion as ONE operation:
  its exchange steps as `finance_conversion_step` rows each carrying the actual
  rate as recorded at the operation (decision 18), each step's fee as its own
  posting, and the legs balanced per currency through the system conversion
  account.
- **EARS-319.** The system shall never restate a recorded rate or amount: a
  conversion read a year later shows the rate of its day (decision 18), and no
  process revalues crypto or currency balances by posting (Accounting policy,
  ruling 3).
- **EARS-320.** WHEN a purpose with `product_binding = required` is used on an
  expense operation, the system shall refuse to record it without a product;
  WHEN the binding is `forbidden`, the system shall refuse a product on it;
  WHERE the binding is `optional`, the product may be absent (decision 22;
  Accounting policy, ruling 2).
- **EARS-321.** Every posting on an income or expense system account shall name
  a project (the fund row counts as one), so P&L is computable per project and
  for the whole of BBM as their sum (decision 2).
- **EARS-322.** WHERE an amount is attributable to a person, the posting shall
  carry `member_id`, declared as an SQL FK to `core.member` in the migration
  (ADR-004 §6) and asserted by an integration test, so "what did we pay X" is a
  query.
- **EARS-327.** WHEN an operation carries a purpose whose category link is
  filled, the system shall set that category on the operation's expense-side
  postings itself and shall refuse a differing one — a purpose and its category
  can never disagree on a posting (decision 21).
- **EARS-328.** WHEN an operation's conversion steps dispose of a holding of
  crypto or another currency — an operation that itself establishes an actual
  rate (decision 18) — the system shall compute the realized difference
  between that rate and the holding's **weighted-average recorded rate**, and
  shall post it inside the same operation to the system `fx_result` account of
  the fund — never onto a product — with the system `conversion` account as
  the balancing counter-leg in the same currency, keeping EARS-311's
  per-currency zero-sum intact (Accounting policy, ruling 3; the recorded legs
  themselves are never restated).
  The average is of the **remaining** holding, moving-average cost flow: every
  disposal removes its quantity from the pool together with the share of cost
  that quantity carried, so an acquisition made after a disposal prices the next
  one and a lifetime average of every purchase ever made does not. It is derived
  from recorded postings rather than from re-applied rate strings — the exchange
  legs of the pair's prior steps, summed rather than sign-filtered, so a
  reversal cancels its original (EARS-314) — which keeps the arithmetic exact
  integer arithmetic and restates nothing (EARS-319). WHERE the ledger holds no
  remaining recorded acquisition of the disposed currency against the received
  one, the system shall post no FX result at all rather than invent a basis; the
  `conversion` account is a clearing account and shall read zero once every unit
  acquired has been disposed of. _(Recorded 2026-08-26 from the #370 review, so
  the clause and `src/lib/finance/conversions.ts` cannot drift; the F1a
  limitation that the pool is per currency PAIR is named in that module's
  header.)_
- **EARS-329.** IF an operation carries no conversion step (a payment or
  transfer in one currency), THEN the system shall post no FX result: the
  ledger holds no rate source for it (decision 18 records only actual
  operation rates), and any unrealised movement is an F3 display concern
  (ruling 3), never a posting.

### C. Module structure, admin resources, audit

- **EARS-323.** The finance module shall live as `src/lib/finance/` with its
  public API in `src/lib/finance/index.ts` (ADR-002 §3), exposing recording,
  reversal, reference management and balance/register queries; its tables shall
  appear only via the platform migration pipeline (ADR-004 §3), and
  `pnpm boundaries` shall stay green: only the finance module imports
  `schema/finance/`, and no route imports a table file.
- **EARS-324.** The module shall export one `internal` workspace declaration
  (slug `finance`, href `/p/finance`) carrying **no** `requiredClaim` — the
  owner's transparency policy makes BBM's money readable by every platform
  member, so the entry rides the workspace-wide `platform-user` gate (spec 311
  EARS-416) and nothing narrower — with an `admin` section declaring the
  reference resources, registered in the composition root (spec 311
  EARS-401/402), so they mount at `/p/admin/finance/<resource>` with no edit to
  the shell (EARS-409).
- **EARS-325.** WHEN any signed-in platform member opens `/p/finance`, the page
  shall render the accounts with their balances computed live from postings,
  each in its own currency (the cash card of the vendored
  `design-source/finance/Overview.dc.html`); the rest of the overview is F3's
  and shall not be stubbed. A request that does not carry `platform-user` (or
  `platform-admin`, which implies it — spec 311 EARS-417) shall be refused by
  the module's own handlers regardless of how the URL was reached (spec 311
  EARS-405/416): an unauthenticated request, and equally an **authenticated**
  session carrying neither role, which spec 311 answers with a bare 403
  (EARS-418). F1 exposes no public finance surface.
- **EARS-326.** Every cabinet write to a finance reference shall run through
  `platformTransaction` with the signed-in admin as actor (spec 311 EARS-439),
  and shall validate against the module's zod schemas (EARS-436); a refusal
  (EARS-303/304/308/311/312/313/320) shall reach the admin as the module's
  readable message, never a raw constraint error (EARS-473 shape).
- **EARS-330.** Every reference edit under `/p/admin/finance/*` shall be
  refused by the module's own handlers for a session that does not carry
  `platform-admin`, however the URL or API was reached; read access is
  EARS-325's and is deliberately wider.
  _(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`, its
  role clauses in §A) — the F2 role model this clause deferred to, now settled.
  Reference administration stays `platform-admin`; the **ledger** writes,
  posting an operation and reversing one, are gated by the flow roles
  `finance-entry` / `finance-approve` instead, and `platform-admin` by itself
  no longer posts or reverses. **The code caught up with this amendment in #380
  (2026-08-27) and the drift this note recorded is closed:** the single F1a
  guard `assertFinanceWriteAccess` was replaced by the three gates that match
  the three questions — `assertFinanceReferenceAccess` (this clause),
  `assertFinanceLedgerAccess` (spec 339 EARS-501/529) and
  `assertFinanceIntakeAccess` (EARS-501/502) — in
  `src/lib/finance/core/actor.ts`, and `tests/unit/finance-invariants.spec.ts`
  and `tests/int/platform/finance-core.int.spec.ts` assert the amended clause,
  including that an admin without `finance-approve` is refused posting and
  reversal.)_
- **EARS-331.** The `product_binding` shall be master data, never a
  per-operation judgement: WHEN an operation is recorded, the system shall take
  the binding from the named purpose and shall accept from the operator only
  the product **value**, never a change of the binding itself; changing a
  binding shall be an edit of the purpose, available to `platform-admin` only
  (EARS-330) and recorded by the universal edit audit (spec 201).
- **EARS-332.** WHEN a purpose's `product_binding` changes, the system shall
  leave every already-recorded posting exactly as posted — it shall neither
  rewrite nor re-validate history against the new rule (EARS-309); the only
  correction of a recorded operation in F1 is reversal (EARS-313/314).
  _(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`, its
  read-time category resolution in §F): the reclassification path this clause
  promised for F2 is **not**
  built. F2 replaces it with read-time category resolution — a posting that
  stored no category resolves it through its purpose's current link when read —
  and keeps reversal as the only correction; no posting-mutation
  reclassification will be built.)_
- **EARS-333.** The module's public API shall expose, as a query, the postings
  recorded against a purpose with `product_binding = optional` that carry no
  product — the exception list by which the taxonomy converges from use; its
  reporting surface is F3's.
- **EARS-334.** The system shall post no allocation of overhead onto a product
  or project: an amount reaches a cost object only as a posting recorded with
  that dimension (EARS-320/321), and no percentage base, absorption rate or
  allocation run shall write to the ledger. Cost-driver data (member time
  through `/p/hours`, usage) shall remain collected and queryable so an
  allocation view can be computed later in F3 without restating anything
  (Accounting policy, ruling 1).

## Accounting policy — rulings accepted at the stage-2 go

The owner ruled (decision 22) that overhead treatment follows proper-accounting
best practice, researched by this spec and signed off at the go. All three
rulings below were **accepted by the owner on 2026-08-26 (#338)** — ruling 1
with five amendments, folded into its text.

**Ruling 1 — product-less overhead (closes #338 OQ4).** The governing texts for
a service/digital product are IAS 38.67(a) (selling, administrative and other
general overhead expenditure is not part of an internally generated intangible's
cost _unless_ it can be directly attributed to preparing the asset for use) and
IFRS 15.97(e) / 15.98(a) (a fulfilment cost relates to a contract when it was
incurred _only because_ the entity entered into it; G&A is expensed as
incurred). Neither governs this internal register, and neither forbids
allocation — IFRS 15.97(c) expressly permits allocations of directly related
costs; see the scope note under "Prior decisions" for why 97(e) is borrowed for
its criterion alone. At BBM's scale (few, heterogeneous, low-volume products) an allocation base
distorts more than it informs: IMA's causality/attributability principles and
CIMA's allocation-vs-arbitrary-apportionment distinction both say attach only
what a cost object actually caused. The ladder:

1. a **direct** cost → its product;
2. **directly attributable overhead** → a product only if it passes ALL of:
   (a) it would not exist without the product, (b) it traces to ONE product
   without a percentage split, (c) its purpose is to create, deliver **or
   market** the product rather than to run the entity;
3. everything else → **period cost** of the fund or project, **no allocation
   base in v1**.

Throughout this ruling, **(a)–(e) in «amendment (…)» are the owner's amendment
letters** from the stage-2 go (#338), while the ladder's own tests are always
named «criterion (a)/(b)/(c)» — the two schemes are unrelated.

Amendment (a): a campaign run for exactly one product passes criteria (a) and
(b) and is a textbook traceable fixed cost of that product's segment — «does not sell» was
an inventory-valuation rule (IAS 2.16(d)) imported into a decision report, and
keeping it would overstate the margin of exactly the heavily marketed products.
Single-product marketing therefore IS attributable to that product.

Amendment (b) — **the level-lift.** A cost that fails criterion (b) only because it serves
several products of ONE product line or fund lands on that **line/fund** as its
own named subtotal, sitting between the product margins and the entity line.
This is the standard multi-level segment statement (Garrison); it introduces no
percentage base anywhere — a cost either traces to a level or moves up one.

Capitalization of a product = its direct costs + its directly attributable
overhead, read off postings (EARS-320/321 carry the mechanics). Trade-off,
stated: the sum of product margins exceeds holding profit by the unallocated
overhead. That gap is the reporting device, not an artefact (IFRS 8.28
reconciliation; Garrison's segmented income statement) — and, per amendment
(c), F3 shows it as **named buckets** (office, shared salaries, shared
hosting, fundraising/admin…), each identified and described in the IFRS 8.28
manner, never as one opaque «нераспределённое» line.

**Cost drivers are collected, allocations are not posted** (amendment (d),
EARS-334): member time through `/p/hours` and usage data stay in the estate so
a functional-expense or indirect-cost-rate view is later a query rather than a
data-archaeology project — but nothing writes an allocation into the ledger.
Because the ledger stores attributability per posting, an absorption/ABC view
can be added as an F3 overlay without restating anything.

**Prices are never derived from this register's product cost** (amendment (e)).
A cost base that deliberately excludes overhead would systematically underprice
if it were used cost-plus. Pricing takes a required-contribution target derived
top-down from the total unallocated block; the register measures, it does not
price.

**Ruling 2 — the attributability test (closes #338 OQ5).** Adapted from IFRS
15.92's incremental-cost wording (a cost the entity «would not have incurred if
the contract had not been obtained») into two questions: (1) «Если бы этого
продукта не было — мы бы всё равно потратили эти деньги?» yes → no product;
no → name it; (2) only if "partly": «Можешь назвать ОДИН продукт без деления по
процентам?» no → the cost moves up a level (ruling 1, amendment (b)), it is not
split by percentage. The operator recording an operation never answers them:
attributability is declared ONCE, on the **purpose**, as `product_binding`
(EARS-306/320/331) — whoever defines a purpose runs the test, and the form then
requires, hides or offers the product field.

This is the mainstream shape, not an invention: it is Dynamics 365 Business
Central's `Value Posting` (Code Mandatory / No Code / blank), SAP's field status
(Required / Optional / Suppressed), NetSuite's mandatory classifications and
Sage Intacct's required-dimension checkbox. What SMB tools (Xero, QuickBooks)
lack is precisely this master-data rule — per-transaction judgement is their
defect, not a design anyone defends. Four consequences, all accepted at the go:

- **the operator picks the value, never the binding** (EARS-331); the binding is
  a `platform-admin` edit of the purpose;
- **corrections of already-posted entries are role-gated and audited** — the
  only correction is reversal (EARS-313/314), with the actor recorded per spec 201. _(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`,
  EARS-520/529) on two counts. The **gate**: reversal is not an admin act — it
  is gated by the flow role `finance-approve`, while `platform-admin` covers
  reference administration only (EARS-330 as amended). The **journal**: the
  «true reclassification journal (moving a dimension without reversing) arrives
  with F2» promised here is not built — F2 replaces it with read-time category
  resolution (EARS-520) and keeps reversal as the only correction; no
  posting-mutation reclassification will be built.)_;
- **an exception report** lists `optional`-binding postings filed without a
  product (EARS-333), so the taxonomy converges from use;
- **a binding change never rewrites history** (EARS-332): postings made under
  the old rule stand exactly as posted. There is deliberately **no dedicated
  binding-change journal** — the universal edit audit
  (`docs/specs/201-universal-edit-audit.md`, migration `0003`, coverage guard
  `tools/lint/audit-coverage-lint.mjs`) already records who changed what and
  when on the core tables, and a second log of the same fact would drift.

**Ruling 3 — crypto holdings (closes #338 OQ3).** Per the IFRIC June 2019
agenda decision crypto is a non-monetary asset; IAS 21 does not retranslate
non-monetary items held at cost — the transaction-date rate persists, so the
ledger's frozen-rate principle IS the standard treatment. Proposal: the ledger
holds crypto at the recorded rate forever; **no revaluation postings ever**
(EARS-319); the difference is recognised only on disposal **through a
conversion** — the one operation class that itself establishes an actual rate
(decision 18) — computed against the holding's **weighted-average recorded
rate** (the standard cost-flow assumption for a fungible holding; no lot
tracking in v1) and posted to the system `fx_result` account of the fund,
against the `conversion` account, never onto a product (EARS-328). A payment
or transfer in one currency establishes no rate and recognises nothing
(EARS-329); unrealised movement is an F3 display concern — the market
equivalent of a holding is a computed, labelled report/dashboard line, never a
posting, while the **quantity** held is always shown as recorded. IAS 36
impairment is an explicit v1 deferral. Accepted as proposed at the go, with no
amendment.

Cross-cutting principle, verbatim in the model: the ledger records facts at the
rate and cost object they had when they happened; every judgement that can
change later — allocation, absorption, revaluation — lives in F3 as a computed
overlay, never as a posting. Policy changes become report changes, not
migrations.

## CRUD check (task-cycle stage 1a)

| Resource (`/p/admin/finance/…`) | Create                                               | Read                                  | Update                                                                        | Delete                                                             |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| currencies                      | yes (code, name, precision)                          | yes                                   | name; precision only while unused (EARS-303)                                  | retire; hard delete only if never referenced (EARS-308)            |
| accounts                        | yes (money kinds only)                               | yes (system accounts shown read-only) | name                                                                          | retire; same rule                                                  |
| projects                        | yes                                                  | yes                                   | name                                                                          | retire; the fund row is neither retirable nor deletable (EARS-304) |
| products                        | yes (under a project)                                | yes                                   | name, sale price                                                              | retire; same rule                                                  |
| purposes                        | yes (binding mandatory, EARS-306)                    | yes                                   | name, category link, binding (admin only, EARS-331; history stands, EARS-332) | retire; same rule                                                  |
| categories                      | yes (from F2's derivation on; the table ships empty) | yes                                   | name, allocable flag                                                          | retire; same rule                                                  |

Deliberately unsupported: creating/editing system accounts (EARS-305); any
cabinet surface for operations or postings — the fact core is written only by
the module API (intakes are F2); changing a currency's precision in use; a
second fund row.

## Acceptance scenarios

Owner walkthrough, on a live stand, after the go and the build:

1. **References exist and are mine to edit.** Open `/p/admin` → group «Финансы»
   lists the six resources (EARS-324). Create currency `THB` (precision 2),
   account «Карта THB» (kind card, THB), project «Doctor.School», product
   «Урок» under it, purpose «Продакшн урока» with binding `required` — each
   save answers with a visible confirmation (EARS-301/302/306, spec 311
   EARS-472).
2. **The ledger starts honest.** Open `/p/finance` — every account shows
   balance 0 in its own currency, because no operation exists yet
   (EARS-317/325).
3. **Money is visible to the team, references editable by the admin.** Sign in
   as a member holding `platform-user` but not `platform-admin`: `/p/finance`
   opens and shows the same balances card (EARS-324/325), while
   `/p/admin/finance/purposes` is refused (EARS-330, spec 311 EARS-405). Sign
   out entirely and open `/p/finance` — refused, F1 has no public surface
   (EARS-325).
   _(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`,
   EARS-529): this step checks the **reference** write gate only. Ledger writes
   — posting and reversal — are gated by `finance-entry` / `finance-approve`,
   so `platform-admin` alone is no longer the write role to walk here; that
   part of the walkthrough lives in spec 339's scenario 1.)_
4. **The past is protected.** In `/p/admin`, try deleting the currency `THB`
   that the account uses — a readable refusal offers retirement instead
   (EARS-308/326). Rename the account — the rename is visible, nothing else
   changes (EARS-309).
5. **The fund is fixed.** Try retiring «Фонд BBM» — a readable refusal
   (EARS-304).
6. **Categories are not pre-invented.** Open the categories resource — the
   table is empty, with creation available (EARS-307).

### Verified by CI, not by the owner

The fact-core invariants have no owner-facing surface until F2's intakes; they
are exercised by TDD tests named `it('EARS-N: …')` (task-cycle stage 3):
per-currency zero-sum (EARS-311/312), immutability incl. the DB trigger
(EARS-313), reversal mechanics (EARS-314/315), the source enum and backdated
flag (EARS-316), no-opening-balance (EARS-317), conversion steps with frozen
rates (EARS-318/319), product binding (EARS-320), the project dimension
(EARS-321), the `core.member` FK (EARS-322), boundaries (EARS-323), the
write-side claim gate (EARS-330), the binding as master data (EARS-331), a
binding change leaving history intact (EARS-332), the product-less `optional`
exception query (EARS-333), and the absence of any allocation posting
(EARS-334).

## Out of scope

- Every intake: the request form, approval queue, bank import, backfill, hours
  accruals — **F2 (#339)**, which also derives the category list (decision 11)
  and settles the full role model (decision 8). F1 already opens **reading**
  `/p/finance` to every platform member (EARS-324/325, the owner's transparency
  policy) and keeps every reference catalogue at `platform-admin` (EARS-330).
  _(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`,
  EARS-501/529): the finer split deferred here is settled. Reference
  administration stays `platform-admin`; ledger writes — posting and reversal —
  are gated by the flow roles `finance-entry` / `finance-approve`, and
  `platform-admin` by itself no longer posts or reverses.)_
- Reclassification of a posted operation (moving a dimension without reversing
  it): in F1 the only correction is reversal (EARS-313/314/332).
  _(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`,
  EARS-520): it is not F2's either. F2 replaces the promised reclassification
  with read-time category resolution and keeps reversal as the only
  correction; no posting-mutation reclassification will be built.)_
- Any allocation, absorption or ABC run: F1 posts none by design (EARS-334) and
  F3 computes such views as overlays.
- Reports beyond the balances card: register UI, P&L, cash flow, unit cost,
  capitalization display — **F3 (#340)**; reconciliation — **F4 (#341)**;
  scenarios — **F5 (#342)**.
- Obligations (decision 14): the `liability` account kind exists in the enum so
  F2's accruals and reimbursements have a home, but no obligation flow ships in
  F1.
- Documents/attachments — arrive with the request flow (F2).
- Payout/token/waterfall mechanics, tax filing, statutory forms
  (`338-product.md` Out of scope).

## Open questions

None. #338 OQ1/OQ2 were closed by decisions 16/17; OQ3/OQ4/OQ5 are closed by the
three rulings above, accepted by the owner at the stage-2 go on 2026-08-26
(#338) — ruling 1 with the five amendments folded into its text. The lead's
`platform-admin`-everywhere default was **reversed** by the owner in the same
go: reading `/p/finance` is open to every platform member, the reference
catalogues stay `platform-admin`, and F1 exposes no unauthenticated surface
(EARS-324/325/330).
_(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`,
EARS-501/529) — F2's role model (decision 8) is settled and this entry no
longer defers to it: reference administration stays `platform-admin`, while
ledger writes — posting and reversal — are gated by the flow roles
`finance-entry` / `finance-approve`, and `platform-admin` alone no longer posts
or reverses.)_
