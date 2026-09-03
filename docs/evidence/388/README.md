# #388 — the expense-request board `/p/finance/requests`, stage-5 eyes-on matrix

The acceptance journey of [`.claude/skills/task-cycle/SKILL.md`](../../../.claude/skills/task-cycle/SKILL.md)
stage 5, points 2–3, run against PR #470 after the load crash was fixed
(`1cf0226` — the board reads the snapshot from `query.data`, not from
`useCustom`'s always-truthy `result.data`). The previous run of this same
journey never reached the board at all; every state below is now reachable.

**The stand.** `http://localhost:3000`, the lead's listener from
`.claude/worktrees/388` on `feat/388-requests-board-blocks` @ `52ba515`; data
from that worktree's own branch DB `platform_388`. The fixture is `pnpm dev:seed`
(64 people in `core.member`, 42 intake rows — 9 submitted, 5 approved, 6 posted
with documents, 4 refused, 3 cancelled, 15 drafts — the approved-without-document
rows being the EARS-506/511 gate fixture) plus `pnpm platform:member:seed` for the
two dev IdP logins, plus the three acts below driven through the UI. After those
acts the board reads 7 «Ждут» / 5 «Одобрены — ждут документа» / 7 «Проведены» /
5 «Отклонены» — every column populated. Driven
with `@playwright/test` from the worktree, signed in through the real dev
Zitadel as `bbm-test` (the approver, `finance-approve` + `finance-entry`) and as
`bbm-member` (a plain `platform-user`); the password was read from a scratchpad
file by the script through `fs` and never entered a tool call.

**The matrix.** 15 driven states × 2 breakpoints (desktop 1440×900, mobile
390×844) × 2 themes (light, and dark through the theme's own `.dark` class — the
workspace ships no user-facing switch) = 60 frames, plus the primary control
under three CDP-forced pseudo-states, plus the outcome of each act the seed
allows.

| Step | What it shows                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------- |
| 01   | `/p/finance` with the «Заявки» link at the title's right edge (`href=/p/finance/requests`)                |
| 02   | the board — four columns, live cards in «Ждут», muted archives in «Проведены» / «Отклонены»               |
| 03   | the «Обязательства» tab — what BBM owes for spends from members' own money                                |
| 04   | the «Мои заявки» tab, EMPTY RESULT: the reader has filed nothing                                          |
| 05   | the details sheet of a submitted request — «Одобрить» / «Отклонить…» / the attach block                   |
| 06   | an APPROVED request with no document: no «Провести» at all, the gate Alert, and the attach form           |
| 07   | the refusal dialog — a reason is mandatory (EARS-512), so it is a modal and not a field beside «Одобрить» |
| 08   | the same dialog submitted empty — «Укажите причину отказа.» under the field                               |
| 09   | «Новая заявка» submitted empty — five messages, each under the field that is wrong, never a summary       |
| 10   | an ILLEGAL drag (a submitted card dropped on «Проведены») — nothing moves, the toast says why             |
| 11   | a MUTATION FAILURE (the act route forced to 500) — the error toast, and the sheet deliberately stays open |
| 12   | the loading skeleton, caught with the snapshot request held open — four column blocks, no layout jump     |
| 13   | the same URL as a reader with no finance role: the board is legitimately empty, no act control anywhere   |
| 14   | «Новая заявка» under CDP-FORCED `:hover`, `:focus-visible` and `:active` (desktop, both themes)           |
| 15   | after «Одобрить» — the success toast and the card now in «Одобрены — ждут документа»                      |
| 17   | after a refusal with a reason — the card in «Отклонены», carrying the reason and the decider              |
| 18   | after «Приложить документ» — the sheet STAYS open, the PDF reads inline, «Провести» is now one click away |
| 19   | after «Провести» — both toasts, and the card in «Проведены»                                               |
| 20   | a posted request — the ledger operation and its postings instead of controls                              |
| 21   | «Новая заявка» with a real purpose — the card lands in «Ждут» and the toast says exactly that             |
| 22   | the proposal branch («Нет подходящего — предложу новое») — saved as a DRAFT, toast points at «Мои заявки» |

Steps 14 are set through one `CSS.forcePseudoState` CDP session per state on the
located element, never hoped for from a pointer.

**DoD check (stage 5 point 5).** Every kept frame was reviewed. None is red,
error-stuck or skeleton-stuck; the only skeleton in the folder is step 12, where
it is the state being accepted. Four honest artefacts, each re-observed live
before being written down:

- **Modal states are captured at the viewport, not full-page.** A sheet/dialog is
  `position: fixed`, so a full-page frame of one shows the overlay ending at the
  first viewport and the board unobscured below — a capture artefact, not the
  screen. Steps 05–09, 11, 18 and 20 are therefore viewport frames.
- **Step 19's frame shows the top bar twice.** It is sticky, and a full-page
  capture paints it at its scroll position as well. Nothing is duplicated on
  screen.
- **The inline PDF pane needs a real browser.** In HEADLESS Chromium the
  `<object type="application/pdf">` falls back to its download link and leaves a
  blank box; step 18 was therefore re-captured HEADED, where the receipt renders
  in place as the section promises.
- **Steps 15/17/19 exist at desktop-light only.** Each is the outcome of a
  one-way transition on the fixture — a request can only be approved, refused or
  posted once — so the same act cannot be replayed per breakpoint. The states
  those acts LEAVE BEHIND (18, 20) are captured at all four combinations.

**Rows this run changed in `platform_388`** (recorded so the next reader is not
surprised): request #6 approved, #7 refused with a reason, #14 given a PDF and
then posted (+1 document, +1 ledger operation #12), and `core.member` gained the
two dev IdP logins. That last one is NOT cosmetic: `pnpm dev:seed` seeds a
registry of 64 people that does not include `bbm-test@bbm.local`, and without a
`core.member` row every write act on this board is refused — the acts above only
became reachable after `pnpm platform:member:seed` with a two-line dataset naming
`bbm-test@bbm.local` and `bbm-member@bbm.local`.

The requests steps 21/22 filed themselves (four «Приёмочный прогон #388» cards and
four proposal drafts) were DELETED from `platform_388` after the capture, so the
live stand carries the seed fixture plus the three acts above and nothing else;
the frames are the record of that moment, not of the current row count.

**The «1 Issue» badge in the earlier frames was the harness, not the app.** Next's
dev overlay counted one console error: a React hydration mismatch on
`<html lang="ru">` (`src/app/(platform)/layout.tsx:42`) whose only differing
attribute is `style={{color-scheme:…}}` — the value the capture script itself
writes onto `document.documentElement` to force the theme. A plain load of the
board, and a load with the «Новая заявка» sheet open, raise no issue at all. The
kept frames hide the dev-only overlay so it cannot be misread as a product error.

**The journey scripts are not committed** — they were bound to this seed dataset
and deleted with the run, the same call #434 and #437 made; `DEBT.md` already
tracks that every task re-implements this harness
(`2026-09-03-437-journey-harness`).
