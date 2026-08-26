---
status: Draft
issue: 339
updated: 2026-08-26
---

# Finance F2 — filling the ledger: requests, documents, backfill, intake layer — spec (issue #339)

- **Issues:** #339 (this spec, the F2 parent under epic #115). The build split
  into sub-issues is proposed after the stage-2 go via `spec-issue-graph`; the
  numbers are written back here when filed. The UI surfaces plug into the
  portal-workspace frame exactly as F1b does: they are blocked by #314 (`/p`
  launcher/registry) and #315 (`/p/admin` shell), while the intake backend
  (spine, roles, documents, posting) is buildable on merged F1a (#356) alone —
  the graph records that split with edges, not prose.

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
An independent spec review ran before the go (2026-08-26, session record);
its blockers and majors are folded into this revision.

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
   widening: EARS-501 narrows EARS-330 to reference administration, and the
   F1a guard (`assertFinanceWriteAccess`) is reworked so ledger writes are
   gated by the two flow roles instead. The spec-338 text of EARS-330 is
   amended in this spec's PR (the spec is `In dev`; in-place amendment is its
   own precedent, EARS-328).
2. **The reclassification journal is not built.** Spec 338 ruling 2 promised
   «a true reclassification journal arrives with F2». This spec replaces it
   with read-time category resolution (EARS-520) and keeps reversal as the
   only correction; the ruling-2 sentence is amended in this spec's PR. This
   drops a stated expectation of an owner-accepted spec — **explicitly on the
   go list**.
3. **An internal F1a refactor** — `recordOperation`/`recordConversion` learn
   to run inside a caller-supplied `platformTransaction` (today they open
   their own), so posting an intake item is atomic (EARS-505). Module-private
   signatures, no spec-338 text change.

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
submitter-facing lifecycle, not a second pipeline. An intake item must be
able to express everything the backfill has to reconstruct from zero
(decision 17) — expenses, income, transfers between own accounts and
conversions — or the books cannot be rebuilt.

