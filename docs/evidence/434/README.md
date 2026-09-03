# #434 — acceptance evidence

The stage-5 journey of PR for issue #434, run by the agent with Playwright
against a live stand (`PORT=3001`, branch database `platform_434`, 15 seeded
members with aliases). Ten steps × two breakpoints (desktop 1440×900, mobile
390×844) × two themes (light, and dark via the theme's own `.dark` class — the
workspace ships no user-facing theme switch, so dark is exercised the only way it
exists today).

| Step | What it shows                                                                        |
| ---- | ------------------------------------------------------------------------------------ |
| 01   | the members register through the `data-table` block                                  |
| 02   | search narrowing the register (a permanent Refine filter)                            |
| 03   | the member record, read mode                                                         |
| 04   | the member record, edit mode — the `form` block and the identity/treatment separator |
| 05   | per-field validation in place, under the field that is wrong                         |
| 06   | a successful save, acknowledged by the shell's sonner toast                          |
| 07   | the alias `Dialog`                                                                   |
| 08   | the alias delete `AlertDialog` — the confirmation that did not exist before          |
| 09   | the create screen                                                                    |
| 10   | **AC2** — a Refine MUTATION FAILURE rendering a toast through `notificationProvider` |

The pointer cursor (AC3) is asserted in the journey rather than photographed:
every run reports `cursor: {"enabled":"pointer","disabled":"default"}` on a plain
`<button>`, with no `cursor-pointer` class anywhere in `src`.

The journey script itself is not committed: it is a one-off bound to this seed
dataset, and the durable coverage is `tests/e2e/member-admin.e2e.spec.ts` plus
`tests/e2e/member-admin-pagination.e2e.spec.ts`.
