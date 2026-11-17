---
status: In dev
issue: 339
updated: 2026-11-18
---

# Finance F2 — filling the ledger: requests, documents, backfill, intake layer — spec (issue #339)

- **Issues:** #339 (this spec, the F2 parent under epic #115). Build split
  filed 2026-08-27. The root is #380 (flow roles `finance-entry` /
  `finance-approve`, F1a guard rework), and two strands run from it. The spine
  strand: #381 (intake spine: schema, status machine, idempotent sources) ←
  #380; #382 (documents: private storage, authorized reads, immutability) ←
  #381; #385 (posting: atomic, document-gated, cross-currency, liability) ←
  #381 + #382. The reference strand: #383 (counterparty reference + purpose
  proposals) ← #380, and the admin cabinet rows (counterparty rename,
  purpose-proposal resolution) #384 ← #383 + #315. The two strands meet at
  #386 (expense-request flow: submit, approve, refuse, one-act post) ← #385 +
  #383, while #387 is the one-time private reconstruction of historical facts
  through the already-shipped intake primitives. UI: #388 (requests board —
  Stage-A pick D) ← #386 + #314 + #315, and #389 (intake workspace — manual
  entry and liability views) ← #314 + #315; both plug into the portal-workspace
  frame exactly as F1b does, which is why each also carries #314 (`/p`
  launcher/registry) and #315 (`/p/admin` shell), while the intake backend is
  buildable on merged F1a (#356) alone — the graph records that split with
  edges, not prose. The Hermes document-verifier
  integration is #390 (on #386), filed under epic #115. The private prod bucket
  the documents need is an infra step in the ops repo
  (`sidorovanthon/bbm#172`), not an issue here.
- **Issues (§I, owner's payment queue, 2026-11-17):** #547 (parent, sub-issue
  of #339) → #548 (Bank of Russia FX rates + display conversion) — head of the
  path; #549 (mark paid without a document, reimburse in one act, bulk
  retroactive posting — API) ← #466; #550 (queue screen) ← #548 + #517 + #549
  (it reads #549's stage model and must not ship an «Одобрить» button while
  approve still posts); #551 (details sheet, forms, bulk dialog) ← #549 +
  #550. #548 and the #466 → #549 strand run in parallel.
- **Issues (§J, market valuation of foreign-currency payments, 2026-11-18):**
  under the same parent #547 — #558 (the Рынок / Факт / Переплата read model
  and its weighted aggregates; the EARS-553 isolation test's write-path
  assertion) ← #548 — head of the path; #559 (the «Курс против рынка» report
  on `/p/finance/reports/market-rate`) ← #548 + #550 + #558; #551 (the details
  sheet) gains the per-request block and ← #558.

## Why

