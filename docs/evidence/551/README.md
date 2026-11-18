# #551 — the details sheet, the payment forms, the bulk dialog and the §J block: live-stand evidence

Captured 2026-11-18 by `capture.ts` (in this folder) against the session's own
dev stand: worktree `.claude/worktrees/551`, `PORT=3001 pnpm dev`, branch DB
`platform_551`. Signed in through the real dev Zitadel as `bbm-test`
(`finance-approve` + `finance-entry`) and, for frame 29, `bbm-member`
(`platform-user` only); the password was read from a scratch file into the
process env, never into a tool call.

**Stand data.** `pnpm dev:db:branch` (migrate + seed), the Bank of Russia series
by `pnpm platform:finance:fx:sync --from 2026-07-01`, the two IdP logins put into
`core.member` with `pnpm platform:member:seed`, and these stand-only SQL edits on
`platform_551` (not committed) so the acceptance scenarios exist:

| Row  | Edit                                                                                          | Scenario                                      |
| ---- | --------------------------------------------------------------------------------------------- | --------------------------------------------- |
| rate | CBR USD on 2026-11-13 set to 92,0000                                                          | the AC's «курс ЦБ 92,00»                      |
| #35  | USD 100,00 approved, fee 50 ₽, a pay link in the note                                         | §J «хуже рынка на 2,0%» (paid 9 334 + 50 ₽)   |
| #38  | member's USD 100,00 card spend on 2026-11-13                                                  | refund 9 016 ₽ → «лучше рынка на 2,0%»        |
| #36  | USD 200,00 already paid from the RUB company account on 2026-11-10, debited amount not stated | «факт не внесён», the FX write-order refusal  |
| #32  | member's USD 30,00 taxi, card charge stated as 2 760 ₽                                        | «факт не проведён — после «Отметить возврат»» |
| #16  | note edited between opening the form and confirming (frame 21)                                | the EARS-548 stale-snapshot refusal           |
| rate | USD quotes 2026-09-17…2026-10-01 deleted (frame 27)                                           | «нет курса ЦБ на 01.10.2026»                  |
| #36  | fee 50 ₽ and a pay link added before frame 03's re-take                                       | the header fee line and «реквизиты есть»      |

The steps ACT on the stand in a fixed order (the FX write order makes the order
part of the scenario): #33 is approved and paid on 2026-10-01, #35 and #38 on
2026-11-13, then #36 dated 2026-11-10 is refused.

Frames: 1440×900 and 390×844, light (dark for 01, 03, 04, 10, 25; the rest of
the dark matrix was captured and judged, not promoted). With a sheet open the
viewport is grown to the sheet's scroll height, so the whole sheet is in frame.
`findings.txt` lists what the script asserted along the way.

| Frame | State                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01    | «Ждёт решения», USD: amount in ₽ with «заявлено 1 250,00 $ · курс ЦБ на 18.11.2026 (сегодня)», details missing, three acts                                                     |
| 02    | «К оплате», RUB, no link / account number / document — the warning «Реквизитов или ссылки на оплату нет»                                                                       |
| 03    | «К оплате» with the fee line («комиссия 50,00 ₽») and «Реквизиты есть в комментарии к заявке», §J «факт не внесён»                                                             |
| 04    | «Вернуть сотруднику»: who paid, when, «Вернуть: 100,00 $»; «Возврат сотруднику» in the timeline                                                                                |
| 05    | already paid USD, no debited amount: «факт не внесён — укажите списанную сумму при отметке оплаты»                                                                             |
| 06    | personal funds with a stated charge: «факт не проведён — появится после «Отметить возврат»»                                                                                    |
| 07    | «Одобрить и отметить оплату», USD from the RUB account: «Оплачено» disabled until the debited roubles are entered                                                              |
| 08    | the same form, a malformed amount — the field's own message                                                                                                                    |
| 09    | after it: toast «Заявка одобрена, оплата отмечена.», the request in «Оплачено»                                                                                                 |
| 10    | §J measured: «Рынок 9 200,00 ₽ · курс ЦБ на 13.11.2026 · 1 USD = 92,00 ₽», «Факт 9 384,00 ₽ … в т.ч. комиссия 50,00 ₽», «Переплата +184,00 ₽ · хуже рынка на 2,0%»; «без чека» |
| 11    | the same in $: «+2,00 $», the % unchanged                                                                                                                                      |
| 12–13 | «Отметить возврат»: amount required (cross-currency, no prefill), then 9 016,00                                                                                                |
| 14    | after the refund: «Факт 9 016,00 ₽ · с карты сотрудника», «−184,00 ₽ · лучше рынка на 2,0%», «Возврат сотруднику · возвращено»; the operation books the debt in roubles        |
| 15    | the FX write-order refusal shown verbatim in the form (and the toast)                                                                                                          |
| 16–17 | «Отметить оплату» on a RUB request: the date cleared → its error; the same-currency debited amount shown, not asked                                                            |
| 18–19 | paid with no receipt: «без чека» in the «Оплачено» row and in the sheet, the attach block emphasised                                                                           |
| 20    | «Прикрепить чек» → the receipt is in «Файлы», «без чека» is gone                                                                                                               |
| 21    | the EARS-548 stale-snapshot refusal, verbatim, after the request changed under the open form                                                                                   |
| 22–23 | «Отозвать» on an approved request (reason required, its error) and «Отклонить» on a submitted one                                                                              |
| 24–25 | «Отметить все 5 как оплаченные…»: before the account; the preview — 4 planned oldest first with their dates, #36 excluded with the gate's reason                               |
| 26    | after the confirm: toast «Отмечено оплаченными: 4, исключено: 1.»                                                                                                              |
| 27    | the CBR rates removed for the 15 days up to #33's payment date: «нет курса ЦБ на 01.10.2026»                                                                                   |
| 28    | the sheet's primary act in `:hover`, `:focus-visible`, `:active` (CDP `CSS.forcePseudoState`)                                                                                  |
| 29    | `bbm-member`: the sheet with no act                                                                                                                                            |
| 30–31 | the deep link: `?request=36` opens that sheet on load; `?request=999` — the plain queue with a quiet notice                                                                    |

