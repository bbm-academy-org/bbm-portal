# #437 — the stage-5 acceptance protocol, proved on one surface

The protocol written into
[`.claude/skills/task-cycle/SKILL.md`](../../../.claude/skills/task-cycle/SKILL.md)
stage 5, executed exactly as written before it was written into canon. Surface:
the members register `/p/admin/member/members` (the #434 reference family) —
already accepted, so nothing here is an acceptance ask; it is the agent's
evidence that the text is runnable.

**The stand.** Booted in this session (not a subagent), `PORT=3000 pnpm dev`
from `.claude/worktrees/437`, port taken with `pnpm dev:ports`; data from the
worktree's own branch DB `platform_437`, migrated and seeded by
`pnpm dev:db:branch` (#436) — 64 members, 30 finance requests, 3 hours periods.
Signed in as the seeded `bbm-test` user through the real dev Zitadel
(`tests/e2e/support/zitadel-sign-in.ts`); the password was read from truenas
into the process env and never into a tool call.

**The matrix.** Nine states × 2 breakpoints (desktop 1440×900, mobile 390×844)
× 2 themes (light, and dark through the theme's own `.dark` class — the
workspace ships no user-facing switch) = 36 full-page frames, 5.2 MB.

| Step | What it shows                                                  |
| ---- | -------------------------------------------------------------- |
| 01   | the register, 64 seeded members through the `data-table` block |
| 02   | search narrowing the register                                  |
| 03   | a search that matches nothing — the empty state, check (d)     |
| 04   | the primary action under a CDP-FORCED `:hover`                 |
| 05   | the same control under forced `:focus` + `:focus-visible`      |
| 06   | the same control under forced `:hover` + `:active`             |
| 07   | the member record, read mode                                   |
| 08   | the member record, edit mode                                   |
| 09   | in-place validation under the field that is wrong              |

Steps 04–06 are the part #434's journey did not have: the states are set through
one `CSS.forcePseudoState` CDP session per state on the located element, not
hoped for from a pointer. The three frames differ from each other and from 01 in
every breakpoint/theme combination, which is what makes the forcing observable
rather than asserted.

**DoD check.** All 36 frames were reviewed; none is red, error-stuck or
skeleton-stuck. One honest artefact: in `09-form-validation-*-dark` the page
canvas below the layout box renders light — the `.dark` class paints the
surfaces, and the body background below them is out of this task's scope
(no `src/**` was touched here).

**The journey script is not committed** — `tools/dev/journey-437.ts` was bound to
this seed dataset and deleted with the run, the same call #434 made. That every
task re-implements it is recorded in `DEBT.md`
(`2026-09-03-437-journey-harness`) with the third surface as the return
condition.
