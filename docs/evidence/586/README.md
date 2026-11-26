# Evidence — #586, the budget burn dashboard «Бюджет BBM»

Captured with Playwright on the worktree stand (port 3000, `platform_586`, seeded by
`pnpm dev:db:branch` plus the synthetic budget of `tools/platform/budget-dashboard-seed.ts`,
Bank of Russia rates synced into the branch DB), signed in as the dev `bbm-member` — a plain
platform member with no finance role (EARS-701). Full-page frames: desktop 1440 px wide (the
light ones from the e2e journey at the Playwright default width), mobile 390×844. Dark frames
set the workspace's `.dark` theme class. No frame scrolls sideways (measured: 0 px overflow).

| Frame                                          | What it shows                                                                                                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `budget-rub-{desktop,mobile}-{light,dark}.png` | The budget currency (₽): the glass with limit, spent and remaining; runway with the gross and net burn; the money tier and its reconciliation; monthly burn and the waterline; the breakdown treemap and rows by category          |
| `budget-usd-{desktop,mobile}-{light,dark}.png` | The same reading switched to $ (EARS-721/722): the rate line, flow figures at each operation's actual rate, stocks «по курсу ЦБ на …», the fallback marks per figure and per breakdown line, and the two relation-difference lines |
