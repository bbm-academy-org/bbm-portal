# #487 — the foreign font inside a portaled dropdown: the trace, and the fix

Four frames, not a full stage-5 matrix: this is a defect trace plus its
before/after, and the acceptance of the surface it was seen on is batched at
**#388** (`Stage-B: batched at #388` on PR #490). Two different stands appear
below, and which frame came from which is the point of this file.

**The stands.**

| Stand                   | Owner / provenance                                                                                                                                                           | Used for                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `http://localhost:3000` | the LEAD's listener — worktree `.claude/worktrees/388`, branch `feat/388-requests-board-blocks` @ `da72536` (PR #470), DB `platform_388`                                     | frame 01 only, **read-only**: nothing was started, stopped, seeded or mutated there beyond opening a page |
| `http://localhost:3001` | this task's own — worktree `.claude/worktrees/487`, branch `fix/487-foreign-font-inside-a-dropdown-on`, DB `platform_487` (`pnpm dev:db:branch`), port from `pnpm dev:ports` | frames 02–04, taken AFTER the fix; stopped by its own port when the run ended                             |

Signed in as the seeded `bbm-test` user through the real dev Zitadel; the
password was read from the local credentials file into the browser and never
into a tool-call argument or the session output.

Desktop viewport (1234×1221 CSS px), light theme. The defect is a `font-family`
that does not depend on breakpoint or theme, so the matrix would photograph the
same fact twelve more times.

| Frame                                           | Stand / port | Before or after | State                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-before-requests-select-times-new-roman.png` | 3000         | **before**      | `/p/finance/requests`, the details sheet whose header reads «12 500,00 RUB — Приёмочный прогон #388 — намерение, деньги ещё не двигались (desktop-dark)» (the row «Заявка №69» opens it), its «Подтверждающий документ» type select OPEN. The list (Счёт / Чек / Инвойс / …) renders in Times New Roman, with no popover background, ring or radius — it is outside every `[data-bbm-ui]` subtree. This is what the owner saw on 2026-09-15. |
| `02-after-bare-selectcontent-scoped.png`        | 3001         | **after**       | `/p/admin/member/members`, the pager's «Строк на странице» select OPEN. That call site is written **without** `data-bbm-ui` in this diff — the kit now carries the scope — and the list renders fully themed: sans stack, popover background, ring, radius, check mark. This is the live proof of the fix, not merely of the theme.                                                                                                          |
| `03-after-okr-unchanged.png`                    | 3001         | **after**       | `/p/okr` with the fix in place — golos / unbounded, `content-box`, its own page background, no `[data-bbm-ui]` anywhere inside `<main>`. EARS-429's «stays unreskinned» clause, unbroken.                                                                                                                                                                                                                                                    |
| `04-after-hours-unchanged.png`                  | 3001         | **after**       | `/p/hours` with the fix in place — Georgia headings, unchanged. Same clause, the other surface.                                                                                                                                                                                                                                                                                                                                              |

**Why frame 02 is not on the defective screen.** The requests board exists only
on #388's branch, in the LEAD's worktree, under the owner's pending acceptance —
editing it to photograph an after-state there is not this task's to do. So the
after-frame is taken on a surface that lives on `main` and whose call site this
diff deliberately strips of its now-redundant attribute. The numbers behind both
frames — the computed `font-family` read on the portaled list and on
`document.body`, before and after — are in the issue comment on #487.

**No before-frames for 03/04.** They are regression checks against a screen this
diff must NOT change; the honest baseline for them is the deployed
`/p/okr` and `/p/hours`, which these two frames match.

**DoD check, and the one honest artefact.** Frame 03 is NOT a clean screen: it
carries `/p/okr`'s own «Plane недоступен, а кэш ещё не наполнен» banner, because
this stand's `PLANE_API_TOKEN` reaches no Plane and the branch DB holds no cached
tree. That is the page's designed unavailability state, not a crash and not
something this diff caused — and it is the state in which the frame still proves
what it was taken for: the heading renders in unbounded, the banner body in
golos, `content-box`, on `/p/okr`'s own page background, with no `[data-bbm-ui]`
anywhere inside `<main>`. The typography evidence is read off elements that
render identically whether the OKR tree loaded or not. Frames 01, 02 and 04 are
clean: none red, error-stuck or skeleton-stuck.
