# #559 — «Курс против рынка» on `/p/finance/reports/market-rate`: live-stand evidence

Captured 2026-11-18 by `capture.ts` (in this folder) against the session's own
dev stand: worktree `.claude/worktrees/559`, `PORT=3000 pnpm dev`, branch DB
`platform_559`, signed in through the real dev Zitadel as `bbm-test`. The
password was read from a scratch file into the process env, never into a tool
call.

**Stand data.** `pnpm dev:db:branch` (migrate + `pnpm dev:seed`), then
`stand-559.ts` (in this folder) through the module API only:

- a synthetic Bank of Russia series 2025-12-01…2026-11-18 (USD and EUR, via the
  sync job's own writer) with **no quote 2026-09-01…09-18** — the «без курса»
  window;
- six posted requests paid from «Основной банк»: USD 1 250 for 114 000 ₽ (лучше),
  USD 45 on 09-16 (inside the gap → «без курса»), EUR 840 for 84 000 ₽ at
  100,00 (≈ «как на рынке»), USDT 500 for 46 500 ₽ (valued at the USD rate),
  USDC 300 for 27 900 ₽ (valued at the USD rate — the #559 ruling), USD 100 for
  9 384 ₽ at 92,00 (хуже 2,0 %);
- a USD 100 personal-funds request reimbursed 9 016 ₽ (лучше 2,0 %);
- three conversion chains: RUB → USD on 09-17 (inside the gap → «без курса»),
  RUB → USD with a 1 $ step fee on the target, and RUB → USDT → USD with a
  500 ₽ step fee on the source;
- `dev:seed`'s own already-paid USD request with no debited amount
  («факт не внесён») and its acceptance-seed conversions (their recorded rates
  are fixture values, hence the large ± rows «RUB → USD» / «USD → RUB»).

Frames (1440×900 and 390×844, full page; viewport-only while a sheet is open):

| Frame                    | Shows                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `01-finance-header-link` | «Курс против рынка» beside «Заявки» on `/p/finance`                                                            |
| `02-default-12m-rub`     | default period (last 12 months), ₽: total, wording, Факт / Рынок, counts; both tables with «Итого» = the total |
| `03-november-opened`     | the November month row opened: each payment links to its request; chain with its route                         |
| `04-chain-route-opened`  | the «RUB → USDT → USD» route row opened                                                                        |
| `05-default-12m-usd`     | the same in $: every amount changes, every % is the same                                                       |
| `06-this-month`          | «Этот месяц»                                                                                                   |
| `07-empty-month`         | «Этот месяц» after `reverse-november.ts` reversed the month's operations — an empty period                     |

`findings.txt` / `findings-empty.txt`: the totals per period and currency as read
off the page, that the badges are identical after ₽ → $, that choosing € here
shows € on the requests queue (one remembered choice), and no frame scrolls the
page sideways at 390 px.
