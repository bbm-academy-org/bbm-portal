---
status: Draft
epic: finance (#115) — see ./brief.md
surface: user-facing
updated: 2026-08-31
---

# F2 — Filling the ledger: manual entry, expense requests, history reconstruction (#339)

## Feature summary

The ledger is only as good as what reaches it. F2 provides the permanent ways
new facts enter it: **manual entry** and **expense requests with confirming
documents**. The finite history from before the finance system existed is
reconstructed once as delivery work; it is not a product workflow that the
owner must operate forever.

**Future sources may join the same ledger, but they are defined from evidence.**
The owner's intent (decision 3) remains that sources can vary — manual entry,
API pulls or agent entry — without creating a second ledger. F2 does not invent
a bank-statement producer, parser or review flow before real statement files
exist. A concrete source is scoped only when its real inputs are available.

**Confirmed owner ruling (2026-08-31):** the historical reconstruction is a
one-time agent/operator job run directly against the finance database from the
original Mattermost production database and file storage. It is not a permanent
bulk-intake backend, endpoint or user-facing bulk-entry screen. The owner reviews
the proposed reconstruction before it is applied.

**Roles (decision 8):** the whole team submits expense requests — any platform
login, invoice attached. Owners approve, and approval is what posts to the
ledger; that is a claim-gated role. The gate mechanics are the workspace's
(epic #112, feature #313), not re-decided here.

**Both expense paths are in scope — owner ruling, decision 12 (owner
2026-08-25).** The pre-spend request is the normal path: ask, get approved,
spend. Money that was already spent is filed **retroactively through the same
form**, and it still passes owner approval before anything is posted. There is
one form, one queue and one approval act; the difference between the two paths is
only whether the money had already left when the request was filed. This settles
the approve-then-spend vs record-what-was-spent fork that this PRD previously
carried as an open question.

**The expense taxonomy is derived here, not shipped with F1 — decision 11.**
The one-time reconstruction gives the owner the real-spend evidence from which
to approve the initial category list; it then lives on as the editable reference
table F1 defines. Nothing seeds it in advance. Historical operations without a
stored category follow their purpose's current category whenever they are read,
so approving or changing the purpose mapping does not rewrite history.

**The purpose of a request is a pick, not prose — owner ruling, decision 21
(owner 2026-08-25).** "What for" is chosen from the **purpose reference**
(«справочник назначений») that F1 (#338) owns: finer-grained than the category
list, each purpose linked to its expense category, so the category follows from
the pick. The purpose is **a reference pick, not free text** — «максимально
упрощаем и систематизируем всё».

**The reconstruction starts at the first operation ever — decision 17 (owner
2026-08-25).** The operator locates it in the original Mattermost history; from
there the books run forward, accounts open at zero, and balances come from the
reconstructed operations themselves. No opening-balance entry is filed.

Everything written by this feature obeys F1's rules: immutable postings,
reversal instead of edits, amount in the currency's minimal units, the project
dimension on every entry.

## Design pick (Stage A)

_Partly run._ The expense-request form and queue have their recorded pick. The
permanent manual-entry and liability workspace still needs its own Stage-A pick
before markup. Historical reconstruction and bank-statement import have no UI in
the current scope.

## User stories

- **US-1** — As a team member, I submit an expense request with the amount, the
  currency, what it is for — **picked from the purpose reference**, not typed —
  the project, the product where the expense is attributable to one, and the
  invoice or receipt attached, so spending starts with a request instead of a
  message. _(decisions 6, 8, 21, 22)_
- **US-18** — As a team member who has already spent the money, I file it on the
  same form after the fact, and it goes through the same owner approval before it
  is posted — nothing is recorded around the approval just because the money has
  already left. _(decision 12)_
- **US-19** — As an owner, I approve the initial expense categories from the real
  spend found during reconstruction and can change purpose-to-category mappings
  later; historical operations then appear under the current category without
  being rewritten. _(decision 11; confirmed owner ruling 2026-08-31)_
- **US-2** — As a team member, I can see what happened to my request — waiting,
  approved, refused — without asking. _(`agent-proposed — UNCONFIRMED`; decision
  6 fixes the request, not the status view)_
- **US-3** — As an owner, I see the queue of requests waiting for me, each with
  its invoice, and approve or refuse it. _(decisions 6, 8)_
- **US-4** — As an owner, approving a request is what puts the expense in the
  ledger — there is no second act of entering it by hand. _(decision 8)_
- **US-5** — As an owner, a request I refuse leaves no trace in the ledger, and
  the refusal is visible to the person who submitted it.
  _(`agent-proposed — UNCONFIRMED`)_
- **US-6** — As an owner, the invoice stays attached to the resulting operation,
  so a number in the register can be opened and its document read. _(decision 6)_
- **US-7 — Retired from the current scope.** A bank-statement flow will be
  defined only from real statement files in a separately approved task; F2 does
  not promise an upload experience in advance. _(confirmed owner ruling
  2026-08-31)_
- **US-8 — Retired with US-7.** Duplicate handling belongs to the future
  statement flow once its real inputs exist. _(confirmed owner ruling
  2026-08-31)_
- **US-9 — Retired with US-7.** Classification review belongs to the future
  statement flow once its real inputs exist. _(confirmed owner ruling
  2026-08-31)_
- **US-10 — Retired.** Closing an hours period does not post a finance operation;
  only an actual movement of money enters the ledger. _(decision 23)_
- **US-11 — Retired with US-10.** F2 ships no automatic hours accrual.
  _(decision 23)_
- **US-12** — As a team member responsible for finance entry, I enter an
  operation by hand when no request produced it, and it behaves like any other
  ledger operation. _(decision 3)_
- **US-13** — As an owner, I authorize a one-time agent/operator reconstruction
  of everything BBM spent and received before the system existed, directly from
  the original Mattermost production data, so historical reports are complete
  without a permanent bulk-entry product. _(confirmed owner ruling 2026-08-31)_
- **US-14** — As an owner, I can tell a backfilled historical operation from an
  operation captured live. _(`agent-proposed — UNCONFIRMED`)_
- **US-15** — As the owner, when a real new source is available later, adding it
  does not require redesigning the ledger or disrupting the existing request and
  manual-entry paths. Its behavior is specified from real source evidence, not
  in advance. _(decision 3; confirmed owner ruling 2026-08-31)_
- **US-16** — As an owner, an operation entered wrongly by any source is
  corrected by reversal, and the correction says which source produced the
  original. _(F1, consolidation spec §8)_
- **US-17** — As a team member without the owner role, I cannot post to the
  ledger, only request. _(decision 8)_
- **US-20** — As a team member, I choose the purpose of my request from the
  purpose reference and the expense category follows from it, so two people
  spending on the same thing never file it under two different words, and the
  form does not let me type one instead. _(decision 21)_
- **US-21** — As a team member, when the purpose I need is missing, I propose it
  from the request flow; an administrator decides whether it becomes a real
  purpose linked to a category, and the request never treats my free text as an
  approved purpose. _(decision 21; confirmed in the F2 spec)_
- **US-22** — As an owner authorizing reconstruction, I start from BBM's first
  operation and carry the books forward; the accounts stand at zero until the
  reconstructed operations move them, so I never enter an opening balance.
  _(decision 17)_

## Flows

**Expense request — happy path.**
Member opens `/p/finance/requests` → fills amount + currency → **picks the
purpose from the purpose reference**, which carries its expense category with it
_(decision 21)_ → picks the project and, where the expense is attributable to a
product, the product, which is then mandatory _(decision 22)_ → attaches the
invoice → submits → the request
appears in the owners' queue → an owner approves → the operation is posted to the
ledger with the invoice attached and the approver recorded → the member sees
"approved".

**Expense request — refused.**
The owner refuses with a reason → nothing is posted → the member sees the
refusal. _(`agent-proposed — UNCONFIRMED`: whether a refusal carries a reason)_

**Expense request — retroactive (money already spent).**
A member who has already spent the money — their own or the company's — submits
the same form after the fact, marked as already paid, with the receipt attached →
it lands in the same owners' queue → an owner approves → only then is the
operation posted. The pre-spend and the retroactive path differ in nothing but
that flag. _(decision 12)_ Where the member spent their own money, the approval
also creates an obligation to reimburse them. _(`agent-proposed — UNCONFIRMED`:
decision 12 fixes the path and the approval, not the reimbursement obligation as
a modelled entity)_

**Manual entry.**
A team member responsible for finance entry records a real movement of money →
attaches its confirming document → completes the same business details used by
requests → posts it to the ledger. Once posted, it is corrected by reversal,
never by editing.

**One-time history reconstruction.**
The agent/operator reads the original «BBM Финансы» posts, threads and files from
Mattermost production, plus any documents the owner supplies separately → starts
at BBM's **first operation ever** _(decision 17)_ → prepares the complete history
and a review for the owner → after the owner authorizes that result, writes the
operations directly to the finance database in chronological order. Every
account starts at zero; **no opening-balance entry is created**. A repeated run
does not add the same history twice. The resulting operations keep their source
documents, remain distinguishable as historical reconstruction, and behave like
live operations in every report. No ongoing bulk screen or import backend remains
after the job is complete. _(confirmed owner ruling 2026-08-31)_

**Deriving and applying the category list.**
The reconstruction review groups real spend by purpose and identifies items
without a category → the owner approves or reshapes the initial category list →
it becomes F1's editable reference table. Whenever a historical operation has no
stored category, it appears under the category currently linked to its purpose;
later mapping changes therefore apply when the operation is read, without
rewriting the original operation. _(decision 11; confirmed owner ruling
2026-08-31)_

**A new source arrives later.**
Once a real source and representative inputs exist, its own product scope is
approved → it feeds the same ledger without changing the existing request and
manual-entry paths. No producer or parser is built speculatively.

## Product acceptance criteria

- Any member with a platform login can submit an expense request with an invoice
  attached.
- A member can see the current state of every request they submitted.
- An owner sees all requests awaiting a decision in one place, with their
  invoices readable without leaving the screen.
- Approving a request results in a ledger operation, with no further manual entry
  step.
- A refused request produces no ledger operation.
- Money that was already spent can be filed on the same request form after the
  fact, and it reaches the ledger only through the same owner approval.
- The expense-category list the system runs on was derived from recorded spend
  and approved by the owner; no category list is shipped pre-invented.
- The invoice attached to a request is reachable from the resulting operation in
  the register.
- A member without the owner role cannot post to the ledger by bypassing the
  expense-request flow.
- A team member with finance-entry responsibility can record an operation
  manually with its confirming document.
- The owner can review and authorize one reconstruction of the full pre-system
  history from the original Mattermost production data, starting at BBM's first
  operation and without entering an opening balance.
- Repeating the reconstruction does not duplicate operations or change balances.
- Reconstructed operations retain their confirming documents, remain visibly
  historical, and behave like live operations in reports.
- Historical operations without a stored category appear under the category
  currently linked to their purpose, without rewriting those operations.
- The request form offers the purpose as a pick from the purpose reference and
  accepts no free-text purpose; the category is derived from the picked purpose.
- A request for an expense attributable to a product cannot be submitted without
  a product.
- A backfilled operation is distinguishable from one captured live.
- Every operation in the register names the source that produced it.
- A wrong operation from any source is corrected by reversal, never by editing.

## Out of scope

- What a posting is and how it is stored — F1.
- Any report over the resulting data — F3.
- Every bank-statement producer, parser, upload/review flow and API connection
  until real statement files exist and the owner approves a separate scope.
- A permanent bulk-backfill backend, endpoint or user-facing grid. Historical
  reconstruction is a one-time delivery operation, not a continuing product
  capability.
- Automatic posting from `/p/hours`; a closed hours period is not evidence that
  money moved.
- AI-agent entry and any further source until its real inputs and use case exist.
- Payment execution: nothing here moves money, it records that money moved.
- Reimbursement tracking as a workflow of its own — decision 12 confirms the
  retroactive filing path, not a payables/settlement workflow on top of it.
- The workspace roles themselves — epic #112, feature #313.

## Open questions

None in the current F2 scope. Bank formats are deliberately not an open design
question: they become a separately scoped product question only when real files
exist. Historical reconstruction and the absence of a permanent bulk product
were confirmed by the owner on 2026-08-31.
