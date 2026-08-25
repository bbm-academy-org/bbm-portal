# Finance prior art digest — bbm-portal #115

> **Provenance:** produced by agent recon 2026-08-25 (discovery step 2 of
> `do-product-discovery`, epic #115). The recon output was written in Russian in
> the discovery session's scratchpad; the digest below is that output translated
> into English, which is the language of docs in this repo. Nothing was added or
> re-scoped in translation — Russian terms and labels that name an artifact's own
> wording («себестоимость», «Маршрут денег», «Штат / ИП / НПД») are kept inline
> as quotes. Each source carries its own artifact passport (path + owner + type).
> Reference material only: it is a functional reference, never a template to
> reproduce.

## 1. money-calculator.html («Маршрут денег» — the money route)

- **Passport:** `C:/Users/sidor/repos/bbm/outputs/2026-07-24-bbm-finmodel/2026-08-05-money-calculator.html`; owner Anton (+Claude); type: build/export (single-page HTML/JS, `computeModel` reachable from the console).
- **Tabs:** «Модель» (chart + milestones), «Таблица P&L» (clickable cells → formula + substitution, a "show formulas" mode, CSV export).
- **Inputs (six sliders; all of them are parameters of `computeModel({I, cost0, gCost, rev0, gRev, k, T})`):**
  - `I` — the first investor's investment, ₽m (0–20)
  - `cost0` — first-month expenses, ₽m (0.1–5)
  - `gCost` — expense growth, %/month (0–10)
  - `rev0` — revenue of the first month of sales, ₽m (0–5)
  - `gRev` — revenue growth, %/month (0–40)
  - `k` (sales-launch lag) and `T` (horizon, months) are model parameters, not exposed as separate sliders in the extracted fragment
- **Outputs:** month-by-month P&L (revenue / expenses / cash), three milestones (operating break-even, cash zero, investor payback), 5% royalty plus 4x/2x/1x profit sharing (hard-wired proportions, not varied).
- **Expense lines:** the model does **not** break expenses down by category — `cost0` is a single aggregated "expenses of the month" figure, with no split into payroll / rent / contractors / taxes. There is no product or lesson unit cost here at all.
- **Hard-coded:** the 5% royalty and the 4/2/1 shares are baked in (not parameters).

## 2. money-mechanics-and-forks.md

- **Passport:** `.../2026-08-05-money-mechanics-and-forks.md`; owner Anton; type: original (working-session protocol).
- Key mechanics: the money route in 3 milestones (operating break-even → cash zero → investor payback); 2 distribution phases (Eduard's payback cascade → our 4/2/1 profit sharing); **salary is an expense BEFORE profit** (decided, §5, in force since 01.08 in `payout-mechanics.md`); an accrual is the role's rate by grade × actual hours; verification is 👍/👎 (not voting with money).
- Open owner forks: the backing of tokens A/B/C (§4.3), the canonical mining formula (§3.3), OPEX as a cascade tier vs OPEX as an expense (§3.7) — these questions are addressed to Eduard / Anton and are not settled.
- No separate "expense lines / cost categories" concept is introduced: expenses are the single aggregate `Cost₀ + growth`, with no payroll / rent / contractors / taxes as their own lines (in this document).

## 3. Eduard's stand (smart-contract-calculator)

- **Passport, HTML:** `.../2026-08-01-smart-contract-calculator.html`; owner Eduard (with Claude Code); type: build (prototype, self-contained HTML/JS, in-memory state + optional localStorage).
- **Passport, export.md:** `.../2026-08-04-smart-contract-calculator-export.md`; the maths is Eduard's, the technical export was produced by Claude Code at Eduard's request; type: export.
- Three modules: A — BBM tokenomics (token/metal indices, cap table, the waterfall CAPEX → OPEX → co-authors → authors → co-investors → BBM investors, auction, royalty); B — Doctor.School attention mining (content types, lessons, 5 funds); C — bridge / scenarios.
- **Expense categories do appear here, but as cascade tiers rather than P&L lines:** CAPEX (with sub-categories: architectural / infrastructural / semantic / product / branded) and OPEX as a single undetailed tier. This is an order of priority for paying revenue out, not a cost structure.
- The cap-table figures are a hypothetical example, **not** real accounting (confirmed by Anton).

## 4. ds-lesson-cost-calculator (lesson unit cost, «себестоимость»)

- **Passport:** `C:/Users/sidor/repos/bbm/outputs/ds-lesson-cost-calculator/index.html`; owner: derived from the estimate `2026-06-04-ds-platform-reestimate-detailed.html` (DSP-218), i.e. from the Doctor School project, not from bbm-portal; type: build/derived.
- **This is the only source that actually computes the cost of one unit of product** (a lesson), rather than only the company's cash flow.
- **Inputs:** "lessons per year" (slider); per-role rates (₽/month × months of engagement) with three employment modes — «Штат» (staff; tax loading ~100%, i.e. true cost ≈ rate × 2), «ИП/УСН» (sole trader, +8%), «Самозанятый/НПД» (self-employed, +6%) — the loading % is editable per role; a list of external (contractor) expense lines (`ext`); a contingency-buffer checkbox (payroll +15%, external +25%); the cost share of the price (`costShare`, default 15%) OR a manually set lesson price.
- **Outputs:** "variable" and "average" unit cost in ₽/lesson; total payroll with taxes (₽/year and ₽/lesson); total external (₽/year and ₽/lesson); margin in % and in money; a header comparing unit cost against price.
- **Expense lines explicitly modelled:** payroll by role (broken down by employment mode and tax loading) plus "external" lines (contractors / services) — the closest thing to a real cost structure among all the sources.
- The central-bank exchange rate and the default figures come from the 2026-06-04 estimate (external hard-coding).

## 5. platform/db/schema — the tables that exist today

- **Path:** `C:/Users/sidor/repos/bbm-portal/src/lib/platform/db/schema/`; owner: this repo (bbm-portal); type: original (live database schema).
- Modules: `core.ts`, `hours/`, `member/`.
- `hours/hours-assessment.ts` — hours accruals: columns `monthlyRate` (int), `hourlyRate` (double precision, unrounded effective rate), `accrual` (int), `cashAmount` (int), `investAmount` (int), `weekdayCount` (int) — this is the table of accruals by rate (hours × role rate).
- `hours/hours-period.ts` — accrual periods (id = text/UUID, cutover-compatible); the `weekday_count` field determines every rate/accrual of the period.
- The other `hours-*` files — `hours-participant.ts`, `hours-publication.ts`, `hours-publication-message.ts` — are the period's participants and publications; not examined in detail (they do not bear on rates or accruals).
- `member/member.ts`, `member/member-alias.ts` — members and aliases; not directly money-related.
- **There is no table for product unit cost, for project expense lines (rent / services / taxes / CAPEX-OPEX) or for a P&L** — only accruals for members' hours.

## 6. finmodel SSOT — variables.ts / types.ts

- **Path:** `C:/Users/sidor/repos/bbm-portal/src/lib/finmodel/{variables.ts,types.ts}`; owner: this repo; type: original (a snapshot of the master `ssot/finmodel.yaml` in the bbm-kb repo, pulled by `pnpm ssot:pull`).
- The money-related SSOT variables:
  - `policy.profit_shares` — `investors` / `author` / `coauthors` (the 4/2/1 shares)
  - `policy.royalty_percent` — `total` = `mission_fund` + `bbm_holders`
  - `policy.reserve_percent` — the share of every incoming sum that goes to the reserve
  - `policy.emission_price_rub` — the price of the token's primary emission
  - `policy.examples.team_monthly_rate_rub`, `policy.examples.team_hours_norm` — an example team rate / hours norm (public examples)
  - `projects.doctor_school.unit_price_rub` — the unit price of the DS project's product
  - `projects.doctor_school.mining_weights` (`pul`, `bre`, `con`) — attention-mining weights
  - `model_example: string[]` — the paths of values flagged as modelled (not fixed fact)
- There are no unit-cost or expense-line variables: the SSOT models only profit distribution and emission, not the cost structure.

## Sources I could not read

None — all six sources were read successfully (in full, or by targeted grep/read).