| Table                      | Carries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Key points                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance_intake_item`      | `id`, `source` (`request`\|`manual`\|`backfill`\|`bank_import`), `source_ref` (nullable; **unique per source where set**), `kind` (`expense`\|`income`\|`transfer`\|`conversion`), `status` (`draft`\|`submitted`\|`approved`\|`refused`\|`cancelled`\|`posted`), `occurred_on`, `account` FK (the money account), `counter_account` FK (nullable — transfer/conversion target), `amount` + `currency` (document side, bigint minimal units), `paid_amount` + `paid_currency` (nullable — the account side when it differs), `fee_amount` (nullable, conversions), `purpose` FK (nullable — expense only), `project` FK, `product` FK (per binding), `counterparty` (text), `note`, `already_paid`, `personal_funds`, `created_by` → `core.member`, `decided_by`, `decided_at`, `refusal_reason`, `posted_by`, `posted_at`, `operation` FK (nullable, unique) | one spine for all sources (decision 3); items are editable until posted per the status machine below — the ledger stays immutable; `operation` filled at posting |
| `finance_document`         | `id`, `storage_key` (private object storage), `filename`, `mime`, `size`, `kind` (`ru_invoice`\|`fiscal_receipt`\|`foreign_invoice`\|`payment_order`\|`bank_screenshot`\|`other`), `intake_item` FK (nullable), `operation` FK (nullable), `uploaded_by`, `uploaded_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | files in a **private** bucket/prefix, never the public media bucket (EARS-514); **not** in Payload — owner ruling 2026-08-26                                     |
| `finance_purpose_proposal` | `id`, `text`, `proposed_by`, `created_at`, `resolved_purpose` FK (nullable), `resolved_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | US-21: a missing purpose is proposed as free text that only an admin can turn into a purpose — free text never becomes a purpose by itself (decision 21)         |

**Status machine** (every transition not listed is refused — EARS-524):

- `draft` → `submitted` (creator/entry) · `draft` → deleted (creator, CRUD).
- `submitted` → `approved` (approve role) · → `refused` (approve role, reason
  required) · → `cancelled` (the submitter withdraws).
- `approved` → `posted` (approve role; document gate EARS-506; one act when
  the document was already there — EARS-510) · → `refused` (approve role
  revokes an unposted authorization, reason required).
- Money/dimension fields (`kind`, `account`, `counter_account`, amounts,
  currencies, `purpose`, `project`, `product`, `occurred_on`) are editable in
  `draft` and `submitted`; editing any of them in `approved` returns the item
  to `submitted` — the approval never covers data it has not seen. Attaching
  a document (submitter or entry role) changes no status.
- `refused` / `cancelled` / `posted` are terminal; documents stay linked for
  the record.

**Cross-currency payments** (the corpus's dominant case): an expense whose
`paid_currency` differs from its `currency` posts as one F1 operation — a
conversion step from the paying account's currency at the **actual** rate
implied by the two amounts (spec 338 EARS-318, decision 18), the expense legs
in the document's currency, fees explicit where entered. The two amounts are
structured fields of one item — never two prose sums (the donor form's
«Сумма» / «Сумма в рублях» ambiguity is the bug being fixed).

**Roles → claims.** Two Zitadel project roles, `finance-entry` and
`finance-approve` (decision 27), seeded and granted per the bootstrap canon
(`infra/dev-stand/idp/bootstrap.md` §5a; prod is a supervised owner-go step).
`platform-admin` continues to gate the reference catalogues and **no longer
implies ledger writes** (Prior-decisions change 1); reading `/p/finance`
stays open to every platform member (spec 338 EARS-324/325) — **documents
excluded** (EARS-523).

**Document storage** is a private object-storage bucket (or provably private
prefix) — the estate's only current bucket (`bbm-portal-media`) is
deliberately public-read and is not eligible. Provisioning the private
bucket is an infra step owned by the `bbm` ops repo (Terraform is centralized
there, ADR-002 §2) — filed as a cross-repo dependency at the issue-graph
step; dev falls back to local disk exactly as the media adapter does.

## Requirements

Ids continue the flat corpus keyspace: this spec takes **EARS-501…** (spec 338
holds 301–334, spec 311 holds 401–499).

### A. Roles

- **EARS-501.** The finance module shall enforce exactly two flow roles
  (decision 27): `finance-entry` permits creating and editing intake items
  and uploading documents; `finance-approve` permits approving, refusing,
  posting and reversing. Reference-table administration remains
  `platform-admin` (spec 338 EARS-330 narrows to references — Prior-decisions
  change 1), and `platform-admin` by itself shall no longer permit ledger
  writes; reading `/p/finance` remains open to every platform member
  (spec 338 EARS-324/325), documents excluded (EARS-523).
- **EARS-502.** WHEN a signed-in platform member without either role opens
  `/p/finance/requests`, the system shall let them submit an expense request,
  cancel their own `submitted` request, attach documents to their own items
  and see their own requests with statuses (decision 8, US-1, US-2) — this
  submitter exemption is the one deliberate carve-out from EARS-501; every
  other intake write shall be refused by the module's own handlers for a
  session without the matching role, however the URL or API is reached
  (spec 311 EARS-405 pattern).

### B. The intake spine (pluggable source layer)

- **EARS-503.** Every intake path shall produce an intake item carrying its
  source — one of the spec-338 EARS-316 enum — and a `source_ref` with fixed
  per-source semantics: `bank_import` — the statement line's stable identity,
  always; `backfill` — the source document's identity (a Mattermost post id,
  a document number) **where one exists**; `manual` and `request` — none (a
  human act has no external identity to deduplicate on).
- **EARS-504.** IF an intake item arrives with a (`source`, `source_ref`)
  pair that already exists, THEN the system shall refuse that item and answer
  with the existing one; in a bulk arrival (an import file, a backfill batch)
  the refusal is **per line** — duplicates are skipped and reported, the rest
  proceed (US-8).
- **EARS-505.** WHEN an intake item is posted, the system shall record the
  operation and link it to the item **atomically** — one
  `platformTransaction`, a failure of either leaves neither (Prior-decisions
  change 3: F1a's record functions learn to join a caller's transaction);
  the item's documents are carried onto the operation, `posted_by`/
  `posted_at` are recorded, and the item shall accept no further edit.
- **EARS-506.** IF an intake item has no attached confirming document, THEN
  the system shall refuse to post it: the item shall wait, visibly, in the
  intake list, and the books shall not contain it until the document is
  attached — mandatory enrichment (decision 24).
- **EARS-507.** The system shall create no posting from any hours-module
  event (period close, publication): only an actual movement of money,
  entered through intake with its document, posts (decision 23). F2 ships no
  automatic hours accrual.
- **EARS-525.** Adding a future source (a bank API, an AI agent) shall add a
  producer of intake items and change no other source and no posting path
  (decision 3, US-15).

### C. Expense requests

- **EARS-508.** The request form shall file an intake item of
  `kind = expense` and shall capture: the purpose — a pick from the purpose
  reference, no free text (decision 21; the category follows the purpose,
  spec 338 EARS-327); the project; the product, per the purpose's binding
  (spec 338 EARS-320); the paying account; the amount and currency **of the
  document**, and — WHERE the paying account's currency differs — the actual
  amount charged in the account's currency (the cross-currency rule above);
  the counterparty (who is being paid — the donor form's «Сервис», free text
  in v1, a reference candidate for #372); the operation date, labeled for
  what it is; a free-text note; attachments; and the `already_paid` flag
  (decision 12) with the `personal_funds` refinement, which shall be
  accepted only together with `already_paid`.
- **EARS-509.** WHEN a member submits a request, it shall appear in the
  approvers' queue with its documents readable in place (US-3) and in the
  member's own list; WHEN its status changes, the member shall see the new
  status without asking (US-2).
- **EARS-510.** WHEN an approver approves a request that already carries its
  confirming document (the retroactive path — decision 12), that single act
  shall post the operation with the approver recorded as both decider and
  poster (US-4, US-18); no second act of entering data shall exist.
- **EARS-511.** WHEN an approver approves a pre-spend request that has no
  confirming document yet, the approval shall authorize the spend without
  posting (EARS-506); WHEN the confirming document is later attached (by the
  submitter or an entry-role holder — EARS-502), the system shall offer the
  approve role a one-act confirmation that posts the operation from the
  already-entered data — the corpus's «Оплачено ✅», with no re-entry. The
  full transition set is the status machine above (EARS-524).
- **EARS-512.** WHEN an approver refuses a request — from `submitted`, or
  revoking an unposted `approved` — the system shall require a reason, shall
  post nothing (US-5), and shall keep the refused request visible with its
  reason and its documents to the submitter and the approvers.
- **EARS-513.** WHERE a posted expense was filed with `personal_funds`, the
  operation's money leg shall credit the per-currency system `liability`
  account **instead of** a company money account — the liability IS the
  counter-leg, not an extra one — and that liability posting shall carry the
  paying member's `member_id` (spec 338 EARS-322), so the debt to each person
  is the member-filtered balance of the liability account. The later
  reimbursement is an ordinary transfer operation debiting the same liability
  account with the same `member_id`; the running link between debt and
  repayment is that shared (account, member) pair, and no separate
  settlement entity exists (out of scope per `339-product.md`).
- **EARS-526.** WHERE no purpose in the reference fits, the form shall let
  the member file a free-text **purpose proposal** alongside a draft request;
  the proposal is not a purpose, appears in the admin's reference cabinet,
  and only an admin turning it into a real purpose (audited, spec 338
  EARS-306) unblocks the request — free text never reaches a posting
  (decision 21, US-21). _(agent-proposed answer to US-21 — confirm at the go)_

### D. Documents

- **EARS-514.** The finance module shall store document files in a
  **private** object-storage location with metadata in `finance_document` —
  never the public media bucket, and never the CMS: Payload is the site's
  admin and takes no part in accounting (owner ruling 2026-08-26). Uploads go
  through the module's own handlers (size- and type-limited: PDF and images),
  each recording its uploader; in dev, storage falls back to local disk.
- **EARS-523.** A document's content shall be readable **only** through the
  module's own authorized handler: the submitter reads documents of their own
  items; `finance-entry` and `finance-approve` read all. The open
  member-wide read of `/p/finance` (spec 338 EARS-324/325) shall NOT extend
  to document content, and no public or unauthenticated URL to a document
  shall exist.
- **EARS-515.** Every document shall carry a `kind` picked at upload — RU
  invoice, fiscal receipt, foreign invoice, payment order, bank-app
  screenshot, other — the five real classes of the corpus plus a rest
  bucket; any kind satisfies EARS-506 in v1, and the kind is data for later
  tightening, not a gate today.
- **EARS-516.** IF a document is linked to a posted operation, THEN the
  system shall refuse to delete or replace it; correcting a wrong document
  is attaching another one. Documents of refused and cancelled items are
  kept with them for the record; every document write is audited (spec 201).

### E. History backfill

- **EARS-517.** The intake surface shall offer bulk entry — many rows, one
  save — creating intake items with `source = backfill` of any kind
  (expense, income, transfer, conversion: everything the reconstruction of
  real balances from zero requires — decision 17, US-13, US-22; spec 338
  EARS-317), posting as backdated operations (spec 338 EARS-316), with each
  row's `source_ref` filled per EARS-503 where the source document has an
  identity.
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
- **EARS-520.** WHERE a posting stores no category (recorded before the
  taxonomy existed) and its purpose is linked to one, every query and report
  shall resolve the category through the purpose's **current** link at read
  time; a posting with a stored category keeps it (spec 338 EARS-327), and
  recorded postings are never rewritten (spec 338 EARS-309/332). The stated
  consequence: re-linking a purpose re-reads only its pre-taxonomy history —
  deliberate, those postings were never classified. F2 therefore ships
  **no** posting-mutation reclassification: a genuinely wrong dimension is
  corrected by reversal (spec 338 EARS-313/314); the F1a register/balance
  queries gain the read-time fallback, and the spec-338 ruling-2 journal
  sentence is amended in this PR (Prior-decisions change 2 — on the go list).

### G. Bank-statement import — contract now, build on real statements

- **EARS-521.** Statement import shall be an intake producer and nothing
  more: it parses a statement file into draft intake items
  (`source = bank_import`, `source_ref` = the line's stable identity, the
  statement itself linked as the confirming document), deduplicated per line
  (EARS-504), reviewed and posted through the same queue by the same roles.
  Nothing posts on upload alone.
- **EARS-522.** WHERE real statement files are supplied, the format parser
  shall be built against those files and nothing else (owner ruling
  2026-08-26, decision 25); until then the import ships as the contract
  above with no parser, and this deliberately blocks nothing else in F2.

### H. The status machine

- **EARS-524.** The system shall refuse any intake-item transition or edit
  outside the status machine of this spec: the listed transitions with their
  role gates; money/dimension edits only in `draft`/`submitted`; an edit of
  those fields in `approved` returning the item to `submitted`; `refused`,
  `cancelled` and `posted` terminal; no deletion past `draft`.

## CRUD check (task-cycle stage 1a)

| Resource                                | Create                                                      | Read                                                        | Update                                                                                      | Delete                                                                                      |
| --------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| requests (`/p/finance/requests`)        | any platform member (EARS-502)                              | own — the submitter; all — entry/approve roles              | submitter/entry in `draft`/`submitted`; edit in `approved` → back to `submitted` (EARS-524) | no hard delete past `draft`; submitter cancels own `submitted`; approver refuses (EARS-512) |
| intake items (`/p/finance/intake`)      | `finance-entry` (manual, backfill bulk); producers (import) | entry/approve roles                                         | entry role per the status machine; **never after `posted`** (EARS-505)                      | entry role deletes `draft` only; later — refuse/cancel, not delete                          |
| documents                               | submitter on own items; entry role anywhere                 | submitter — own items' docs; entry/approve — all (EARS-523) | `kind` only, while its item is unposted                                                     | while unlinked or on an unposted item; linked to a posted operation — never (EARS-516)      |
| purpose proposals                       | any platform member from the request form (EARS-526)        | admin (reference cabinet), proposer sees own                | admin resolves into a real purpose                                                          | admin dismisses; the proposal record stays                                                  |
| approvals (approve/refuse/confirm-post) | `finance-approve` only (EARS-501)                           | queue — approve role                                        | n/a — a decision is not edited; a wrong posting is corrected by reversal                    | n/a                                                                                         |

Deliberately unsupported: editing or deleting anything already posted (the
ledger's own EARS-313 stands); posting without a document (EARS-506);
free-text purpose (decision 21; proposals are not purposes — EARS-526);
income, transfers and conversions **through the request form** — those enter
via the entry role (manual/backfill); `personal_funds` without `already_paid`
(EARS-508); any cabinet surface for the calendar (#372).

## Acceptance scenarios

Owner walkthrough on a live stand, after the go and the build. The
walkthrough runs on F2's own surfaces (`/p/finance/requests`,
`/p/finance/intake`) — where a step wants the F1b balances card or the F3
register, that dependency is named in the step:

1. **Two roles exist and bite.** Sign in as a member with neither role:
   `/p/finance/requests` lets you file a request with an invoice attached and
   shows your list; `/p/finance/intake` refuses (EARS-501/502). Grant
   `finance-entry` to a test user — the intake list opens, the approve
   actions are still refused (EARS-501).
2. **Request → approval → books, one act.** File a request «уже оплачено» in
   THB paid from a RUB card (both amounts), receipt attached; as an approver,
   approve it — one act, the item shows `posted` with your name, and the
   intake item opens the operation with the receipt readable from it
   (EARS-508/509/510, EARS-505; register browsing beyond the item — F1b/F3).
3. **Pre-spend path.** File a request without a receipt; approve it — the
   item is `approved`, nothing posted (EARS-506/511). Attach the receipt,
   confirm — `posted` (EARS-511). Edit test: change the amount while it was
   `approved` — the item drops back to `submitted` and asks for re-approval
   (EARS-524).
4. **Refusal.** Refuse a request without a reason — the form insists; with a
   reason — the submitter sees the refusal, its documents stay readable, and
   nothing posted (EARS-512/516).
5. **Personal funds.** File «оплачено своими средствами», approve — the
   posted operation's money leg sits on the liability account with your
   member id; the intake list's liability view shows the debt to you
   (EARS-513).
6. **Backfill in bulk.** Open the bulk entry, enter three historical rows
   from real Mattermost receipts — an expense, a transfer, a conversion —
   attach documents, post (EARS-517/518). Re-enter the same rows with the
   same source refs — refused per line, originals pointed at (EARS-503/504).
7. **Derivation input.** Open the derivation view — spend grouped by purpose,
   uncategorised postings listed; add a category, link a purpose to it — the
   pre-taxonomy postings now read that category without any rewrite
   (EARS-519/520).
8. **Missing purpose.** On the request form, find no fitting purpose — file
   the proposal; as admin, turn it into a purpose; the request becomes
   submittable with it (EARS-526).
9. **Documents are private.** Copy a document's URL from your session, open
   it signed out and as a role-less member on someone else's item — refused
   both times (EARS-514/523).

### Verified by CI, not by the owner

TDD tests named `it('EARS-N: …')` (stage 3) cover every clause of this spec —
the role gates (EARS-501/502), spine semantics and per-line idempotency
(EARS-503/504), atomic posting (EARS-505), the document gate (EARS-506), no
hours-event posting (EARS-507), form validation incl. cross-currency and
`personal_funds`⇒`already_paid` (EARS-508), status visibility (EARS-509),
one-act posting (EARS-510/511), refusal (EARS-512), the liability counter-leg
with `member_id` (EARS-513), storage privacy and access (EARS-514/523), the
document kind (EARS-515), document immutability and retention (EARS-516),
backfill kinds and flags (EARS-517/518), the derivation query (EARS-519),
read-time resolution (EARS-520), the import contract (EARS-521/522), the
status machine (EARS-524), producer isolation (EARS-525), purpose proposals
(EARS-526) — plus `pnpm boundaries` green on the module (ADR-004 §6).

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
- A vendor/counterparty reference table — `counterparty` is free text in v1
  (EARS-508), promoted to a reference when #372 needs it.
- Payment execution: F2 records that money moved, it moves nothing.
- Payload/CMS: untouched by design (EARS-514).

## Open questions

None left open for the build. Items the owner confirms **at the go**, listed
so none rides in silently:

1. The decision-27 mapping: submitting a request stays open to any platform
   login (decision 8); `finance-entry` gates direct entry (EARS-501/502).
2. EARS-511's one-act confirmation for the pre-spend path.
3. Prior-decisions change 2: the spec-338 reclassification-journal promise is
   replaced by read-time resolution + reversal (EARS-520).
4. Documents demand a **private** storage location — a new infra step in the
   `bbm` ops repo (the current media bucket is public by design).
5. Agent-proposed details: the `counterparty` free-text field (EARS-508) and
   the purpose-proposal path (EARS-526).