Also verified, not framed: Escape and the overlay close the sheet; cancelling
the bulk dialog posts nothing (the «К оплате» rows keep their acts); #38's
member liability postings are −9 016,00 and +9 016,00 in the one act, so the
member's RUB balance is unchanged (SQL on `core.finance_posting`).

## Re-capture after the review of PR #564 (2026-11-18)

`recapture.ts` (this folder) re-took the frames the review changed, on the stand
as `capture.ts` left it, signed in by a minted Auth.js session
(`tests/e2e/support/platform-session.ts`, `AUTH_SECRET` from the env). Its
`prepare` step added stand-only data through the API: #6 and #7 approved (an
unpaid «К оплате» row with no details, and three rows for the bulk act), and
#51 filed — a member's USD 45,00 card spend with no stated charge (the refund
currency still open). The frames below REPLACE the earlier ones of the same
number (they now show other requests where the earlier ones had been posted);
32 and 33 are new.

| Frame | State after the fixes                                                                                                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01    | #8 «Ждёт решения»: the title is the queue row's line (the note's first line), the purpose under it (UX 4)                                                                                                                                            |
| 02    | #6 «К оплате», unpaid, no details: the warning «Реквизитов или ссылки на оплату нет» — the one stage that still gets it (EARS-542)                                                                                                                   |
| 32    | #36 «К оплате», already paid from the company account: «Уже оплачено 10.11.2026 — осталось отметить оплату», no details warning (EARS-542, UX 1)                                                                                                     |
| 04    | #51 «Вернуть сотруднику», USD, refund currency open: «Вернуть: 45,00 $ со счёта в USD; со счёта в другой валюте — сумму, фактически списанную с карты»; §J «факт не внесён — укажите сумму возврата при «Отметить возврат»» (EARS-544/563, S3, UX 5) |
| 13    | the same with «Отметить возврат» open: the files block hides its picker — the form's receipt is the one upload control (UX 2)                                                                                                                        |
| 07    | #36 «Отметить оплату» open: one upload control (UX 2)                                                                                                                                                                                                |
| 15    | the FX write-order refusal in the form: no EARS codes, dates as 01.07.2026 / 13.11.2026 (UX 7)                                                                                                                                                       |
| 25    | the bulk preview on «К оплате»: rows wrap — №, the author's line, the date and the payee, the amount — nothing truncated at 390 px; the exclusion reason without codes (UX 3, UX 7)                                                                  |
| 33    | «Вернуть сотруднику»: «Отметить все 3 как возвращённые…» and its preview; cancelled, nothing posted (EARS-547)                                                                                                                                       |

S1 (a refused form remounts on the re-read row with fresh defaults and token)
and S2 (a receipt failing after its act) are behaviours of the screen's state,
pinned by `tests/unit/finance-requests-queue-ui.spec.ts`, not framed.

## Pre-acceptance UX pass (items 1–9) — re-capture

`ux-pass.ts` (this folder) re-took, on the lead's acceptance stand
(`http://localhost:3000`, this worktree, acting on nothing), the frames the pass
changed — 1440 × 900 and 390 × 844, light and dark; `findings-ux-pass.txt`
lists what it read along the way.

| Frame                                         | Item | State                                                                                      |
| --------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `550/01-queue-default`                        | 1–2  | «Новых за сутки: K · Последняя заявка: №N · …» on one line; the tiered group headings      |
| `550/11-scope-closed`                         | 2    | the closed groups as the archive tier                                                      |
| `551/01`, `551/02`                            | 3–5  | section labels; «Нет файлов.» + «Прикрепить файл», no picker; the quiet «Реквизитов … нет» |
| `551/35-files-attach-opened`                  | 4    | the picker after «Прикрепить файл», with «Не прикреплять»                                  |
| `551/05-sheet-fact-not-entered`               | 6    | «факт не внесён — укажите списанную сумму…» in the body colour                             |
| `559/02-default-12m-rub`, `559/06-this-month` | 7, 9 | measured rows in the table, «… · не измерено: причина» muted under it; counters by the sum |

Item 8 (the empty period) has no stand frame: every period on the shared stand
has currency payments and the pass writes nothing; the unit spec renders it.
