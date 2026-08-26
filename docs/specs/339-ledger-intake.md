---
status: Draft
issue: 339
updated: 2026-08-26
---

# Finance F2 — filling the ledger: requests, documents, backfill, intake layer — spec (issue #339)

- **Issues:** #339 (this spec, the F2 parent under epic #115). The build split
  into sub-issues is proposed after the stage-2 go via `spec-issue-graph`; the
  numbers are written back here when filed.

## Why

F1 (#338) defined what a fact of money is; F2 is how facts reach the ledger.
The owner ruled that reaching it must not be his own typing (decision 3), and
the corpus shows what happens without a system: requests and receipts live as
markdown posts and attachments in one Mattermost channel, currencies are
written three different ways, «дата» means three different things, and the
link from a request to its payment fact arrives weeks later as a separate
post. F2 replaces that channel with a structured intake: expense requests
with documents, direct entry, history backfill — all flowing into the F1
ledger through one pluggable layer, gated by two roles and by the rule that
**nothing posts without its confirming document** (decision 24).

Product source: `docs/product/finance/339-product.md` (US-1…US-22); owner
decisions 1–27 live in the #115 issue body — decisions 23–27 were taken in
this spec's session (2026-08-26). The de-facto request corpus is analysed in
the session scratchpad (`mm-payments-corpus.md`; see «Current behavior»).

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
  (EARS-311), the source enum and `source_ref` columns (EARS-316), purpose →
  category coupling (EARS-327), `product_binding` as master data
  (EARS-320/331), no allocations (EARS-334), no opening balances (EARS-317).
  F1 EARS-330 explicitly holds every write at `platform-admin` **until the F2
  role model widens it** — this spec is that widening.

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
the same thread or weeks later.

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

**Pending — no markup before the pick.** The request form, the member's
request list and the intake/approval queue are new surfaces: 2–3 layout
options go to the owner, the pick is recorded on #339 and vendored into
`design-source/finance/` on first touch. The epic's wireframe canvas
(2026-08-25) contains F2 artboards — they are **layout** evidence only
(fidelity axis, incident 2026-08-26/#359): the visual layer follows the
`src/ui` kit and the admin-shell design, and vendoring is coordinated with the
parallel session working `design-source`/`src/ui` (#360/#359).

## Data model (lead-level engineering decisions)

Additions to `src/lib/platform/db/schema/finance/` (prefix `finance_`).
The spine idea: **every source produces an intake item; only intake items
post; posting calls the F1 API.** A request is an intake item with a
submitter-facing lifecycle, not a second pipeline.

| Table                 | Carries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Key points                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `finance_intake_item` | `id`, `source` (`request`\|`manual`\|`backfill`\|`bank_import`), `source_ref` (nullable text; unique per source where set), `status` (`draft`\|`submitted`\|`approved`\|`refused`\|`posted`), `occurred_on`, `purpose` FK, `project` FK, `product` FK (nullable per binding), `amount` (bigint, minimal units), `currency` FK, `note`, `already_paid`, `personal_funds`, `created_by` → `core.member`, `decided_by`, `decided_at`, `refusal_reason`, `operation` FK (nullable, unique) | one spine for all sources (decision 3); `operation` filled at posting; items are editable until posted — the ledger stays immutable |
| `finance_document`    | `id`, `storage_key` (S3), `filename`, `mime`, `size`, `kind` (`ru_invoice`\|`fiscal_receipt`\|`foreign_invoice`\|`payment_order`\|`bank_screenshot`\|`other`), `intake_item` FK (nullable), `operation` FK (nullable), `uploaded_by`, `uploaded_at`                                                                                                                                                                                                                                    | files in the platform's object storage (same Timeweb S3 bucket, module-owned prefix), **not** in Payload — owner ruling 2026-08-26  |

Payment calendar tables are deliberately absent — #372, its own brainstorm.

**Roles → claims.** Two Zitadel project roles, `finance-entry` and
`finance-approve` (decision 27), seeded and granted per the bootstrap canon
(`infra/dev-stand/idp/bootstrap.md` §5a; prod is a supervised owner-go step).
`platform-admin` continues to gate the reference catalogues (F1 EARS-330's
scope shrinks to references); reading `/p/finance` stays open to every
platform member (F1 EARS-324/325).

## Requirements

Ids continue the flat corpus keyspace: this spec takes **EARS-501…** (spec 338
holds 301–334, spec 311 holds 401–499).

### A. Roles

- **EARS-501.** The finance module shall enforce exactly two flow roles
  (decision 27): `finance-entry` permits creating and editing intake items
  and uploading documents; `finance-approve` permits approving, refusing,
  confirming posting and reversing operations. Reference-table
  administration remains `platform-admin` (spec 338 EARS-330 narrows to
  references); reading `/p/finance` remains open to every platform member
  (spec 338 EARS-324/325).
- **EARS-502.** WHEN a signed-in platform member without either role opens
  `/p/finance/requests`, the system shall still let them submit an expense
  request and see their own requests with statuses (decision 8, US-1, US-2);
  every other intake write shall be refused by the module's own handlers for
  a session without the matching role, however the URL or API is reached
  (spec 311 EARS-405 pattern).

### B. The intake spine (pluggable source layer)

- **EARS-503.** Every intake path shall produce an intake item carrying its
  source — one of the spec-338 EARS-316 enum — and, where the source has a
  stable external identity, a `source_ref`; adding a future source (bank API,
  AI agent) shall add a producer of intake items and change no other source
  and no posting path (decision 3, US-15).
- **EARS-504.** IF an intake item with the same (`source`, `source_ref`)
  already exists, THEN the system shall refuse the duplicate and answer with
  the existing item — importing or re-running a source twice shall never
  create two items or two operations (US-8, US-11 analogue).
- **EARS-505.** WHEN an intake item is posted, the system shall record the
  operation through the F1 module API in the same transaction, link the
  operation to the item, carry the item's documents onto the operation, and
  refuse any further edit of the item; the item is the operation's
  provenance.
- **EARS-506.** IF an intake item carries no confirming document, THEN the
  system shall refuse to post it: the item shall wait, visibly, in the
  intake list, and the books shall not contain it until the document is
  attached — mandatory enrichment (decision 24).
- **EARS-507.** The system shall create no posting from any hours-module
  event (period close, publication): only an actual movement of money,
  entered through intake with its document, posts (decision 23). F2 ships no
  automatic hours accrual.

### C. Expense requests

- **EARS-508.** The request form shall capture: the purpose — a pick from the
  purpose reference, no free text (decision 21; the category follows the
  purpose, spec 338 EARS-327); the project; the product, required/forbidden/
  optional per the purpose's binding (spec 338 EARS-320); the amount and its
  currency as one structured pair in the currency's minimal units — never
  «сумма в рублях» beside «сумма в валюте» as separate prose fields; the
  operation date, labeled for what it is; a free-text note; attachments; and
  the `already_paid` flag with `personal_funds` refinement (decision 12).
- **EARS-509.** WHEN a member submits a request, it shall appear in the
  approvers' queue with its documents readable in place (US-3) and in the
  member's own list; WHEN its status changes, the member shall see the new
  status without asking (US-2).
- **EARS-510.** WHEN an approver approves a request that already carries its
  confirming document (the retroactive path — decision 12), that single act
  shall post the operation with the approver recorded (US-4, US-18); no
  second act of entering data shall exist.
- **EARS-511.** WHEN an approver approves a pre-spend request that has no
  confirming document yet, the approval shall authorize the spend without
  posting (EARS-506); WHEN the confirming document is later attached, the
  system shall offer the approver a one-act confirmation that posts the
  operation from the already-entered data — the corpus's «Оплачено ✅», with
  no re-entry.
- **EARS-512.** WHEN an approver refuses a request, the system shall require
  a reason, shall post nothing (US-5), and shall keep the refused request
  visible with its reason to the submitter and the approvers.
- **EARS-513.** WHERE a posted operation originated from a request filed with
  `personal_funds`, the operation shall record, alongside the expense, the
  liability to the paying member on the system `liability` account (spec 338
  account kinds), so «долг в сторону BBM» is a balance, not a chat memory;
  the reimbursement itself is a later ordinary operation clearing that
  liability. Settlement workflow beyond these postings is out of scope
  (`339-product.md`).

### D. Documents

- **EARS-514.** The finance module shall store document files in the
  platform's object storage (the estate's S3 bucket, a module-owned prefix)
  with metadata in `finance_document` — never in the CMS: Payload is the
  site's admin and takes no part in accounting (owner ruling 2026-08-26).
  Uploads go through the module's own handlers (size- and type-limited: PDF
  and images), each recording its uploader.
- **EARS-515.** Every document shall carry a `kind` picked at upload — RU
  invoice, fiscal receipt, foreign invoice, payment order, bank-app
  screenshot, other — the five real classes of the corpus plus a rest
  bucket; any kind satisfies EARS-506 in v1, and the kind is data for later
  tightening, not a gate today.
- **EARS-516.** IF a document is linked to a posted operation, THEN the
  system shall refuse to delete or replace it; correcting a wrong document
  is attaching another one, and every document write is audited (spec 201).

### E. History backfill

- **EARS-517.** The intake surface shall offer bulk entry — many rows, one
  save — creating intake items with `source = backfill` that post as
  backdated operations (spec 338 EARS-316), starting from BBM's first
  operation with every account opening at zero (decision 17, US-13, US-22;
  spec 338 EARS-317).
- **EARS-518.** A backfilled item shall pass the same gates as a live one —
  the document rule (EARS-506) and the approve-role posting — and the
  resulting operation shall behave in every report exactly like a live one
  while staying distinguishable by its source and `backdated` flag (US-14).

### F. Category derivation

- **EARS-519.** The module shall expose the derivation query: recorded spend
  grouped by purpose, with postings that carry no category listed — the
  input from which the owner derives and approves the category list
  (decision 11); the list itself is then created as ordinary, audited
  reference edits (spec 338 EARS-301/307/308), and no seed ships.
- **EARS-520.** WHERE a posting stores no category and its purpose has since
  been linked to one, every query and report shall resolve the category
  through the purpose → category link at read time; recorded postings are
  never rewritten (spec 338 EARS-309/332). Consequently F2 ships **no**
  posting-mutation reclassification: a genuinely wrong dimension is
  corrected by reversal (spec 338 EARS-313/314), and the spec-338 ruling-2
  sentence that promised a «true reclassification journal» to F2 is amended
  in this spec's PR.

### G. Bank-statement import — contract now, build on real statements

- **EARS-521.** Statement import shall be an intake producer and nothing
  more: it parses a statement file into draft intake items
  (`source = bank_import`, `source_ref` = the line's stable identity, the
  statement itself linked as the confirming document), deduplicated by
  EARS-504, reviewed and posted through the same queue by the same roles.
  Nothing posts on upload alone.
- **EARS-522.** The parser for a concrete bank format shall be built only
  against real statement files (owner ruling 2026-08-26, decision 25 — not
  theoretical formats); until such files are supplied, the import ships as
  the contract above with no format parser, and this deliberately blocks
  nothing else in F2.

## CRUD check (task-cycle stage 1a)

| Resource                                | Create                                                      | Read                                           | Update                                                                                     | Delete                                                                                 |
| --------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| requests (`/p/finance/requests`)        | any platform member (EARS-502)                              | own — the submitter; all — entry/approve roles | submitter while `submitted`; refused/posted — never                                        | no delete: a mistaken request is refused (own request — cancellable while `submitted`) |
| intake items (`/p/finance/intake`)      | `finance-entry` (manual, backfill bulk); producers (import) | entry/approve roles                            | entry role while `draft`/`submitted`/`approved`; **never after `posted`** (EARS-505)       | entry role while `draft`; later — refuse, not delete                                   |
| documents                               | submitter on own request; entry role anywhere               | with the item/operation they belong to         | `kind` only, while unposted                                                                | while unlinked or on an unposted item; linked to a posted operation — never (EARS-516) |
| approvals (approve/refuse/confirm-post) | `finance-approve` only (EARS-501)                           | queue — approve role                           | n/a — a decision is not edited; a wrong approval is corrected by reversal of the operation | n/a                                                                                    |

Deliberately unsupported: editing or deleting anything already posted (the
ledger's own EARS-313 stands); posting without a document (EARS-506); free-text
purpose (decision 21); any cabinet surface for the calendar (#372).

## Acceptance scenarios

Owner walkthrough on a live stand, after the go and the build (each names its
clauses):

1. **Two roles exist and bite.** Sign in as a member with neither role:
   `/p/finance/requests` lets you file a request with an invoice attached and
   shows your list; `/p/finance/intake` refuses (EARS-501/502). Grant
   `finance-entry` to a test user — the intake list opens, the approve
   actions are still refused (EARS-501).
2. **Request → approval → books, one act.** File a request «уже оплачено» with
   a receipt attached; as an approver, approve it — the operation appears in
   the register with the receipt openable from it, and no one typed the data
   twice (EARS-508/509/510/513-if-personal, spec 338 EARS-320/327).
3. **Pre-spend path.** File a request without a receipt; approve it — the
   books show nothing (EARS-506/511). Attach the receipt, confirm — now it
   posts (EARS-511).
4. **Refusal.** Refuse a request without a reason — the form insists; with a
   reason — the submitter sees the refusal and the ledger holds nothing
   (EARS-512).
5. **Backfill in bulk.** Open the bulk entry, enter three historical
   operations from real Mattermost receipts, attach documents, post — the
   register shows them backdated, balances move from zero (EARS-517/518).
6. **Nothing doubles.** Re-submit the same backfill rows with the same
   source refs — the system refuses duplicates and points at the existing
   items (EARS-504).
7. **Derivation input.** Open the derivation view — spend grouped by purpose,
   uncategorised postings listed; add a category, link a purpose to it — the
   old postings now read that category in the register without any rewrite
   (EARS-519/520).

### Verified by CI, not by the owner

TDD tests named `it('EARS-N: …')` (stage 3): role gates (EARS-501/502), the
spine and idempotency (EARS-503/504/505), the document gate (EARS-506), no
hours-event posting (EARS-507), the liability leg for personal funds
(EARS-513), storage boundaries and document immutability after posting
(EARS-514/516), backfill flags (EARS-517/518), read-time category resolution
(EARS-520), the import contract (EARS-521) — plus `pnpm boundaries` green on
the module (ADR-004 §6).

## Out of scope

- What a posting is — spec 338. Reports, register UI beyond what F1 shipped,
  P&L, unit cost — **F3 (#340)**; reconciliation — **F4 (#341)**; scenarios —
  **F5 (#342)**.
- **The payment calendar** — #372, its own brainstorm (decision 26).
- Bank **format parsers** until real statements are supplied (EARS-522);
  bank APIs, AI-agent entry — future producers by design (decision 3).
- Automatic hours-accrual posting — ruled out by decision 23; whether the
  entry form later pre-fills a payout from hours data is deferred to
  practice, unbuilt here.
- Reimbursement settlement workflow beyond the liability postings of
  EARS-513 (`339-product.md`).
- Payment execution: F2 records that money moved, it moves nothing.
- Payload/CMS: untouched by design (EARS-514).

## Open questions

None for the owner. Decisions 23–27 (this session) closed: hours accruals
(23), enter-now-enrich-later (24), bank statements not a blocker + corpus
source (25), the payment calendar routed to #372 (26), the two-role model
(27). Two lead readings are flagged inline for confirmation **at the go**,
not as blockers: the decision-27 mapping (requests stay open to any member;
`finance-entry` gates direct entry) and EARS-511's one-act confirmation for
the pre-spend path.
