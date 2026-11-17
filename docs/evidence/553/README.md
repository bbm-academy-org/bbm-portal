# Evidence — #553 «Процессы» workspace + IDEF0 viewer (PR #555)

Eyes-on matrix per `.claude/skills/task-cycle/SKILL.md` stage 5 item 3. Captured
2026-11-17 by Playwright (Chromium) against the dev stand of worktree
`.claude/worktrees/553` (http://localhost:3000), session minted like
`tests/e2e/support/platform-session.ts` (`signInAsPlatformMember`, role
`platform-user`). Dark = the theme's `.dark` class added on `<html>`.

File name: `<step>--<breakpoint>-<theme>.png`, breakpoints desktop 1440×900 and
mobile 390×844, every frame full-page.

| Step                                      | What the frame shows                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-home-launcher`                        | `/p` launcher; the «Процессы» tile sits among the internal workspaces                                                                                                        |
| `02-processes-index`                      | `/p/processes`: the catalog, one card «Производство контента DS»                                                                                                             |
| `03-viewer-A-0`                           | `/p/processes/ds-content-production#A-0`: context diagram, ICOM labels, panel with the viewpoint                                                                             |
| `04-viewer-A0`                            | `#A0`: decomposition A1–A4, breadcrumb `A-0 › A0`                                                                                                                            |
| `05-viewer-A31`                           | `#A31`: third level, breadcrumb `A-0 › A0 › A3 › A31`                                                                                                                        |
| `06-viewer-A0-A3-panel`                   | A0 with box A3 clicked: box highlighted, its arrows lit, panel with «Открыть декомпозицию A3», inputs/controls                                                               |
| `07-viewer-A0-hover-tooltip`              | hover card (`role="tooltip"`) over box A2 (desktop) / over the I2 arrow label (mobile — the pointer landed there)                                                            |
| `08-viewer-A0-animation-off`              | «Анимация стрелок» unchecked: arrows drawn solid, not dashed-animated                                                                                                        |
| `09-primary-{hover,focus-visible,active}` | the panel's primary control «Открыть декомпозицию A3», state forced via CDP `CSS.forcePseudoState` (one session per state); `--desktop-light` full page, `--crop` the button |
| `10-degraded-failed`                      | «Не удалось прочитать модель» alert (`loaded.ok === false`, reason `network`)                                                                                                |
| `10-degraded-stale`                       | stale-copy notice in the page head (`stale: true`, reason `rate-limit`) above the live viewer                                                                                |

**How step 10 was produced.** The running stand was not touched (no env change,
no restart). `ProcessModelScreen` was rendered with `react-dom/server` for the two
degraded `ProcessModelLoad` values, and the markup was injected into the live
page in the browser (`failed` replaces `main.processes-page`; `stale` appends the
notice to the head). The styles are the stand's own; the data is synthetic.

## Parity vs bbm-kb viewer

`kb-*` = the bbm-kb viewer at bbm-kb `5192cc3`, run locally; `portal-*` = this
PR's stand. Same diagram, same viewport, side by side:

| bbm-kb (original)                  | portal (this PR)                       | State                     |
| ---------------------------------- | -------------------------------------- | ------------------------- |
| `parity-kb-03-A-0.png`             | `parity-portal-03-A-0.png`             | A-0 context diagram       |
| `parity-kb-03-A0.png`              | `parity-portal-03-A0.png`              | A0 decomposition          |
| `parity-kb-03-A31.png`             | `parity-portal-03-A31.png`             | A31 third level           |
| `parity-kb-04-A0-box-A3-panel.png` | `parity-portal-04-A0-box-A3-panel.png` | A0, box A3 clicked, panel |
