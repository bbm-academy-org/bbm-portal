# Evidence — #601, the cross-currency refund in «Отметить возврат»

Captured with Playwright on the worktree stand (`platform_601`, seeded by `pnpm dev:db:branch`),
signed in as the seed approver. Viewport screenshots (desktop 1440×900, mobile 390×844), the
sheet scrolled to the «Отметить возврат» form.

| Frame                                              | What it shows                                                                                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cross-currency-{desktop,mobile}-{light,dark}.png` | Request №51, a posted own-funds debt of 120,00 €, refunded from the rouble account «Основной банк»: the amount (the roubles that left the account), its one hint, and the optional agent-fee field |
| `same-currency-{desktop,mobile}-{light,dark}.png`  | A posted own-funds debt in RUB refunded from a RUB account: the amount prefilled with the debt, no hint about currencies, no agent-fee field                                                       |
| `cross-currency-fee-refused-desktop-light.png`     | Request №51 with a fee equal to the refund: refused under the field before the round-trip — nothing is sent                                                                                        |

The posting itself was verified on request №38 (a 45,00 $ debt refunded through the form with
4 400 ₽ and a 132,50 ₽ agent fee), read back from `platform_601`: ONE operation with bank
−4 267,50 ₽ and −132,50 ₽ (fee), one RUB→USD conversion step, `liability:USD` +45,00 for the
member, the fee as its own `expense:RUB` leg on the step, and the transfer item recording
`paid_amount` 4 400,00 ₽ / `fee_amount` 132,50 ₽.
