---
status: Draft
epic: finance (#115) — see ./brief.md
surface: user-facing
updated: 2026-08-25
---

# F4 — Fact-vs-finmodel reconciliation (#341)

## Feature summary

The finmodel says what should happen to money; the ledger says what did. This
feature puts them side by side and names the gap (decision 5): **reserve %, pool
sectors and royalty — expected versus actual**.

The finmodel side is not invented here. It exists as an SSOT: `finmodel.yaml`
mastered in `bbm-kb`, snapshotted into this repo as
`src/lib/finmodel/{variables.ts,types.ts}` via `pnpm ssot:pull`, and holding
exactly the variables this reconciliation needs — `policy.reserve_percent` (the
share of each incoming sum that goes to reserve), `policy.royalty_percent`
(`mission_fund` + `bbm_holders`), `policy.profit_shares`
(investors / author / co-authors, 4/2/1), `policy.emission_price_rub`, and
`projects.<project>.unit_price_rub` (prior art §6). The model also marks which
values are illustrative rather than fixed fact, through `model_example` — a
reconciliation must not treat an example as a commitment.

The fact side is F1's ledger read through F3's queries.

**This feature compares; it does not enforce and it does not distribute.** It
does not move money to a reserve, does not pay a royalty, and does not decide the
waterfall — those are holding-level mechanics with open owner forks (prior art
§2, §3). It answers one question: are we where the model said we would be, and if
not, by how much.

## Design pick (Stage A)

_Not yet run._ The comparison surface — expected, actual, gap — is the whole
feature and needs a Stage-A pick vendored into `design-source/` before markup.

## User stories

- **US-1** — As the owner, I see the reserve the model says should have been set
  aside from the money that came in, next to what the ledger shows was actually
  set aside, and the difference. _(decision 5)_
- **US-2** — As the owner, I see the same comparison for royalty — what the
  model's royalty percentage implies against what was actually paid or accrued.
  _(decision 5)_
- **US-3** — As the owner, I see the comparison per pool sector — per project, in
  the finmodel's "pool = project" frame — rather than only for BBM as a whole.
  _(decisions 2, 5)_
- **US-4** — As the owner, each expected number tells me which finmodel variable
  produced it and what its value is, so the comparison is auditable rather than a
  claim. _(prior art §6)_
- **US-5** — As the owner, a gap is a number I can open: it leads to the
  operations on the fact side that produced it. _(F3 US-1)_
- **US-6** — As the owner, an expected number derived from a value the finmodel
  marks as an example is shown as illustrative, not as a target I am failing.
  _(prior art §6: `model_example`)_
- **US-7** — As the owner, when the finmodel changes in `bbm-kb`, the
  reconciliation reflects the new policy after the snapshot is pulled, and tells
  me which version of the model it is comparing against.
  _(`agent-proposed — UNCONFIRMED`: decision 5 fixes the comparison, not the
  versioning)_
- **US-8** — As the owner, I choose the period the reconciliation covers, and see
  it both for the period and cumulatively since the beginning.
  _(`agent-proposed — UNCONFIRMED`)_
- **US-9** — As the owner, a gap I have looked at and accepted can be marked as
  explained, so the next reading shows me only what is new.
  _(`agent-proposed — UNCONFIRMED`)_
- **US-10** — As the owner, I can see that the reconciliation has nothing to
  compare — no incoming money in the period, no policy value — and that this is
  different from a zero gap. _(`agent-proposed — UNCONFIRMED`)_

## Flows

**Reading the reconciliation.**
Owner opens `/p/finance/reconciliation` → picks a period and a scope (all of BBM,
or one project) → sees a row per policy item (reserve, royalty, pool shares):
expected, actual, gap, and the variable behind the expected number → clicks a gap
→ the register opens on the operations that make up the actual side.

**A gap that is a bookkeeping omission.**
The gap turns out to be an operation never recorded → the owner records it
through F2 → the gap closes on the next reading, with no action in this feature.

**A gap that is a real deviation.**
The money genuinely did not go where the model says → the owner either accepts
the deviation (US-9) or changes the model in `bbm-kb`. This feature reports; it
never adjusts either side to make them agree.

**The model changed.**
A new `finmodel.yaml` is pulled → the reconciliation compares against the new
policy from that point → the surface says which model version it used.
_(`agent-proposed — UNCONFIRMED`)_

## Product acceptance criteria

- The owner can see, for a chosen period, the reserve the finmodel implies and
  the reserve the ledger shows.
- The owner can see the same comparison for royalty.
- The owner can see the comparison broken down per project.
- Every expected number names the finmodel variable it came from.
- The owner can go from any gap to the operations behind its actual side.
- An expected number based on an illustrative finmodel value is visibly marked as
  illustrative.
- The reconciliation names the version of the finmodel it compared against.
- The reconciliation never writes to the ledger.
- A period with no comparable money is reported as such, distinctly from a zero
  gap.

## Out of scope

- Enforcing the policy: moving money to a reserve, paying a royalty, executing
  any distribution.
- The waterfall / cascade order, the token mechanics and the profit-share
  proportions — Eduard's prototype models them and their owner forks are open
  (prior art §2 and §3 — the forks themselves are §4.3 / §3.3 / §3.7 of
  `bbm/outputs/2026-07-24-bbm-finmodel/2026-08-05-money-mechanics-and-forks.md`,
  the document prior art §2 quotes).
- Editing the finmodel. Its master is `finmodel.yaml` in `bbm-kb`, PR-edited
  (ADR-002 §2); this surface reads a snapshot and never writes back.
- Forward projection of the model — F5.

## Open questions

1. **Which policy items are in v1?** Decision 5 names reserve %, pool sectors and
   royalty. Do the profit shares (4/2/1) and the emission price belong in the
   same table, or are they only meaningful once a distribution has actually
   happened?
2. **What is "actual reserve" in the ledger?** A reserve is presumably an account
   or a project the money sits in — the fact side needs a definition before the
   comparison has meaning.
3. **Cumulative or per period?** A reserve percentage of incoming money is
   naturally cumulative; a royalty may be per period.
4. **Does an accepted gap need to persist**, and who may accept one?