F1 (#338) defined what a fact of money is; F2 is how facts reach the ledger.
The owner ruled that reaching it must not be his own typing (decision 3), and
the corpus shows what happens without a system: requests and receipts live as
markdown posts and attachments in one Mattermost channel, currencies are
written three different ways, «дата» means three different things, and the
link from a request to its payment fact arrives weeks later as a separate
post. F2 replaces that channel with a structured intake: expense requests
with documents and direct entry — all flowing into the F1 ledger through one
pluggable layer, gated by two roles and by the rule that
**nothing posts without its confirming document** (decision 24) — save the
one exception the owner made on 2026-11-17: an approve-role human
mark-paid act posts an expense request without one, the receipt following
later (decision 37, EARS-506/543–546).

The historical corpus is reconstructed once as private operator work using the
same shipped one-item intake boundary. It is not a product surface or a reusable
import mechanism (owner correction 2026-09-01 after PR #426).

Product source: `docs/product/finance/339-product.md` (US-1…US-22); owner
decisions 1–27 live in the #115 issue body — decisions 23–27 were taken in
this spec's session (2026-08-26). The de-facto request corpus is analysed in
the session scratchpad (`mm-payments-corpus.md`; see «Current behavior»).
Two rounds of independent spec review ran before the go (2026-08-26, session
records); both rounds' blockers and majors are folded into this revision.

## Prior decisions

- **ADR-002 §3** — intake is not a deployable: forms, queue and the source
  layer live inside the finance module (`src/lib/finance/`), behind its public
  API; the pluggable-source boundary (decision 3) is an internal module
  boundary, not a service.
- **ADR-003 §3** — every F2 surface mounts under `/p/*`
  (`/p/finance/requests`, `/p/finance/intake`), covered by the single
  allowlist entry and the Zitadel gate; no middleware change.
- **ADR-004 §1, §3, §6, A1** — new tables only via the platform migration
  pipeline into `schema/finance/`; the finance module never imports hours
  tables (hours data, if ever needed, comes through the hours module's public
  API); the application runs as the least-privilege role.
- **ADR-005 §2** — everything here is dynamic (forms, queue, uploads) →
  portal. No KB text is touched.
- **Spec 311 §A, §D** (EARS-401/402/405/409, 431…439) — surfaces and admin
  resources follow the workspace contract: zod validation, readable refusals,
  role checks in the module's own handlers, audited cabinet writes.
- **Spec 201 / ADR-004 A1** — every reference and intake write runs through
  `platformTransaction` with the signed-in actor; `core.audit_event` is the
  who/when/what record. F2 adds no parallel journal.
- **Spec 338 (F1, In dev)** — the ledger contract F2 writes into and does not
  re-decide: immutability + reversal (EARS-313/314), per-currency zero-sum
  (EARS-311), conversion groups with actual rates (EARS-318), the source enum
  and `source_ref` columns (EARS-316), purpose → category coupling
  (EARS-327), `product_binding` as master data (EARS-320/331), no allocations
  (EARS-334), no opening balances (EARS-317).

**What this spec changes in F1/F1a — named, not implied** (the review found
these hidden; they are owner-visible items at the go):

1. **The write gate.** Spec 338 EARS-330 holds every finance write at
   `platform-admin` «until the F2 role model widens it». This spec is that
   widening: EARS-529 narrows EARS-330 to reference administration, and the
   F1a guard (`assertFinanceWriteAccess`) is reworked so ledger writes are
   gated by the two flow roles instead. **An admin who does not hold
   `finance-approve` loses posting and reversal** — a behaviour change to a
   shipped-spec scenario, explicitly on the go list. The PR amends **every**
   338 passage that states the old gate or defers to «F2's role model», not
   one sentence: EARS-330 itself, Out-of-scope bullet 1 and the
   Open-questions entry (role model), plus acceptance scenario 3's admin
   write gate. Spec 338 is `In dev` and already amends itself in place —
   EARS-328 carries such a revision, recorded with its own dated italic note —
   and this PR continues that practice rather than inventing one.
2. **The reclassification journal is not built.** Spec 338 ruling 2 promised
   «a true reclassification journal arrives with F2». Historical categories
   are instead approved before the one-time reconstruction and stored at
   posting; later mistakes use reversal. Any amendment of spec 338 is a
   separate product decision, not hidden inside the backfill.
3. **An internal F1a refactor** — `recordOperation`/`recordConversion` learn
   to run inside a caller-supplied `platformTransaction` (today they open
   their own), so posting an intake item is atomic (EARS-505). Module-private
   signatures, no spec-338 text change.
4. **A cross-currency vendor-payment posting path.** F1a's `recordConversion`
   demands a source AND a target money account, both non-system, with
   explicit per-step rates — a THB/USD invoice paid from a RUB card (the
   corpus's dominant shape) has no owner-side target account and cannot be
   posted through it, and `recordOperation` refuses cross-currency legs
   without conversion legs (EARS-311/312). The module gains a module-private
   posting path that builds the conversion legs itself, per the worked
   example in the data model; the legs enter the same system conversion
   account — and EARS-328's FX pool — exactly as an EARS-318 step does.
   Module-private signatures, no spec-338 text change.
5. **An official-rate source for DISPLAY only (§I, 2026-11-17).** Decisions
   13/18 and spec 338 EARS-325 keep every ledger number, the F1b
   current-money card and every F3 report on recorded rates only, and #425
   keeps «no external/market rate feeds» for valuation. §I adds the Bank of
   Russia daily rate as a **presentation** source for the requests queue
   alone (owner decision 39): it never enters a posting, a conversion step, a
   balance or a report (EARS-553). Spec 338 is not amended; the narrowing is
   recorded here and in the #115 decision log.
   **Widened 2026-11-18 (owner decision 41, §J):** the same rates may also be
   read as the **market side of a comparison** — what a foreign-currency
   payment or a conversion would have cost at the Bank of Russia rate of its
   date, set against what the ledger recorded it actually cost. The line that
   does not move: no ledger number — a posting, a conversion step, a balance,
   the F1b current-money card (spec 338 EARS-325, and #425's harvested series
   that will replace its rate) or an F3 period-report total (decision 18) —
   reads them, and no stored amount is computed from them (EARS-553
   rewritten). A comparison is shown, never booked. _Previous wording: «…as
   a presentation source for the requests queue alone (owner decision 39): it
   never enters a posting, a conversion step, a balance or a report».
   (The sentence above is kept as the decision-39 record; this paragraph is
   the 2026-11-18 amendment.)_

**§I decisions — owner go on the BBMP-281 clickable prototype, Антон,
2026-11-17** (vendored as `design-source/finance/RequestPaymentQueue.html`;
recorded as decisions 37–40 on #115):

- **Decision 37 — marking paid needs no document.** Recording that a request
  was paid or reimbursed is the approve-role human's act and does not require
  a confirming document; a receipt may be attached later. This deliberately
  revises EARS-506/510/511 (decision 24's «nothing posts without its
  confirming document» now binds the automated verifier and direct entry,
  not the human mark-paid act).
- **Decision 38 — the requests page is a payment queue.** The default view is
  grouped by what has to happen next (decide → pay → reimburse → drafts), with
  three sums on top; it replaces decision 35's flat default table. The board
  toggle stays.
- **Decision 39 — one display currency at the Bank of Russia rate.** Every
  amount on the queue is shown in one currency (₽ / $ / €, default ₽) at the
  CBR rate chosen by EARS-550; display only.
- **Decision 41 (Антон, «Го», 2026-11-18) — the market against the fact, in
  roubles.** For every foreign-currency payment and every recorded
  conversion, show **Рынок** (the document amount at the CBR rate of the
  payment date), **Факт** (what the account actually lost, fees included)
  and **Переплата** — Факт − Рынок as a money amount in ₽ (the owner wants
  the amount, not only the percentage) and Факт / Рынок − 1 as %; in the
  request's details sheet and in a «Курс против рынка» report on
  `/p/finance`. USDT is valued as USD at the CBR rate (no crypto price
  source), in the §I queue display too (EARS-551 revised, §J Q4 closed). Product logic adopted from the owner's personal budgeting app
  («Мой курс против рынка»), not its code (§J). It also answers §I Q2:
  cross-currency backlog requests take their actual debited amount per item,
  and the market side is computed — an estimated actual would make the
  overpayment zero by construction.
- **Decision 40 — an explicit bulk act for the retroactive backlog.** The
  owner may mark a whole «К оплате» / «Вернуть сотруднику» group paid in one
  confirmed, audited act (the September 17–18 backlog was paid outside the
  system). Agents never run it in production.

**Donor & benchmark pass:** the design is grounded in the **actual document
corpus** — the owner's ruling of 2026-08-26: analyse the real requests and
receipts (Mattermost «BBM Финансы», read-only export, 45 posts with files,
Apr–Aug 2026, 11 sample documents), not theoretical formats from the internet.
The owner's own de-facto request form (status / category / service / purpose /
amount in original currency / amount in RUB / date / approver mention) is the
donor of the form's fields, and each pain it shows (currency ambiguity, date
ambiguity, missing request→payment link, personal-card payments) maps to a
requirement below. The two-role flow gate inherits F1 ruling 2's master-data
precedent (Business Central / SAP field status), justified there. No public
research was imported as a constraint, and no owner question in this spec asks
what the corpus already answers.

## Current behavior → replacement delta

The current intake IS a Mattermost channel. «BBM Финансы» (public, 276 posts,
45 with attachments): the owner posts a fixed markdown block
(`#финансы #запрос/#счёт`, Статус/Категория/Сервис/Назначение/Сумма/Дата +
an @-mention of the approver — @eduard or @alice); others post free text;
approval arrives as an «Оплачено ✅» reply; the confirming document (one of
five real classes — RU invoice, fiscal receipt, foreign PDF invoice, payment
order, bank-app screenshot — 26 of 42 attachments are screenshots) arrives in
the same thread or weeks later. The dominant real payment is
**cross-currency**: a foreign service invoiced in USD/THB, paid from a RUB
card — two amounts, one operation.

**Artifact passport:** corpus digest + samples — session scratchpad
`mm-payments-corpus.md`, `mm-samples/` (11 files); produced by this session's
read-only export from the Mattermost production database (`tools-prod-tw`),
2026-08-26; type: **export** of the originals living in Mattermost. The
originals stay in Mattermost; the backfill (§E) works from them and from
documents the owner supplies per operation (decision 25).

Replacement: requests, entry, documents and statuses move into
`/p/finance/*`; the Mattermost channel remains a chat and gets no integration
in v1. Nothing existing in the portal changes: F1 shipped no intake surface.

## Design gate (stage 1b)

**`/p/finance/requests` — picked.** Layout **D: a kanban over the status
machine plus a details slide-over sheet** — four columns (`submitted` /
`approved, unposted` / `posted` / `refused`), the card is the intake item, and
**dragging initiates the act, never flips a status by itself** (drop → approve
act with its marking per EARS-510, refuse dialog per EARS-512, one-act post on
the attached document per EARS-511/531; illegal drops are rejected). Pick by
Антон, 2026-08-27, recorded on #339; vendored as
`design-source/finance/RequestBoard.html`, with the canvas artboards
`finance/RequestForm.dc.html` and `finance/RequestQueue.dc.html` vendored
alongside as its layout evidence. All three are **layout** only (fidelity axis,
incident 2026-08-26/#359): the visual layer is the `src/ui` kit per #359/#360,
unchanged by this pick. The build is #388.

**Amended by owner decision 35 (Антон, 2026-09-14, issue #115):** the route
stays one page, and the picked kanban becomes a **board toggle for
`finance-approve`** over a default **table** of all requests (date, submitter,
amount, purpose, status, refusal reason; «mine / all» filter with «mine»
preselected), which every signed-in member sees — approve/refuse are available
as row actions there too. The product record is `docs/product/finance/339-product.md`
→ «Design pick (Stage A)».

**Amended by owner decision 38 (Антон, 2026-11-17, BBMP-281):** the default
view becomes the **payment queue** of §I — groups by stage, three KPI sums,
one display currency, a details sheet with «как оплатить» and the mark-paid
form. Pick = the owner's «Го» on the clickable prototype, vendored verbatim
(template only, no data) as `design-source/finance/RequestPaymentQueue.html`
at `fidelity: wireframe` — it records the LAYOUT; the look stays the
shadcn/Refine row with its recorded `Design-fidelity: GO`. The table's status
and «Деньги ушли» columns go away (the group IS the status). The kanban board
toggle for `finance-approve` is unchanged, its drops following revised
EARS-510/511: a drop on «approved» only approves, a drop on «posted» opens
the mark-paid form. Build: #550 (screen), #551 (sheet).

**`/p/finance/intake` — still pending.** The manual-entry / liability workspace
has no Stage-A pick yet; it runs at #389
pickup, before any markup.

## Data model (lead-level engineering decisions)

Additions to `src/lib/platform/db/schema/finance/` (prefix `finance_`).
The spine idea: **every source produces an intake item; only intake items
post; posting calls the F1 API.** A request is an intake item with a
submitter-facing lifecycle, not a second pipeline. An intake item must be
able to express everything the backfill has to reconstruct from zero
(decision 17) — expenses, income, transfers between own accounts and
conversions — or the books cannot be rebuilt.

| Table                      | Carries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Key points                                                                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance_intake_item`      | `id`, `source` (`request`\|`manual`\|`backfill`\|`bank_import`), `source_ref` (nullable; **unique per source where set**; mandatory for `backfill`/`bank_import`, OPTIONAL for `request`/`manual` since 2026-09-22 — EARS-503 revised, #517), `kind` (`expense`\|`income`\|`transfer`\|`conversion`), `status` (`draft`\|`submitted`\|`approved`\|`refused`\|`cancelled`\|`posted`), `occurred_on` (always the date money moved, never the document's date — EARS-508; **nullable while an unposted pre-spend request has no money date yet**, filled by the posting act — EARS-533; a `posted` item always has it), `account` FK (the money account; **nullable** — empty when `personal_funds` (EARS-513), and also while an unposted pre-spend request has named no account yet (EARS-533); a `posted` non-`personal_funds` item always names one), `counter_account` FK (nullable — transfer/conversion target; a system `liability` account only per EARS-528), `amount` + `currency` (document side, bigint minimal units), `paid_amount` + `paid_currency` (nullable — the account side when it differs; for `kind = conversion` — the target side), `fee_amount` + `fee_currency` (nullable), `purpose` FK (nullable — expense only), `project` FK, `product` FK (per binding), `counterparty` FK → `finance_counterparty` (EARS-532), `member` FK (nullable — the person the payment is attributable to, spec 338 EARS-322; required for `personal_funds` and liability transfers), `note` (HUMAN TEXT only), `provenance` (jsonb, nullable — what the SOURCE recorded, immutable after submit: EARS-555, #517), `already_paid`, `personal_funds`, `created_by` → `core.member`, `created_at` (the submission moment shown as «Подана» — EARS-556), `decided_by`, `decided_at`, `refusal_reason`, `posted_by`, `posted_at`, `operation` FK (nullable, unique), `settles_item` FK → `finance_intake_item` (nullable, unique — set only on a `kind = transfer` reimbursement, naming the `personal_funds` item it settles; mandatory there except from `backfill` — EARS-528/544) | one spine for all sources (decision 3); items are editable until posted per the status machine below — the ledger stays immutable; `operation` filled at posting                                                                         |
| `finance_document`         | `id`, `storage_key` (private object storage), `content_digest` (server-computed immutable SHA-256), `storage_state` (`pending_upload`\|`ready`\|`pending_delete`), `filename`, `mime`, `size`, `kind` (`ru_invoice`\|`fiscal_receipt`\|`foreign_invoice`\|`payment_order`\|`bank_screenshot`\|`bank_statement`\|`other`), `uploaded_by`, `uploaded_at`; items linked via `finance_document_link`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | files in a **private** bucket/prefix, never the public media bucket (EARS-514); the durable state records intent before storage side effects and leaves an audited retry handle on failure; **not** in Payload — owner ruling 2026-08-26 |
| `finance_document_link`    | `document` FK, `intake_item` FK (pair unique)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **one document may confirm several items** (corpus: one screenshot proving two consultations; «$370 + $22» in one payment); the operation link is derived through each item's `operation` FK                                             |
| `finance_counterparty`     | `id`, `name` (case-insensitively unique), `created_by`, `created_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | who is being paid — a reference, not free text (owner decision 30, 2026-08-26); inline creation from the forms, renaming is admin (EARS-532)                                                                                             |
| `finance_fx_rate`          | `id`, `source` (`cbr`), `currency` (ISO code as CBR quotes it), `rate_date` (the CBR effective date, `ValCurs/@Date`), `nominal` (integer), `value_rub` (exact decimal text — roubles per `nominal` units), `auditColumns()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | §I display rates and the §J market side of comparisons only (EARS-552/553); unique (`source`, `currency`, `rate_date`); written only by the sync job (`system:finance-fx-sync`); never referenced by a posting or a conversion step      |
| `finance_purpose_proposal` | `id`, `text`, `proposed_by`, `created_at`, `resolved_purpose` FK (nullable), `resolved_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | US-21: a missing purpose is proposed as free text that only an admin can turn into a purpose — free text never becomes a purpose by itself (decision 21)                                                                                 |

**Status machine** (every transition not listed is refused — EARS-524):

- `draft` → `submitted` (creator/entry) · `draft` → deleted (creator or entry
  role, CRUD).
- `submitted` → `approved` (approve role) · → `refused` (approve role, reason
  required) · → `cancelled` (the submitter withdraws).
- `approved` → `posted` (approve role, through the explicit mark-paid act —
  EARS-543 — or the refund act — EARS-544; no document required since
  2026-11-17, EARS-506) · → `refused`
  (approve role revokes an unposted authorization, reason required).
- `submitted` → `approved` → `posted` in **one** act: «Одобрить и отметить
  оплату» / the mark-paid act / the refund act («Отметить возврат») on a
  `submitted` item records the approver as both decider and poster
  (EARS-510/543/544; the bulk act inherits it per row — EARS-547). These are
  the only one-act paths. Approving alone never posts.
- A posted `personal_funds` request is **settled** when a reimbursement
  transfer names it through `settles_item` (EARS-528/544) — the only way a
  request is settled, since every non-backfill liability transfer must name
  its item; settled is a read of that link, not a status.
- Money/dimension fields (`kind`, `account`, `counter_account`, amounts,
  currencies, `purpose`, `project`, `product`, `occurred_on`) are editable in
  `draft` and `submitted`; editing any of them in `approved` returns the item
  to `submitted` — the approval never covers data it has not seen. The one
  sanctioned exception: at the posting act the poster writes the money facts
  EARS-533 asks for — `occurred_on`, the paying `account` and the account-side
  amount — inside the posting transaction, without bouncing the item
  (EARS-508/511/533). Attaching a document (submitter or entry role) changes
  no status.
- A pre-spend request is `submitted`/`approved` with `account` and
  `occurred_on` **empty**; posting from either status is refused until
  EARS-533's act supplies them.
- `refused` / `cancelled` / `posted` are terminal; documents stay linked for
  the record.

**Cross-currency payments** (the corpus's dominant case): an expense whose
`paid_currency` differs from its `currency` posts as **one F1 operation with
module-built conversion legs** (Prior-decisions change 4). The
authoritative-amount rule: **both recorded amounts are facts and both are
authoritative** — no leg is ever computed as `amount × rate`; the rate is
derived from the pair and never used to compute an amount, so a rounding
residual cannot arise by construction. Worked example — invoice 3 500 THB
paid from the RUB card, 8 750 ₽ actually charged:

| Leg        | Account                    | Amount     |
| ---------- | -------------------------- | ---------- |
| money      | RUB card account           | −8 750 ₽   |
| conversion | system conversion account  | +8 750 ₽   |
| conversion | system conversion account  | −3 500 THB |
| expense    | the purpose's expense side | +3 500 THB |

Per-currency zero-sum (spec 338 EARS-311) holds in each currency. The module
path writes **one `finance_conversion_step` row** carrying the two recorded
amounts, with the derived rate stored as that row's informational `rate`
(recorded numeric text, spec 338 EARS-318) — the conversion postings
reference it via their `conversion_step` FK, so `realizedFxResult` and
EARS-328's FX pool read the operation exactly as any conversion; F1's FX
treatment applies unchanged. A fee, where entered, is its own posting in
`fee_currency`. For `kind = conversion` (own-account exchange) the same pair
carries the two sides — `amount`/`currency` the source,
`paid_amount`/`paid_currency` the target, **one implicit step at the actual
implied rate**; multi-step chains are not enterable through intake and go
through the F1 API directly. The two amounts are structured fields of one
item — never two prose sums (the donor form's «Сумма» / «Сумма в рублях»
ambiguity is the bug being fixed).

**Roles → claims.** Two Zitadel project roles, `finance-entry` and
`finance-approve` (decision 27), seeded and granted per the bootstrap canon
(`infra/dev-stand/idp/bootstrap.md` §5a; prod is a supervised owner-go step).
The reference catalogues are edited by `platform-admin` and by `finance-entry`
(decision 34, 2026-09-14), and `platform-admin` **no longer
implies ledger writes** (EARS-529, Prior-decisions change 1); reading
`/p/finance` stays open to every platform member, with no finance role and no
viewer role involved (EARS-530, decision 32) — **documents excluded**
(EARS-523).

**Audit coverage:** all five tables register with the audit-coverage guard
(`tools/lint/audit-coverage-lint.mjs`, spec 201) in the same PR that creates
them — the build must not discover the registration in CI.

**Document storage** is a private object-storage bucket (or provably private
prefix) — the estate's only current bucket (`bbm-portal-media`) is
deliberately public-read and is not eligible. Provisioning the private
bucket is an infra step owned by the `bbm` ops repo (Terraform is centralized
there, ADR-002 §2) — filed as a cross-repo dependency at the issue-graph
step; dev falls back to local disk exactly as the media adapter does.

## Requirements

Ids continue the flat corpus keyspace: this spec takes **EARS-501…** (spec 338
holds 301–334, spec 311 holds 401–499). One number in that range — 522 — was
retired pre-go and is now a process note under §G; the number is not reused,
and it is deliberately not written here as an id token, so no guard reads it as
a declared clause.

### A. Roles

- **EARS-501.** The finance module shall enforce exactly two flow roles
  (decision 27): `finance-entry` permits creating and editing intake items
  and uploading documents; `finance-approve` permits approving, refusing,
  posting and reversing. Every intake write from a session without the
  matching role shall be refused by the module's own handlers, however the
  URL or API is reached (spec 311 EARS-405 pattern) — with EARS-502 as the
  one deliberate carve-out.
- **EARS-529.** Reference-table administration shall remain `platform-admin`
  (spec 338 EARS-330 narrows to references — Prior-decisions change 1), and
  `platform-admin` by itself shall no longer permit ledger writes: an admin
  who does not hold `finance-approve` can no longer post or reverse (on the
  go list — this narrows a shipped spec). Reference administration is open to
  `finance-entry` as well: a holder of either `platform-admin` or
  `finance-entry` may edit the reference tables (accounts, expense categories,
  request purposes, projects, products, currencies, rates) _(owner decision 34,
  2026-09-14 — this widens the clause; the audit trail per spec 201 is
  unchanged)_.
- **EARS-530.** Reading `/p/finance` shall remain open to every platform
  member (spec 338 EARS-324/325), with document content excluded
  (EARS-523). This covers **every** reading surface of the module — the
  request list (EARS-534), register, P&L, cash flow, unit cost, break-even,
  fact-vs-finmodel, scenarios — and no
  «finance viewer» role exists: reading needs no finance role at all _(owner
  decision 32, 2026-09-14 — BBM's finance is an open book)_.
- **EARS-502.** The system shall let a signed-in platform member holding
  neither flow role, on `/p/finance/requests`, submit an expense request, edit
  their own request while it is `draft` or `submitted` (the money and dimension
  fields the status machine leaves editable there — EARS-524), cancel their own
  `submitted` request, attach documents to their own items
  and see the requests of **every** member with statuses in the list
  (decision 8, US-1, US-2) — the submitter exemption, the one deliberate
  carve-out from EARS-501. _(Amended by owner decision 35, #115, 2026-09-14:
  the list read was «their own requests» and is now every member's — the
  reading clause is EARS-534. Everything else in this clause stays OWN-only:
  editing, cancelling and submitting another member's request are still
  refused, and a document's content stays narrowed by EARS-523.)_
- **EARS-534.** The request list on `/p/finance/requests` shall show every
  signed-in platform member the requests of **every** member — date,
  submitter, amount, purpose, status, refusal reason — with no finance role
  and no viewer role involved: EARS-530's open reading plane applied to intake
  _(owner decision 35, #115, 2026-09-14 — BBM's finance is an open book, and
  this widens EARS-502's own-only list read)_. It widens **reading the list**
  and nothing else: a document's content stays readable only per EARS-523, so
  another member's row carries no document; and getting, editing, cancelling or
  submitting another member's request is still refused (EARS-502, EARS-524).
  **The purpose a request only PROPOSED is shown at this same scope** — for
  every request a member may see here the list carries the text of the request's
  PENDING purpose proposal (EARS-526), and the row and the details sheet read
  «Назначение предложено: <текст>» _(owner decision, Антон, 2026-09-16, #480 —
  a proposal's free text is part of the open book; the bare label, which said a
  purpose had been proposed and refused to say which, was the defect)_. The
  **cabinet queue** read of proposals is a different read and stays own-only
  (EARS-526): the board reads the pending proposals OF THE REQUESTS IT ALREADY
  SHOWS, never someone's queue.

### B. The intake spine (pluggable source layer)

- **EARS-503.** Every intake path shall produce an intake item carrying its
  source — one of the intake subset of the spec-338 EARS-316 enum
  (`request`\|`manual`\|`backfill`\|`bank_import`; `hours` and `reversal`
  are not intake sources) — and a `source_ref` with fixed per-source
  semantics: `bank_import` — reserved until a real statement format is scoped;
  `backfill` — **always**: the source document's number where it has one,
  otherwise the Mattermost post id, otherwise a deterministic natural key in
  the private operator dataset (date + account + amount + counterparty) — so a
  resumed one-time reconstruction can never double-post
  (EARS-504, scenario 6); `manual` and `request` — **optional**: the producer
  stores the link or identifier it was given and shall never derive one.

  _Revised 2026-09-22 — owner go, Антон, issue #517. The previous version read
  «`manual` and `request` — none (a human act has no external identity to
  deduplicate on)», and the parenthesis was right about the ACT and wrong about
  the RECORD. A request is typed somewhere before it reaches the intake — a
  Mattermost post, a ticket, a message — and the link to that place is what the
  submitter and every later reader want to follow. Forbidding the column is why
  the 47 reconstructed requests of §E carried their post id as free text inside
  `note`, which the owner read on the screen as «просто заметка в комментарии».
  What does not change: a ref is never DERIVED for a human source, so two
  separate typings of the same expense are still two items and not a duplicate;
  and where a ref IS present EARS-504's uniqueness still holds, so two requests
  cannot name one post. The database CHECK moves from an equivalence to the
  mandatory arm alone (`source IN ('bank_import','backfill')` ⟹
  `source_ref IS NOT NULL`)._

- **EARS-554.** The system shall resolve `(source, source_ref, provenance)` to
  an openable URL **server-side**, and the request surface shall render it as a
  «Источник» link: a `source_ref` that is already an http(s) address IS the
  link; a ref whose `provenance.source_system` is `mattermost` becomes the
  permalink `<origin>/<team>/pl/<post id>`, the origin and the team read from
  configuration rather than from the row; anything else resolves to nothing and
  the surface shows the identifier as text rather than a link that would 404.
  The `#<item>` suffix the reconstruction appends to disambiguate several items
  cut from ONE post (EARS-504) is an index key, not part of the post's identity,
  and is dropped when the permalink is composed.
- **EARS-555.** An intake item shall carry a `provenance` object holding what
  its SOURCE recorded, structured — `note` is human text and nothing else — and
  that object shall be **immutable after submit**: no surface and no module
  function offers an edit path for it, because where a request came from is a
  fact of the moment it was filed. The request form collects `source_ref` at
  FILING only; reopening a request for editing neither shows nor rewrites it.
  Keys that a later task promotes into real columns (the money facts, the fees,
  the period) leave `provenance` when that task consumes them.
- **EARS-556.** The submission moment of an intake item is the audit column
  `created_at` (spec 201 / ADR-004 A2), and the request surface shall show it as
  «Подана» with **date and time**, in one fixed zone — Moscow time
  (`Europe/Moscow`, the team's zone; #525 review) — never the reader's own, so
  that every reader of a shared register sees the same value for the same row. For the reconstructed corpus of §E that column is set from the source's
  own recorded instant, not from the date the reconstruction ran.
- **EARS-504.** IF an intake item arrives with a (`source`, `source_ref`)
  pair that already exists, THEN the system shall refuse that item and answer
  with the existing one.
- **EARS-505.** WHEN an intake item is posted, the system shall record the
  operation and link it to the item **atomically** — one
  `platformTransaction`, a failure of either leaves neither (Prior-decisions
  change 3: F1a's record functions learn to join a caller's transaction);
  the item's documents are carried onto the operation, `posted_by`/
  `posted_at` are recorded, and the item shall accept no further edit —
  except attaching a document (EARS-545).
- **EARS-506.** IF an intake item has no attached document, THEN the system
  shall refuse to post it through direct entry (#389) or the automated
  verifier (EARS-531 — it has nothing to verify without a document): the
  item shall wait, visibly, in the intake list, and the books shall not
  contain it until a document is attached — mandatory enrichment
  (decision 24). The one exception is an expense request (with its EARS-544
  reimbursement transfer) posted by the approve-role **human mark-paid act**
  (EARS-543/544/547): it shall post with no document, because the recorded
  act and its author are the assertion that money moved (owner decision 37);
  the receipt may be attached later (EARS-545), and until then the posting
  carries the «без чека» marker (EARS-546). The document's **kind** is not
  the gate (EARS-515): the guard against posting an unpaid invoice as a
  movement (decision 23) is the confirming act itself — the verifier
  (human in v1, agent later — EARS-511/531) asserts that money moved and,
  where a document is attached, that it corresponds, and that assertion is
  recorded to its author (owner decision 29, 2026-08-26).

  _Revised 2026-11-17 — owner decision 37, Антон, BBMP-281 prototype go
  (#547): «отметка оплаты не должна требовать подтверждающего документа».
  The previous version said: «IF an intake item has no attached document,
  THEN the system shall refuse to post it» — on every path, the human
  confirmation included. That gate kept requests whose money had already
  moved out of the books; the gate now binds direct entry and the automated
  verifier only. A deliberate requirement change, not an accidental
  relaxation._

- **EARS-507.** The system shall create no posting from any hours-module
  event (period close, publication): only an actual movement of money,
  entered through intake — with its document, or by the human mark-paid act
  of EARS-506's exception — posts (decision 23). F2 ships no automatic hours
  accrual.

  _Revised 2026-11-17 (#547): the previous version said «entered through
  intake with its document»; the documentless human mark-paid act of
  EARS-506 is the only addition._

- **EARS-525.** Adding a future source (a bank API, an AI agent) shall add a
  producer of intake items and change no other source and no posting path
  (decision 3, US-15).

### C. Expense requests

- **EARS-508.** The request form shall file an intake item of
  `kind = expense` and shall capture what the REQUESTER knows: the purpose —
  a pick from the purpose reference, no free text (decision 21; the category
  follows the purpose, spec 338 EARS-327); the project; the product, per the
  purpose's binding (spec 338 EARS-320); the amount and currency **of the
  document**; the counterparty (who is being paid — the donor form's
  «Сервис» — picked from the counterparty reference or created inline,
  EARS-532); a free-text note; attachments; and the `already_paid` flag
  (decision 12) with the `personal_funds` refinement, which shall be
  accepted only together with `already_paid`.
  The form shall **not** ask a pre-spend request (`already_paid` unset) for a
  paying account or for a money-movement date: a request is an intent, and
  neither fact exists yet — both are captured by the posting act (EARS-533).
  WHERE `already_paid` is set, the form shall additionally capture the date
  the money moved (`occurred_on` — **always** the date money moved, never the
  document's issue date, which is not stored at all: the attached file carries
  it, and that settles the corpus's three-meanings-of-«Дата» ambiguity) and
  **how** it was paid — the company account, or `personal_funds` with no
  company account at all (EARS-513) — and, WHERE the paying account's currency
  differs from the document's, the actual amount charged in the account's
  currency (the cross-currency rule above).
  WHERE the submitter holds neither `finance-entry` nor `finance-approve`, the
  form shall offer **no** company-account option and no account pick at all —
  an already-paid request from such a submitter is `personal_funds` — and the
  module's own handler shall **refuse** an `already_paid` item that arrives with
  `personal_funds` unset or that names an `account`, however the API is reached
  (EARS-501's pattern); hiding the control in the form is not the gate.

  _Revised 2026-09-03 — owner ruling, Антон, issue #388: «заявка — это
  намерение, а не платёж». The previous version demanded the paying account
  and `occurred_on` from every request, so a pre-spend request carried a
  guessed date and an account the requester had no standing to choose; both
  moved to the finance role's posting act. The account is nullable while a
  pre-spend item is unposted (data model row), and `occurred_on` is nullable
  until it posts._

  _Revised 2026-09-14 — owner decision 36, Антон, issue #115: «конечно, не
  любой сотрудник имеет доступ к корп. счетам». The company-account branch of
  the already-paid path is gated to `finance-entry` / `finance-approve`; a
  member with neither role files an already-paid request as personal funds
  only, and the API refuses the company-funds claim rather than relying on the
  form._

- **EARS-509.** WHEN a member submits a request, it shall appear in the
  approvers' queue with its documents readable in place (US-3) and in the
  member's own list; WHEN its status changes, the member shall see the new
  status without asking (US-2).
- **EARS-510.** WHEN an approver approves a request, the system shall record
  the decision and post nothing, whether or not a document is attached (an
  attached pre-spend invoice is not proof of payment). WHEN the approver
  instead submits «Одобрить и отметить оплату» on a `submitted` request — the
  EARS-543 mark-paid act, with or without a document, the retroactive
  `already_paid` path included (decision 12) — that single act shall approve
  and post the operation with the approver recorded as both decider and
  poster (US-4, US-18); no second act of entering data shall exist.

  _Revised 2026-11-17 — owner decision 37 (#547). The previous version said:
  «WHEN an approver approves a request that already carries its confirming
  document (the retroactive path — decision 12), that single act shall post
  the operation» — an attached document silently turned «approve» into
  «post». Approving alone now never posts; the one act is explicit._

- **EARS-511.** WHEN an approver approves a pre-spend request, the approval
  shall authorize the spend without posting (EARS-510). WHILE the request is
  `approved` and unposted, the system shall offer the approve role a one-act
  confirmation — the EARS-543 «Отметить оплату», with or without an attached
  document — that posts the operation from the already-entered data plus the
  money facts EARS-533 asks for: the corpus's «Оплачено ✅», with no re-entry
  of what the request already said. WHERE an automated verifier is plugged in
  (EARS-531), a document attached later (by the submitter or an entry-role
  holder — EARS-502) is what triggers it. The full transition set is the
  status machine above (EARS-524).

  _Revised 2026-11-17 — owner decision 37 (#547). The previous version said:
  «WHEN the confirming document is later attached …, the system shall offer
  the approve role a one-act confirmation» — the human confirmation waited
  for a document; now only the automated verifier does._

- **EARS-533.** The posting act on an expense request — EARS-511's one-act
  confirmation, and EARS-510's approve-and-post where the request never
  carried them — shall capture from the finance role the facts a request
  cannot know: the **paying account**, the **`occurred_on` date the money
  actually moved**, and — WHERE the paying account's currency differs from
  the document's — the **account-side amount** actually charged. A submitted
  or approved pre-spend item shall hold `account` and `occurred_on` **empty**
  until that act, and no surface shall render either emptiness as a value.
  The system shall refuse to post an item that still has no paying account
  (unless `personal_funds`, EARS-513) or no `occurred_on`, and the refusal
  shall say which of the two is missing (EARS-524's readable-answer
  property). Writing them is part of the posting transaction, not a prior
  edit: the item never passes through a state where the approval covers data
  it has not seen, and nothing bounces (the status machine's sanctioned
  in-`approved` write).

  _New 2026-09-03 — owner ruling, Антон, issue #388: the paying account and
  the money date are entered «финансистом при согласовании или подтверждении»,
  not by the requester._

- **EARS-531.** The EARS-511 confirmation shall run through a pluggable
  **document-verifier** boundary (owner decision 28, 2026-08-26): v1 ships
  exactly one verifier — the approve-role human's one-act confirmation.
  WHERE an automated verifier (an AI agent — the owner names Hermes) is
  later plugged in, a verified match of the attached document against the
  approved request shall post the operation automatically, recording the
  verifier and its verdict; any mismatch, uncertainty or verifier failure
  shall post nothing and place the item, with the verdict, in the human
  approve queue — the EARS-511 path stays as the fallback and the human act
  remains the only path for disputed items. The agent integration itself is
  out of F2 scope and is filed as its own issue at the issue-graph step.
- **EARS-512.** WHEN an approver refuses a request — from `submitted`, or
  revoking an unposted `approved` — the system shall require a reason, shall
  post nothing (US-5), and shall keep the refused request visible with its
  reason and its documents to the submitter and the approvers. Refusing an
  `already_paid` item is the approver's assertion that the claimed movement
  is **not a company expense** (the corpus's «можете не выплачивать»): the
  books deliberately record nothing, and the refused claim with its
  documents remains the record of that decision.
- **EARS-513.** WHERE a posted expense was filed with `personal_funds`, the
  item shall name **no company money account** (`account` is empty — the
  model's one nullable-account case) and the operation's money leg shall
  credit the per-currency system `liability` account instead — the liability
  IS the counter-leg, not an extra one. The liability is recorded **in the
  currency actually charged to the member** — `paid_currency`, falling back
  to `currency` — for the amount the member's card actually lost (WHERE the
  request is posted by the EARS-544 refund act, the refunded sum less the
  item's fee is that amount); a fee on a `personal_funds` item is charged to
  the same liability, in the same currency (shipped `assertFeeCurrency`), so
  the item's **liability amount** is (`paid_amount`, falling back to
  `amount`) + `fee_amount` where a fee is recorded; WHERE that
  differs from the document currency, the expense leg stays in the document
  currency and the cross-currency rule above supplies the conversion legs
  (corpus: every «оплачено с моей карты» is a USD/foreign spend from a RUB
  card — the debt to the member is in rubles). The liability posting shall
  carry the paying member's `member_id` (spec 338 EARS-322), so the debt to
  each person is the member-filtered balance of the liability account.
- **EARS-527.** The intake surface shall show a **liability view**: the
  member-filtered balances of the system liability accounts — who BBM
  currently owes and how much, per currency (scenario 5).
- **EARS-528.** A `kind = transfer` intake item may name the system
  `liability` account as its `counter_account` and shall then carry the
  `member` whose debt it settles and — on every source except `backfill` —
  the posted `personal_funds` intake item it settles (`settles_item`,
  unique): the EARS-513 reimbursement is entered exactly this way — an
  ordinary transfer debiting the liability account with the same
  `member_id`, in the settled item's liability currency and for its
  liability amount (EARS-513: `paid_amount`, falling back to `amount`, plus
  `fee_amount` where recorded — exactly the sum its posting credited to the
  liability). IF such a transfer names no `settles_item` (outside
  `backfill`), or names an item that is not a posted `personal_funds` item of
  the same member, or differs from that item's liability currency or amount,
  or names an item another transfer already settles, THEN the system shall
  refuse it and say which. This is the **only** place an intake item names a
  system account (spec 338 EARS-305 stands — the cabinet still cannot
  create, edit or retire them); `settles_item` is a column on the transfer
  item, and no separate settlement entity exists (out of scope per
  `339-product.md`). The EARS-527 liability view stays the (account, member)
  balance.

  _Revised 2026-11-17 (#547, review of PR #552). The previous version said:
  «the running link between debt and repayment is the shared (account,
  member) pair» — a pair-level transfer could repay a request while the
  queue (EARS-535) still showed it open, inviting a second refund. The link
  is now per item and mandatory, and the unique `settles_item` makes a second
  settlement of the same item impossible. `backfill` stays pair-level: §E
  reconstructs pre-portal history, which holds no portal request. A
  liability transfer posted by #466 before the column exists is linked once
  by #549's data step where exactly one posted, unsettled `personal_funds`
  item of the same member, currency and amount exists; any other is
  reported to the owner and blocks #549's production deploy until linked._

- **EARS-532.** The module shall maintain a **counterparty reference**
  (`finance_counterparty`; owner decision 30, 2026-08-26 — a reference from
  day one, not free text): the request and entry forms let the user pick an
  existing counterparty or create one inline (any submitter may — it is a
  name, not money data; names are case-insensitively unique, creation is
  audited per spec 201); renaming is reference administration
  (`platform-admin` or `finance-entry`, EARS-529); a posting carries the FK, so «what did we
  pay X» is a query. Merging duplicates is out of scope for v1 — admin
  rename covers it.
- **EARS-526.** WHERE no purpose in the reference fits, the form shall let
  the member file a free-text **purpose proposal** alongside a draft request;
  the proposal is not a purpose, appears in the reference cabinet,
  and only reference administration turning it into a real purpose (audited,
  spec 338 EARS-306) unblocks the request — free text never reaches a posting
  (decision 21, US-21). _(agent-proposed answer to US-21 — confirm at the go)_
  _(Amended 2026-09-14 by owner decision 34 (#115), shipped in #479: «an
  admin» here is reference administration, which is `platform-admin` OR
  `finance-entry` (EARS-529) — the proposal queue, its resolution and its
  dismissal follow that same gate, because `purpose-proposals.ts` asks
  `assertFinanceReferenceAccess` / `holdsFinanceReferenceRole` and holds no
  role rule of its own.)_

### D. Documents

- **EARS-514.** The finance module shall store document files in a
  **private** object-storage location with metadata in `finance_document` —
  never the public media bucket, and never the CMS: Payload is the site's
  admin and takes no part in accounting (owner ruling 2026-08-26). Uploads go
  through the module's own handlers (size- and type-limited: PDF and images),
  each recording its uploader; in dev, storage falls back to local disk. The
  system shall commit audited `pending_upload` metadata before writing bytes
  and mark the row `ready` afterward, so a storage or later database failure
  cannot leave an object without its key, metadata, uploader and audit handle.
  The pending metadata shall carry a server-computed immutable SHA-256 digest
  of the submitted bytes; recovery shall recompute it and shall never trust a
  caller-provided digest or other caller metadata as byte identity.
  An incomplete upload shall expose its document id and authenticated retry
  address. Retrying the exact bytes by that id shall be idempotent when no
  object exists, when the first write outcome was ambiguous, or when the final
  database commit failed; a different byte sequence shall be refused. A
  conditional S3 conflict shall be retried, while an already-present object
  shall be compared with the retry bytes before the upload is finalized.
- **EARS-523.** A document's content shall be readable **only** through the
  module's own authorized handler: the submitter reads documents currently
  linked to their own items; upload provenance alone grants no read;
  `finance-entry` and `finance-approve` read all. The open
  member-wide read of `/p/finance` (spec 338 EARS-324/325) shall NOT extend
  to document content, and no public or unauthenticated URL to a document
  shall exist.
- **EARS-515.** Every document shall carry a `kind` picked at upload — the
  five real classes of the corpus, a bank-statement kind reserved for a future
  real statement flow, and a rest
  bucket. The kind is **data, not a gate** (owner decision 29, 2026-08-26):
  any kind may accompany a posting, because the fact of payment is asserted
  by the confirming act (EARS-506/511/531), whose author is recorded and
  accountable. The corpus grounds this: a foreign invoice is often
  generated only at payment and IS the proof, while a RU invoice attached
  days early posts nothing until someone asserts the payment — the kind
  taxonomy feeds analytics and the future agent verifier, and any later
  tightening is a spec revision.
- **EARS-516.** IF a document is linked to a posted operation, THEN the
  system shall refuse to delete or replace it; correcting a wrong document
  is attaching another one. Documents of refused and cancelled items are
  kept with them for the record; every document write is audited (spec 201).
  Deletion shall commit `pending_delete` before removing bytes and delete the
  metadata row only afterward; either failure keeps the row and key available
  for retry. This lifecycle records durable intent and recovery state; it does
  not claim a distributed transaction between Postgres and object storage.

### E. One-time history reconstruction — operational, not a product surface

The former bulk-backfill, derivation-view and statement-import requirements are
retired unbuilt by the owner's 2026-09-01 correction. Historical Mattermost
facts are reconstructed once from a private temporary dataset, one item at a
time, through the public finance-module operations already shipped on `main`.
The temporary extractor/runner and its financial data do not enter this
repository. Categories are reviewed and created before posting so historical
postings store the approved category at creation. No runtime backfill CLI, API,
UI, dynamic category fallback or speculative bank parser is part of F2.

The retired requirement numbers 517–521 are not reused.

### H. The status machine

- **EARS-524.** The system shall refuse any intake-item transition or edit
  outside the status machine of this spec: the listed transitions with their
  role gates; the one-act `submitted` → `approved` → `posted` only through
  EARS-510, EARS-543 or EARS-544 (and EARS-547, which performs the latter
  two per row); money/dimension edits only in `draft`/`submitted`; an edit of
  those fields in `approved` returning the item to `submitted`; `refused`,
  `cancelled` and `posted` terminal; no deletion past `draft`.

### I. Owner's payment queue (2026-11-17, #547)

The requests page answers, before anything else, «что ждёт моего решения,
что пора оплатить и кому вернуть деньги — и сколько» (decisions 37–40). Every
clause below is a reading or an act over the intake spine of §B–§H; none adds
a status. Roles are unchanged: reading is open to every member (EARS-530/534),
acts are `finance-approve` (EARS-501).

**Donor & benchmark pass (§I):** the layout donor is the owner's own
clickable prototype on the 2026-11-17 prod snapshot (vendored template, no
data). The rate source is the Bank of Russia official rate because it is the
rate Russian accounting itself uses for foreign-currency amounts (ПБУ 3/2006
п. 4–5: the CBR rate on the date of the operation) — so «unpaid → today,
paid → the date money moved» is the statutory convention, not an invention,
and no owner question was spent on it. Inherited from the prototype /
justified for us: the 14-day age highlight (a request older than two weeks is
the corpus's «потерялась в канале» case).

- **EARS-535.** The system shall derive each request's queue **stage** from
  the intake spine, with no new status: `decide` — `submitted`, not
  `already_paid`; `pay` — `approved`, unposted, not `already_paid`, and also
  any unposted `already_paid` request paid from a company account (the money
  moved; the record is what is missing); `reimburse` — `already_paid` with
  `personal_funds`, in `submitted` or `approved`, or posted but not settled
  (EARS-528); `draft`; `paid` — posted, and settled where `personal_funds`;
  `refused`; `cancelled`.
- **EARS-536.** `/p/finance/requests` shall open on the scope «В работе»
  showing, in this order, the groups «Ждёт решения», «К оплате», «Вернуть
  сотруднику» and «Черновики» (collapsed by default), each with its count and
  sum; the scope «Закрытые» shall show «Оплачено», «Отклонено» and
  «Отменено»; the scope «Мои» shall show every group restricted to the
  viewer's own requests. Within a group the newest submission comes first,
  and an empty group shall say «Ничего нет».
- **EARS-537.** The page shall show three sums above the groups — «Ждёт
  решения», «К оплате», «Вернуть сотрудникам» — each with its request count,
  computed over all requests regardless of search and filters; WHEN the owner
  clicks a sum, the page shall show only that group, and a second click shall
  restore the scope's groups.
- **EARS-538.** Each queue row shall show: «Подана» (date, and the age —
  «сегодня», «вчера», «N дн. назад» — highlighted when older than 14 days in
  an active group); «От кого» (the submitter); «Кому платим» (the member for
  a `personal_funds` request, otherwise the counterparty, otherwise the
  member, otherwise «—», with «заплатил(а) сам(а)» under a member who paid);
  «На что» (the purpose, or the pending proposal per EARS-534, with the note
  underneath); «Сумма» (EARS-549). The former «Деньги ушли / ещё не
  двигались» and status columns shall not be shown.
- **EARS-539.** WHEN the owner clicks a column header, the rows of every
  group shall sort by that column, a second click reversing the order;
  «Сумма» sorts by the displayed (converted) amount; ties break by newest
  request first.
- **EARS-540.** The page shall offer a search over the request number
  («#N»), submitter, payee, member, purpose, note, project and product
  (case-insensitive substring) and filters by submitter, project and period
  of submission (7 / 30 / 90 days / all time); search and filters narrow the
  rows of every group and never the EARS-537 sums.
- **EARS-541.** WHERE the viewer holds `finance-approve`, each row shall
  carry its group's primary act — «Одобрить» (`decide`), «Отметить оплату»
  (`pay`), «Отметить возврат» (`reimburse`); a viewer without the role sees
  the same rows with no acts, and the module's handlers refuse the acts
  however reached (EARS-501).
- **EARS-542.** WHEN a row is opened, the details sheet shall show the
  amount (EARS-549, with the rate it used — «курс ЦБ на <дата> (сегодня |
  дата траты | дата оплаты)»), the fee, submitter, payee, project · product,
  note and refusal reason; a «Как оплатить» block — for `personal_funds`, who
  paid, when, and how much to return; otherwise «реквизиты есть» when the
  note contains an `http(s)://` URL or a run of 20 digits (a Russian bank
  account number), or a document is attached, else a
  warning that payment details are missing («Запросить у автора» is shown as
  text, not an act, in v1); the files (EARS-523 still governs who reads
  them); a timeline Подана → Решение → Оплата / Возврат; and the acts of its
  stage: «Одобрить», «Одобрить и отметить оплату», «Отклонить» (reason
  required, EARS-512), «Отметить оплату» / «Отметить возврат», «Отозвать»
  (revoke an unposted approval, reason required).
- **EARS-543.** WHEN the owner submits «Отметить оплату» with the date money
  moved, the paying account and — WHERE the account's currency differs from
  the document's — the amount actually debited, the system shall post the
  request in one transaction (EARS-505/533), approving it first in the same
  transaction if it was `submitted` (EARS-510); a receipt file is
  **optional**. IF the account-side amount is missing for a cross-currency
  payment, THEN the system shall refuse and say so; the amount is never
  computed from a rate (the authoritative-amount rule above). IF a
  cross-currency payment's `occurred_on` precedes the newest already-posted
  operation of the same currency pair, THEN the system shall refuse it with
  the ledger's write-order refusal (EARS-319/328 — the immutable ledger does
  not recompute an FX result it has already recognised), naming that
  operation's date and saying that earlier foreign-currency payments are to
  be marked before later ones (this text replaces the shipped message,
  which points the owner to `backfill` — #549 changes it). The guard is the
  shipped one, kept and not
  bypassed: routing the backlog through `backfill` would skip it and mis-state
  the realized FX already recognised for later dates, while marking oldest
  first needs no new machinery.
- **EARS-544.** WHEN the owner submits «Отметить возврат» on a
  `personal_funds` request with the date, the account the refund left and
  the refund amount debited from it, the system shall, in one transaction:
  approve the request first if it was `submitted` (as EARS-543; EARS-510);
  post it if it is not yet posted (EARS-505/533); and post the
  reimbursement transfer (EARS-528) for the **refund amount** in the refund
  account's currency, naming the request in `settles_item`, so that the
  member's liability for it returns to zero and the request moves to
  «Оплачено»; a receipt is optional. The refund amount is the item's whole
  liability amount (EARS-513), fee included: the act asserts that the
  member's card lost exactly the refund less the fee for the spend itself,
  and the fee on top. Posting an unposted request therefore books the
  liability in the refund account's currency, and:
  - WHERE that currency equals the document currency and the request records
    no `paid_currency`, no `paid_amount`/`paid_currency` is written (shipped
    `assertNoRedundantPaidAmount`: one currency, one authoritative amount),
    and the refund shall equal `amount` + `fee_amount`;
  - WHERE that currency differs from the document currency, the posting act
    writes `paid_amount` = refund − `fee_amount` and `paid_currency` = the
    refund currency (the status machine's sanctioned write, EARS-533), and
    the cross-currency rule supplies the conversion legs from the two
    recorded amounts (EARS-543's write-order refusal applies);
  - WHERE the unposted request already records `paid_amount`/`paid_currency`
    (the member stated what the card lost), the refund shall be in
    `paid_currency` and equal `paid_amount` + `fee_amount`, prefilled so;
    the act never overwrites the member-stated sum — correcting it is an
    ordinary edit of the request under the status machine, not part of the
    refund (it is not among EARS-533's posting-act fields).

  IF the refund amount differs from the sum these rules require, or a
  recorded fee is in another currency than the liability (shipped
  `assertFeeCurrency`), THEN the system shall refuse and name the required
  sum. IF the request is already posted, or records `paid_currency`, and its
  liability currency (`paid_currency`, falling back to `currency`) differs
  from the refund account's currency, THEN the system shall refuse and say
  so: a transfer is single-currency (EARS-528), the debt is settled by a
  refund from an account in the liability's currency, and a cross-currency
  settlement of an already-booked debt is out of scope in v1. On an already
  posted request the refund shall equal its posted liability amount.
  WHERE the act's refund date differs from the request's own `occurred_on`,
  the request posts at its own `occurred_on` (the date the member's card was
  charged — EARS-508; an `already_paid` request always carries it) and the
  reimbursement transfer at the refund date; only the bulk act (EARS-547)
  writes one row date to both. IF a cross-currency refund does not exceed the
  recorded fee, THEN the system shall refuse it and say so — nothing would be
  left for the spend itself (`paid_amount` = refund − fee must be positive).

  The `settles_item` uniqueness (EARS-528) holds among **live** transfers: a
  refused or cancelled reimbursement moved no money and frees the item again
  (a partial unique index, #549).

  _Revised 2026-11-17 (re-review of PR #552 at `42007c8`). The previous
  version did not approve a `submitted` request first and wrote the whole
  refund as `paid_amount` — with a fee the transfer could not settle the
  liability, and in the document currency a refund ≠ `amount` was refused
  by the ledger._

- **EARS-545.** The system shall let the submitter or an entry/approve-role
  holder attach a document to a **posted** request; the link is carried to
  its operation, changes no amount and no status, and is audited (spec 201);
  deleting or replacing a linked document stays refused (EARS-516). This
  narrows the shipped link guard (the migration-0014 trigger and
  `assertItemsAcceptDocument`) for `posted` items only, by a new migration;
  `refused` and `cancelled` items stay closed to new links.
- **EARS-546.** WHILE a posted request has no attached document, the queue
  row and the details sheet shall mark it «без чека».
- **EARS-547.** WHERE the viewer holds `finance-approve` and a «К оплате» or
  «Вернуть сотруднику» group shows at least two rows, the group shall offer
  «Отметить все N как оплаченные…»; WHEN the owner confirms its dialog — one
  paying account for the batch, an optional single date (default per
  request: its `occurred_on`, else its submission date, Europe/Moscow), no
  receipt — the system shall perform EARS-543 (for `pay`) or EARS-544 (for
  `reimburse`) for every eligible request of the rows shown, **all in one
  transaction** (one `txid` in `core.audit_event`, actor = the owner), in
  ascending order of the date each is posted at, then request id, so the
  batch itself never trips EARS-543's write-order refusal. A request is
  ineligible — listed in the dialog with its reason and left untouched —
  when its account-side currency (`pay`) or its liability currency
  (`reimburse`) — in both cases `paid_currency`, falling back to `currency`
  — differs from the batch account's (the debited amount is unknown; see
  Open questions Q2), or when the posting gate would refuse it for any other
  reason (a purpose missing or only proposed — EARS-526 —, a `personal_funds`
  request without its member, a missing project, EARS-543's write-order
  refusal), listed with that refusal. The submission-date default writes
  `occurred_on`, which EARS-508 defines as the date money moved: decision 40
  accepts the submission date as the best-known money date of a backlog paid
  outside the system, and covers both postings of a `reimburse` row — the
  request and its refund transfer take the same row date — and the dialog
  shows the date per row so the override can replace it. A `submitted`
  `reimburse` row is approved first in the same transaction, as EARS-544
  says; the refund amount of each row is its EARS-544 required sum. The act exists only as this confirmed UI act and its API;
  no CLI, script or agent invokes it on production.
- **EARS-548.** IF any request of a confirmed batch changed after the dialog
  was opened (its snapshot no longer matches), THEN the system shall post
  nothing for the whole batch and say which request changed.
- **EARS-549.** The page shall show every amount and sum in **one** display
  currency chosen by a ₽ / $ / € switch, ₽ by default and remembered per
  viewer; WHERE a request's own currency differs, its original amount shall
  be shown small under the converted one. Sums add converted amounts and
  round once, at display.
- **EARS-550.** The display conversion of a request shall use: for an
  unpaid request — the CBR rate for today (Moscow); for a request filed
  `already_paid` (by a member or from a company account) and not posted —
  the CBR rate on its `occurred_on`, falling back to today where it has
  none; for a posted request — the ledger's own recorded amount where the
  posting already holds the display currency (the account-side amount of a
  cross-currency payment), else the recorded conversion-step rate where it
  covers the pair, else the CBR rate on the operation's `occurred_on` (the
  date money moved, never `posted_at`).
  Cross-currency pairs go through RUB. Amounts are bigint minor units and the
  arithmetic is decimal; no floating-point value enters it.
- **EARS-551.** A USDT request shall be converted at the CBR rate of USD
  (CBR does not quote USDT; decision 41), the same rule as the §J market
  side (EARS-558). IF no CBR rate exists on or before the needed date for a
  currency (CBR does not quote it, or the date precedes the stored series),
  THEN the row shall show the original amount with «нет курса», and every
  sum that leaves it out shall say «без N заявок» — never a silent zero and
  never a wrong-currency addition.

  _Revised 2026-11-18 (owner decision 41, §J — USDT = USD applies to the
  queue display too, so one USDT request reads the same in the row, the
  sheet header and the §J block). The previous version read: «IF no CBR
  rate exists on or before the needed date for a currency (CBR does not
  quote it — USDT; or the date precedes the stored series), THEN the row
  shall show the original amount with «нет курса», and every sum that leaves
  it out shall say «без N заявок» — never a silent zero and never a
  wrong-currency addition.»_

- **EARS-552.** The finance module shall keep the Bank of Russia daily rates
  in `finance_fx_rate`, fetched from cbr.ru by an idempotent sync job that
  runs daily on the production host and can backfill a date range; a lookup
  shall return the latest stored rate whose effective date is on or before
  the requested date. WHEN the newest stored rate is more than three days
  older than today, the page shall say the rates are stale and from which
  date.
- **EARS-553.** The CBR rates shall never be a ledger source: no posting,
  conversion step, balance, F1b current-money card value or F3 period-report
  total shall read them, and no amount the ledger stores shall be computed
  from them. They shall be read only by display and comparison code — the
  §I display conversion (EARS-550) and the §J market valuation
  (EARS-557…566) — whose results are shown and never stored
  (Prior-decisions change 5, widened 2026-11-18). The isolation test holds
  three lines: the rate table is read only inside `src/lib/finance/fx/`,
  where the §J read model also lives; outside that directory the fx
  functions are used only by an explicit allowlist — the module barrel, the
  sync CLI, the requests queue (`src/app/(platform)/p/finance/requests/`)
  and the §J report route (`src/app/(platform)/p/finance/reports/market-rate/`)
  — and never by `operations.ts`, `conversions.ts`, `current-money.ts`,
  `queries.ts` or `intake/posting.ts`; and no file of the fx directory
  imports a ledger write path (`recordOperation`, `recordConversion*`,
  `appendPostings`, the intake posting functions).

  _Revised 2026-11-18 (owner decision 41, §J). The previous version read:
  «The CBR rates shall be a presentation source only: no posting, conversion
  step, balance, F1b card value or F3 report shall read them, and no amount
  the ledger stores shall be computed from them (Prior-decisions change 5).»
  It barred every report, which would have excluded the §J comparison; the
  rule now bars the ledger and its period totals, not comparisons, and names
  the allowlist the test enforces._

### J. Market valuation of foreign-currency payments (2026-11-18, #547)

The owner's question (decision 41): «сколько мы на самом деле заплатили за
валюту против курса ЦБ — в рублях, и на чём». Every clause below is a
reading: it compares what the ledger recorded with what the same payment
would have cost at the Bank of Russia rate of its date, and stores nothing.
The rates are §I's store (EARS-552) under the rewritten EARS-553. Reading is
open to every member, as the requests queue is (EARS-530/534); no clause
adds an act.

**Donor & benchmark pass (§J):** the product logic is the owner's own
personal budgeting app («Мой курс против рынка»: the market of the day the
money arrived, a 14-day nearest-previous rate window, amount-weighted period
rates, «хуже / лучше рынка» wording, missing rates counted and never
substituted) — adopted as product logic, not as code. That app reports only
the percentage; the rouble amount is the owner's addition. The CBR rate is
the market because it is the rate Russian accounting itself uses for a
foreign-currency operation on its date (ПБУ 3/2006 п. 4–5) — the same
justification as §I, so no owner question was spent on the source. USDT has
no CBR quote and is valued as USD (decision 41).

- **EARS-557.** The system shall treat as a **foreign-currency payment**
  every posted intake item of kind `expense` — from any source,
  `personal_funds` included — whose account-side currency (`paid_currency`)
  differs from its document currency, excluding an item whose operation is
  reversed and the reversal itself. Its **Факт** shall be what the account
  (or, for `personal_funds`, the member's card) actually lost — the sum
  `paid_amount + fee_amount`, both in `paid_currency` (the shipped fee rule
  keeps the fee in that currency). Its **payment date** shall be the item's
  `occurred_on` — the date money moved (EARS-508), never `posted_at`. For a
  `personal_funds` item reimbursed in another currency, Факт is the refund
  (EARS-544) and the date is the member's spend date, so its Переплата holds
  both the member's own exchange cost and the refund lag.
- **EARS-558.** The system shall value both sides in roubles at the Bank of
  Russia rate of the payment date: **Рынок** = the document amount × the CBR
  rate of the document currency, and Факт in roubles = Факт × the CBR rate of
  `paid_currency` (one for RUB). The rate of a date shall be the stored rate
  on that date or the nearest previous one (EARS-552's lookup), at most 14
  days older than the payment date and never a later one; cross pairs go
  through RUB; USDT shall be valued at the USD rate. IF either side has no
  such rate, THEN the payment shall be «без курса».
- **EARS-559.** The system shall show for a measured payment **Переплата** =
  Факт − Рынок in roubles, as a money amount, and **Переплата, %** = Факт /
  Рынок − 1; a positive value shall read «хуже рынка на X,X%», a negative one
  «лучше рынка на X,X%» (the amount with its sign, the words carrying the
  direction), and a percentage that rounds to 0,0 «как на рынке». Amounts are
  bigint minor units, the arithmetic is decimal and exact, and rounding
  happens once, at display (one decimal for the percentage, kopecks for the
  amount); no floating-point value enters it.
- **EARS-560.** IF an `already_paid` request is not yet posted and its
  debit currency — the named account's currency, else its stated
  `paid_currency` — differs from its document currency, or is unknown (no
  account and no `paid_currency`) on a non-RUB document, THEN it shall be
  «факт не внесён» — the money moved, but what it cost is not in the ledger
  yet, even where the request states an amount (Факт is a ledger fact, the
  same predicate as EARS-557). It shall be counted in a period by its
  `occurred_on`, else by its submission date (EARS-556). A «факт не внесён»
  or a «без курса» item shall be left out of every Факт, Рынок and Переплата
  sum and counted separately, by kind, wherever such a sum is shown — never
  converted 1:1, never a silent zero.
- **EARS-561.** The system shall measure every recorded conversion operation
  (spec 338 EARS-318, `src/lib/finance/conversions.ts`, multi-step chains
  such as RUB → USDT → USD included) as one **chain**. An operation is a
  chain when it owns at least one `finance_conversion_step`, carries no
  purpose, is itself no reversal (`reverses` is empty) and has not been
  reversed; a reversal of a conversion, a same-currency transfer and an
  income own no step and are never chains. For a chain: Факт =
  what left the source money account in the operation (its net outflow, the
  fees it bore included), valued in roubles; Рынок = what arrived on the
  target money account (its net inflow, net of fees), valued in roubles —
  both at the CBR rates of the operation's `occurred_on` (the arrival date;
  a chain is one operation with one date), under EARS-558's rate rule
  (USDT as USD); and Переплата per EARS-559. The conversion legs that an
  intake expense's own posting builds (Prior-decisions change 4) belong to
  that payment (EARS-557), not to a separate chain. A chain's **route** is
  its currency path in step order («RUB → USDT → USD»).

  _Revised 2026-11-18 (#558, lead's re-review of #560): the chain definition
  is now stated by the ledger's shape. The previous version read «The system
  shall measure every recorded conversion operation (…), not reversed, as one
  **chain**: Факт = …», which left a reversal of a conversion (it copies the
  null purpose) and a plain same-currency transfer readable as chains._

- **EARS-562.** Every aggregate of payments and chains — a period, a month,
  a payee, a route — shall be weighted by amount: Σ Переплата = Σ Факт −
  Σ Рынок and its % = Σ Факт / Σ Рынок − 1 over the measured items only
  (EARS-560), never the mean of the items' percentages. The % is computed
  from the rouble figures (EARS-558), so no display currency changes it
  (EARS-566).
- **EARS-563.** WHEN the details sheet (EARS-542) shows a posted
  foreign-currency payment or a «факт не внесён» request (EARS-560), it
  shall carry a «Курс против рынка» block:
  «Рынок» with the CBR rate and its date, «Факт» with the account it left
  and the fee inside it, and «Переплата» as the amount and the EARS-559
  wording; the amounts in the display currency (EARS-549, converted per
  EARS-566). For a «без курса» payment the block shall say «нет курса ЦБ на
  <дата>»; for a «факт не внесён» request that states no debited amount it
  shall say «факт не внесён — укажите списанную сумму при отметке оплаты»;
  for one that states it (a `personal_funds` request's amount is the
  member's and stays authoritative, EARS-544) it shall say «факт не
  проведён — появится после «Отметить возврат»» for `personal_funds` and
  «…после «Отметить оплату»» otherwise; a same-currency request shall show
  no block.
- **EARS-564.** `/p/finance/reports/market-rate` «Курс против рынка»,
  linked from the `/p/finance` header beside «Заявки», shall show, for a
  chosen period of payment dates (month, quarter, year, the last 12 months
  — the default —, all time): Σ Переплата as an amount and its weighted %
  with the EARS-559 wording, Σ Факт, Σ Рынок, the number of payments and
  chains measured, and the counts «без курса: N» and «факт не внесён: N»
  (EARS-560).
- **EARS-565.** The report shall break the period down by **month** and by
  **payee / route** — payments by the EARS-538 «Кому платим» payee with
  their route (the paying account, or «свои средства» for `personal_funds`,
  and the currency pair), chains by their EARS-561 route — each row with
  Факт, Рынок, Переплата and its weighted % (EARS-562), so that each table
  sums to the period total; WHEN a row is opened, the report shall list the
  payments and chains behind it with their date, document amount, Рынок,
  Факт and Переплата, a payment linking to its request.
- **EARS-566.** The report shall show its amounts in the display currency
  of EARS-549 (₽ / $ / €, the same remembered per-viewer choice as the
  requests queue), converting each item's rouble figures at the CBR rate of
  its own payment date before any sum; a percentage shall not change with
  the display currency — it is the EARS-562 % of the rouble figures of every
  measured item. IF the display currency has no rate for an item's date
  under EARS-558's rule, THEN that item shall be left out of the displayed
  sums and counted «без курса: N», as in EARS-551; it still counts in the
  percentage, which no display-currency rate enters.

  _Revised 2026-11-18 (#558, lead's re-review of #560): the previous version
  ended «…a percentage shall not change with the display currency. IF the
  display currency has no rate for an item's date under EARS-558's rule, THEN
  that item shall be left out of the displayed sums and counted «без курса:
  N», as in EARS-551.» — read literally, dropping such an item from the sums
  would have moved the % with the display currency._

## CRUD check (task-cycle stage 1a)

| Resource                                | Create                                                                                                                                  | Read                                                                                                                                                                                                                                                        | Update                                                                                                                                           | Delete                                                                                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| requests (`/p/finance/requests`)        | any platform member (EARS-502)                                                                                                          | the list — every platform member (EARS-534); one request — own (submitter) or entry/approve roles; documents — EARS-523                                                                                                                                     | submitter/entry in `draft`/`submitted`; edit in `approved` → back to `submitted` (EARS-524)                                                      | no hard delete past `draft`; submitter cancels own `submitted`; approver refuses (EARS-512)                                                                                                        |
| request source link (`source_ref`)      | **yes** — an optional «Ссылка на источник» on the request form, at FILING (EARS-503 revised, EARS-554)                                  | **yes** — «Источник» in the details sheet and a link icon on the register row; the URL is resolved server-side and a ref that resolves to nothing is shown as text (EARS-554)                                                                               | **no** — provenance is a fact of the moment the request was filed, so it is immutable after submit and no surface offers an edit path (EARS-555) | **no** — deleting the link would leave a request claiming no origin while the record says it had one; a wrong link is a correction the submitter asks the entry role for, on the record (EARS-555) |
| provenance (`provenance` jsonb)         | producers only — the reconstruction of §E writes it; no human surface does                                                              | not rendered on any surface yet — its keys are what the money-facts children of this wave lift into real fields                                                                                                                                             | **no** — immutable after submit (EARS-555)                                                                                                       | **no** — same clause                                                                                                                                                                               |
| intake items (`/p/finance/intake`)      | `finance-entry` (manual); request producers                                                                                             | entry/approve roles                                                                                                                                                                                                                                         | entry role per the status machine; **never after `posted`** (EARS-505)                                                                           | creator or entry role deletes `draft` only (status machine); later — refuse/cancel, not delete                                                                                                     |
| documents                               | submitter on own items; entry role anywhere                                                                                             | submitter — own items' docs; entry/approve — all (EARS-523)                                                                                                                                                                                                 | `kind` only, while no linked item is posted                                                                                                      | while unlinked or linked only to mutable items; `refused`/`cancelled`/`posted` retain them (EARS-516)                                                                                              |
| counterparties                          | any member inline from the forms; entry role (EARS-532)                                                                                 | every finance reader                                                                                                                                                                                                                                        | rename — reference administration: admin or entry (EARS-529)                                                                                     | none (referenced by postings); merge out of scope in v1                                                                                                                                            |
| purpose proposals                       | any platform member from the request form (EARS-526)                                                                                    | reference administration — admin or entry (EARS-529) sees the cabinet QUEUE, and the proposer sees own; the PENDING proposal TEXT of a request on the list — every platform member, at EARS-534's open-book scope (owner decision, Антон, 2026-09-16, #480) | reference administration resolves into a real purpose (EARS-529)                                                                                 | reference administration dismisses (EARS-529); the proposal record stays                                                                                                                           |
| approvals (approve/refuse/confirm-post) | `finance-approve` only (EARS-501); the posting act also enters the paying account, `occurred_on` and the account-side amount (EARS-533) | queue — approve role                                                                                                                                                                                                                                        | n/a — a decision is not edited; a wrong posting is corrected by reversal                                                                         | n/a                                                                                                                                                                                                |

Deliberately unsupported: editing or deleting anything already posted (the
ledger's own EARS-313 stands); posting without a document on any path but
the human mark-paid act (EARS-506);
free-text purpose (decision 21; proposals are not purposes — EARS-526);
income, transfers and conversions **through the request form** — those enter
via the entry role (manual/backfill); `personal_funds` without `already_paid`
(EARS-508); multi-step conversion chains through intake (one implicit step
only — the F1 API takes the rest); any cabinet surface for the calendar
(#372).
The §J market valuation (Рынок / Факт / Переплата) is not a resource: it is
computed at read time from the ledger and the CBR store, has no create, edit
or delete path anywhere, and is never stored (EARS-553); correcting a wrong
Факт is correcting the payment's own record (reversal, EARS-313).

## Acceptance scenarios

Owner walkthrough on a live stand, after the go and the build. The
walkthrough runs on F2's own surfaces (`/p/finance/requests`,
`/p/finance/intake`) — where a step wants the F1b balances card or the F3
register, that dependency is named in the step:

1. **Two roles exist and bite.** Sign in as a member with neither role:
   `/p/finance/requests` lets you file a request with an invoice attached and
   shows the list of EVERY member's requests, with «мои» preselected and no
   document on someone else's row (EARS-534/EARS-523);
   `/p/finance/intake` refuses (EARS-501/502). Grant
   `finance-entry` to a test user (an IdP console act —
   `infra/dev-stand/idp/bootstrap.md` §5a) — the intake list opens, the
   approve actions are still refused (EARS-501).
2. **Request → approval → books, one act.** File a request «уже оплачено» in
   THB paid from a RUB card (both amounts), receipt attached; as an approver,
   «Одобрить и отметить оплату» — one act, the item shows `posted` with your
   name (plain «Одобрить» would only approve), and the
   intake item opens the operation with the receipt readable from it
   (EARS-508/509/510, EARS-505; register browsing beyond the item — F1b/F3).
3. **Pre-spend path.** File a request without a receipt — the form asks for
   no account and no date (EARS-508), and the card shows neither. Approve it
   — the item is `approved`, nothing posted (EARS-506/511). Attach the
   receipt and confirm: the confirmation asks for the paying account and the
   date the money really moved (and the charged amount if that account is in
   another currency) — with either missing it refuses and says which; with
   both it is `posted` and the operation carries them (EARS-511/533). Edit
   test: change the amount while it was `approved` — the item drops back to
   `submitted` and asks for re-approval (EARS-524).
4. **Refusal.** Refuse a request without a reason — the form insists; with a
   reason — the submitter sees the refusal, its documents stay readable, and
   nothing posted (EARS-512/516).
5. **Personal funds.** File «оплачено своими средствами», approve — the
   posted operation's money leg sits on the liability account with your
   member id; the intake list's liability view shows the debt to you
   (EARS-513/527).
6. **Missing purpose.** On the request form, find no fitting purpose — file
   the proposal; as admin, turn it into a purpose; the request becomes
   submittable with it (EARS-526).
7. **Documents are private.** Copy a document's URL from your session, open
   it signed out and as a role-less member on someone else's item — refused
   both times (EARS-514/523).
8. **The queue (§I).** Sign in as the approver on a stand seeded with
   requests in every stage: the page opens on «В работе» with «Ждёт
   решения», «К оплате», «Вернуть сотруднику» and a collapsed «Черновики»;
   the three sums on top match the group totals; clicking «К оплате» leaves
   only that group. Search «#<id>» finds the one request; the period filter
   narrows the rows but not the sums. As a member without `finance-approve`
   the same groups show with no buttons (EARS-535…541).
9. **One currency.** Switch ₽ → $: every amount and sum changes; a USD request
   viewed in ₽ shows its dollars small underneath, and its sheet names the
   CBR rate and its date — today for an unpaid request, the spend date for a
   member's own payment (EARS-549/550). A USDT request is converted at the
   USD rate, its sheet naming the USD rate and its date; a request in a
   currency CBR does not quote shows «нет курса» and the sums say «без 1
   заявки» (EARS-551 revised).
10. **Paid without a receipt.** Open an approved pre-spend request with no
    file: «Как оплатить» warns that details are missing. «Отметить оплату»
    with a date and a RUB account and no file — it moves to «Оплачено» marked
    «без чека». Attach the receipt from the sheet — the marker goes away
    (EARS-506/542/543/545/546). On a USD request paid from the RUB account
    the form refuses until the debited roubles are entered (EARS-543).
11. **Reimbursement.** On a USD «Вернуть сотруднику» request «Отметить
    возврат» from the RUB account with the roubles refunded — it moves to
    «Оплачено», its operation shows the debt booked in roubles for that sum,
    and the member's RUB liability balance drops by exactly it (EARS-544).
12. **The backlog, in bulk.** On «К оплате» press «Отметить все N как
    оплаченные…»: the dialog shows the count, the sum, one account, and lists
    the cross-currency requests it leaves out. Confirm — the rest move to
    «Оплачено» «без чека», dated by their own dates. Repeat after editing one
    request in another tab — nothing posts and the dialog names the changed
    request (EARS-547/548). This scenario runs on a stand, never on
    production by an agent.
13. **When it was filed, and where** (#517). On `/p/finance/requests` the
    register's first column is «Подана» and carries a date AND a time. Open
    request 6 of the reconstructed corpus — «Higgsfield Ultra» — and the sheet
    says «Подана 20.04.2026 17:21» (14:21:39Z in МСК) and offers a «Источник» link that opens the
    Mattermost post `q41r3h4nxjnozgft493okar9tw` in a new tab
    (EARS-554/556). Its «Комментарий» is a sentence again: no
    `source_system=` / `source_post_id=` line is anywhere on the screen
    (EARS-555). File a new request with a link pasted into «Ссылка на источник»
    — it appears as «Источник» in the sheet; file one with `см. в чате` typed
    there instead — the field refuses it and says what shape is wanted, and
    nothing is filed (EARS-503 revised). Open a request that has no source at
    all — the sheet shows «—» and the row carries no link (EARS-554).
14. **Курс против рынка (§J).** On a stand seeded with CBR rates and three
    posted payments — USD 100 paid from the RUB account for 9 384 ₽ incl. a
    50 ₽ fee on a day the CBR USD rate is 92,00; a USD 100 personal-funds
    request reimbursed for 9 016 ₽; a USDT invoice paid in roubles — plus one
    RUB → USDT → USD conversion and one already-paid USD request with no
    debited amount: open the first request — its sheet says «Рынок 9 200 ₽
    (курс ЦБ на <дата>)», «Факт 9 384 ₽», «Переплата +184 ₽ · хуже рынка на
    2,0%»; the second says «лучше рынка на 2,0%»; the third is valued at the
    USD rate; the unposted one says «факт не внесён» (EARS-557…560, 563).
    Open «Курс против рынка» from `/p/finance`: the period total is the sum
    of the measured rows, its % equals Σ Факт / Σ Рынок − 1 (not the mean of
    the rows' %), the conversion is listed under its route «RUB → USDT →
    USD», «факт не внесён: 1» is counted and not summed; delete the stand's
    CBR rates for the 15 days up to and including the conversion's date (so
    no rate within EARS-558's 14-day window remains) and it moves to «без
    курса: 1»
    (EARS-561/562/564/565). Switch ₽ → $: the amounts change, the
    percentages do not (EARS-566).

### Verified by CI, not by the owner

TDD tests named `it('EARS-N: …')` (stage 3) cover every clause of this spec —
the role gates and the narrowing (EARS-501/502/529/530), spine semantics and
per-line idempotency (EARS-503/504), atomic posting (EARS-505), the
document gate (EARS-506) with kinds as data (EARS-515), no hours-event
posting (EARS-507), form validation incl. cross-currency and
`personal_funds`⇒`already_paid` (EARS-508), status visibility (EARS-509),
one-act posting and the verifier boundary (EARS-510/511/531), the money
facts the posting act enters and the refusals when they are missing
(EARS-533),
refusal incl. `already_paid` (EARS-512), the liability counter-leg with
`member_id` and its currency rule (EARS-513), the liability view (EARS-527),
the reimbursement route (EARS-528), storage privacy and access
(EARS-514/523), document immutability and retention (EARS-516), the status
machine (EARS-524), producer isolation (EARS-525), the counterparty
reference (EARS-532), purpose proposals
(EARS-526), the owner's payment queue — stage derivation, groups, sums,
columns, sort, search, filters and role-gated acts (EARS-535…542), the
mark-paid, reimbursement, attach-later and «без чека» acts
(EARS-543…546), the bulk act and its all-or-nothing refusal
(EARS-547/548), the display currency, its rate rule and missing-rate
behaviour (EARS-549…551), the CBR rate store and its isolation from the
ledger (EARS-552/553), the market valuation of payments and chains, its
missing-fact / missing-rate exclusions and weighted aggregates
(EARS-557…562), the details-sheet block (EARS-563) and the «Курс против
рынка» report (EARS-564…566) — plus `pnpm boundaries` green on the module (ADR-004 §6).

## Out of scope

- What a posting is — spec 338. Reports, register UI beyond what F1 shipped,
  P&L, unit cost — **F3 (#340)**; reconciliation — **F4 (#341)**; scenarios —
  **F5 (#342)**.
- **The payment calendar** — #372, its own brainstorm (decision 26).
- Permanent bulk-backfill/import APIs, CLIs or UIs. The historical transfer is
  one-time private operator work under §E.
- Bank statement parsing/import until a real statement and a recurring product
  need are supplied and separately approved; bank APIs and AI-agent entry are
  future sources, not F2 deliverables.
- The AI-agent document verifier integration (Hermes) — the slot is designed
  in (EARS-531), the integration is its own follow-up issue (decision 28).
- Automatic hours-accrual posting — ruled out by decision 23; whether the
  entry form later pre-fills a payout from hours data is deferred to
  practice, unbuilt here.
- Reimbursement settlement workflow beyond the liability postings of
  EARS-513 (`339-product.md`).
- Merging duplicate counterparties — v1 has admin rename only (EARS-532).
- Payment execution: F2 records that money moved, it moves nothing.
- Payload/CMS: untouched by design (EARS-514).
- The payment calendar — #372; requested-vs-paid amounts, fees, payer and
  service period on the request — #518 and its children.
- Sending «Запросить у автора» (a notification to the submitter) — v1 shows
  the missing-details warning only; a follow-up after the §I acceptance.
- Any use of the CBR rates by the ledger — postings, conversion steps,
  balances, the F1b current-money card, F3 period totals — (EARS-553); the
  current-money valuation stays on recorded rates (#425). Display (§I) and
  comparison (§J) are the only readers.
- A crypto price source — USDT is valued as USD (decision 41); a holding's
  gain or loss between purchase and disposal is not separated from the
  exchange cost (a chain is one operation with one date, EARS-561).
- Running the EARS-547 bulk act on production by an agent — it is the
  owner's own act from the UI.

## Open questions

None. The go-list below was walked with the owner **one item at a time** and
each item confirmed — Антон, 2026-08-26, in session (the go is recorded on
#339; decisions 28–30 are appended to the #115 decision log). Kept as the
record of what the go covered:

1. The decision-27 mapping: submitting a request stays open to any platform
   login (decision 8); `finance-entry` gates direct entry (EARS-501/502).
2. `platform-admin` alone loses ledger writes: an admin without
   `finance-approve` can no longer post or reverse (EARS-529 — narrows
   shipped spec 338 EARS-330 and its acceptance scenario 3).
3. EARS-511's one-act confirmation for the pre-spend path.
4. Prior-decisions change 2 is superseded by the 2026-09-01 correction:
   historical categories are approved before posting; no dynamic read-time
   reclassification behavior is introduced.
5. The document gate: any kind of document may accompany a posting — the
   guard against posting an unpaid invoice is the confirming act (human in
   v1, agent verifier later), recorded to its author (EARS-506/515/531 —
   decision 29).
6. Documents demand a **private** storage location — a new infra step in the
   `bbm` ops repo (the current media bucket is public by design).
7. The counterparty reference (EARS-532): picked or created inline on the
   form, renamed by the admin — decision 30.
8. The purpose-proposal path for a missing purpose (EARS-526) —
   agent-proposed, confirmed.

Confirmed with amendments taken during the walk: item 3 → the verifier
boundary (decision 28, EARS-531 — v1 human confirmation, Hermes agent later,
its integration a follow-up issue); item 5 → kinds are data, the confirming
act is the guard (decision 29, EARS-506/515); item 7 → counterparty is a
reference from day one (decision 30, EARS-532).

### Open questions — §I (2026-11-17, #547)

- **Q1 — the go on this delta.** The owner's «Го» (2026-11-17) was given on
  the clickable prototype. Decisions 37–40 and EARS-535…553 transcribe it,
  and the lead-level calls listed below are not in the prototype; the
  implementation issues #548–#551 do not start before the owner confirms this
  text on PR review (task-cycle stage 2). Lead-level calls, for the record:
  an unposted `already_paid` request paid from a company account sits in «К
  оплате» (EARS-535); «Отменено» is a third closed group; «Отметить возврат»
  books the debt AND its settlement in one act, linked by `settles_item`
  (EARS-544, EARS-528 revised); the bulk act is all-or-nothing (EARS-548);
  rates older than three days are flagged stale (EARS-552). Added after the
  independent review of PR #552: every non-backfill reimbursement transfer
  must name the item it settles (EARS-528); the refund act books the debt in
  the refunded currency, for the refund less the fee, and approves a
  `submitted` request first (EARS-544, re-review); cross-currency marks keep the
  ledger's write-order refusal, and the bulk act posts oldest first
  (EARS-543/547); attach-later opens `posted` items only, `refused` and
  `cancelled` stay closed (EARS-545).
- **Q2 — cross-currency requests in the bulk act.** 16 of the 39 backlog
  requests (2026-11-17 snapshot: 8 of 25 «К оплате» — 1 EUR, 7 USD — and
  8 of 14 «Вернуть сотруднику», USD) are in a foreign currency, and the
  amount the RUB account or card actually lost is unknown. Two answers, both
  expressible in this text: **(a) actual per item** — the default: EARS-547
  leaves them out, and each is marked one by one through EARS-543/544 with
  the real debited amount; **(b) CBR-estimated** — an owner exception to the
  authoritative-amount rule and to EARS-553: the bulk act writes
  `paid_amount` from the CBR rate of the item's date, flagged «сумма
  списания оценена по курсу ЦБ». Owner's fork; until answered, (a) stands.
  Under either answer the items post cross-currency, so EARS-543's
  write-order refusal applies: they have to be marked **oldest first and
  before any later-dated operation of their currency pair is posted** —
  once a newer USD or EUR conversion is in the ledger, an older backlog item
  of that pair can no longer be posted live. Checked on production
  2026-11-17: the ledger holds **0 operations and 0 conversion steps**, so no
  existing later-dated FX record blocks oldest-first posting of the
  backlog; the risk is only that someone posts a newer cross-currency
  operation before the backlog is marked.
  **Answered 2026-11-18 — (a), actual per item** (owner decision 41,
  Антон): cross-currency backlog requests take their real debited amount one
  by one, and the market side is computed by §J. A CBR-estimated actual
  would make the overpayment of exactly those requests zero by
  construction.

### Open questions — §J (2026-11-18, #547)

- **Q3 — the go on this delta.** The owner's «Го» (2026-11-18) was given on
  the product rule (decision 41); EARS-557…566 and the EARS-553 rewrite
  transcribe it, and #558/#559 do not start before the owner confirms this
  text on PR review. Lead-level calls, for the record: only **posted**
  items are measured — an unposted already-paid foreign-currency request is
  «факт не внесён» even when it states an amount, because Факт is a ledger
  fact (EARS-557/560), and it is dated by its `occurred_on`, else its
  submission date, for the period counts; both sides are valued in roubles at the CBR rates of one
  date, so a payment from a non-RUB account (THB invoice from a USD card)
  is measured too (EARS-558); a conversion's Факт is the source account's
  net outflow and its Рынок the target account's net inflow, so every fee
  in the chain is inside the figure (EARS-561); «как на рынке» is a
  percentage that rounds to 0,0 (EARS-559); the report's default period is
  the last 12 months and it sits at `/p/finance/reports/market-rate`, the
  first route of the F3 reports area, until F3 (#340) builds that area's
  navigation (EARS-564).
- **Q4 — USDT in the requests queue display. Closed 2026-11-18 (lead's
  decision, final).** Decision 41's USDT = USD applies to the §I queue display
  too, so one USDT request reads the same in the row, the sheet header and
  the §J block: EARS-551 is rewritten (previous wording recorded under it),
  scenario 9 and #550's acceptance criteria follow.
