# Evidence — #601, the cross-currency refund in «Отметить возврат»

Captured with Playwright on the worktree stand (`platform_601`, seeded by `pnpm dev:db:branch`),
signed in as the seed approver.

| Frame                                              | What it shows                                                                                                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cross-currency-{desktop,mobile}-{light,dark}.png` | A posted own-funds debt in EUR (120,00 €), refund from the rouble account «Основной банк»: the account hint, the amount as the roubles that left the account, and the optional agent-fee field |
| `same-currency-{desktop,mobile}-{light,dark}.png`  | A posted own-funds debt in RUB refunded from a RUB account: the amount prefilled with the debt, no agent-fee field                                                                             |
| `cross-currency-fee-refused-desktop-light.png`     | A fee not smaller than the refund is refused under the field before the round-trip (USD debt, 4 400 ₽ refund, fee 4 400 ₽)                                                                     |
| `cross-currency-posted-toast-desktop-light.png`    | After submitting a USD debt refunded with 4 400 ₽ and a 132,50 ₽ agent fee: the request leaves «Вернуть сотруднику» and the toast «Возврат отмечен»                                            |

The posted operation of the last frame was read back from `platform_601`: ONE operation with
bank −4 267,50 ₽ and −132,50 ₽ (fee), one RUB→USD conversion step, `liability:USD` +45,00 for
the member, the fee as its own `expense:RUB` leg on the step, and the transfer item recording
`paid_amount` 4 400,00 ₽ / `fee_amount` 132,50 ₽.
