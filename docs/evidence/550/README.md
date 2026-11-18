# #550 — the owner's payment queue on `/p/finance/requests`: live-stand evidence

Captured 2026-11-18 by `capture.ts` (in this folder) against the session's own
dev stand: worktree `.claude/worktrees/550`, `PORT=3000 pnpm dev`, branch DB
`platform_550`.

**Stand data.** `pnpm dev:db:branch` (migrate + `pnpm dev:seed`, which since
#550 also seeds EUR / USDT / USDC and seven queue cases `req-fx-01…07`), the
Bank of Russia series by `pnpm platform:finance:fx:sync --from 2026-07-01`
(141 days, 5 400 quotes), and the two dev IdP logins put into `core.member`
with `pnpm platform:member:seed` (without that row every act answers 403 — a
stand step, not a finding). One stand-only tweak, not committed: the seed
writes every request's `created_at` as «now», so the unterminated requests'
«Подана» was moved back to their `occurred_on` (and `req-fx-*` to 0–20 days
ago) on this branch DB, so the age column and its >14-day highlight have
something to show.

Signed in through the real dev Zitadel as `bbm-test` (`finance-approve` +
`finance-entry`) and, for frame 16, `bbm-member` (`platform-user` only). The
password was read from a scratch file into the process env, never into a tool
call.

Each state: 1440×900 and 390×844, full page; light here (dark for 01 and 04;
the rest of the dark matrix was captured and judged, not promoted).
`findings.txt`: no frame scrolls the PAGE sideways at 390 px (the tables scroll
inside their block); after «Одобрить» the request is in «К оплате»; the member
sees no row act.

| Frame   | State                                                                                                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01      | default: «В работе», three sums, groups Ждёт решения → К оплате → Вернуть сотруднику → Черновики (collapsed); USD row with its original under ₽, USDC row «нет курса», sum «без 1 заявки»; ages >14 days in red |
| 02      | Черновики expanded                                                                                                                                                                                              |
| 03      | the «К оплате» sum clicked — only that group                                                                                                                                                                    |
| 04 / 05 | display currency $ / € — every amount and sum converted; RUB rows show the rouble original under                                                                                                                |
| 06      | sorted by «Сумма» (converted value)                                                                                                                                                                             |
| 07      | search «USDC» — the no-rate row alone                                                                                                                                                                           |
| 08      | a search that matches nothing — every group «Ничего нет»; the sums unchanged                                                                                                                                    |
| 09      | project filter                                                                                                                                                                                                  |
| 10      | period «За 7 дней»                                                                                                                                                                                              |
| 11      | «Закрытые»: Оплачено · Отклонено · Отменено                                                                                                                                                                     |
| 12      | «Мои» for an approver with no own requests — every group empty                                                                                                                                                  |
| 13      | the row act «Одобрить» in `:hover`, `:focus-visible`, `:active` (CDP `CSS.forcePseudoState`)                                                                                                                    |
| 14      | «Отметить оплату» opens the existing details sheet on that list row (the pay form is #551). The sheet is fixed to the viewport, so a full-page frame shows it mid-page                                          |
| 15      | after «Одобрить»: the toast, the request moved to «К оплате»                                                                                                                                                    |
| 16      | `bbm-member`: the same groups, no row acts                                                                                                                                                                      |
