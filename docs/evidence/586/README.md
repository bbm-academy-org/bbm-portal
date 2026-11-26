# Evidence — #586, the budget burn dashboard «Бюджет BBM»

Captured with Playwright on the worktree stand (port 3000, `platform_586`, seeded by
`pnpm dev:db:branch` plus the synthetic budget of `tools/platform/budget-dashboard-seed.ts`,
Bank of Russia rates synced into the branch DB), signed in as the dev `bbm-member` — a plain
platform member with no finance role (EARS-701). Full-page frames: desktop 1440 px wide,
mobile 390×844. Dark frames
set the workspace's `.dark` theme class. Every frame was captured on 2026-11-26 at head `03b82076` — the code head of this PR; later commits add evidence only, so the frames show that head's UI. They include the owner's live-stand feedback (segmented currency switch, one «Как посчитано» block at the bottom). No frame scrolls sideways (measured: 0 px overflow).

| Frame                                           | What it shows                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `budget-rub-{desktop,mobile}-{light,dark}.png`  | The budget currency (₽): the glass with limit, spent and remaining; runway with the gross and net burn; the money tier and its reconciliation; monthly burn and the waterline; the breakdown treemap and rows by category                                                 |
| `budget-usd-{desktop,mobile}-{light,dark}.png`  | The same reading switched to $ (EARS-721/722): the one pointer line under the header, every figure converted with no per-figure caption, and the «Как посчитано» block holding the rate rules, the Bank of Russia fallback count and months, and the relation differences |
| `finance-rub-{desktop,mobile}-{light,dark}.png` | The finance home `/p/finance` in ₽, the entry point the budget dashboard is reached from                                                                                                                                                                                  |
| `budget-rub-desktop-light-focus-currency.png`   | Keyboard focus on the segmented currency switch: reached by pressing Tab to the control (a real `:focus-visible`, not a CDP-forced pseudo-state); viewport-only, not full-page, since it shows one control state                                                          |

Routes: `budget-*` → `/p/finance/reports/budget`, `finance-rub-*` → `/p/finance`. On 390 px the shared top bar wraps the avatar and «Выйти» — pre-existing, not this PR. The Next dev-tools button in the corner exists only on the dev stand.
