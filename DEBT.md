# DEBT.md — minor convention deviations (decision-debt lite)

Rules (issue #65, owner decision 2026-07-24; #92, 2026-07-30):

- **Significance threshold:** anything serious gets its own GitHub issue —
  never a line here. This file is for small, deliberate deviations only.
- **"First incident" is a BANNED return condition** for gaps touching
  money/computed data or the only editing path for an entity — those are not
  small deviations and go straight to their own issue (#92, 2026-07-30).
- **Every line carries a return condition** (what event or date brings it
  back). Lines without one do not survive a sweep.
- **Mandatory sweep** on every `/wrap` and at every epic close: each line is
  either fixed, promoted to an issue, or explicitly written off — never
  silently kept.

Entry format:

```
- [ ] YYYY-MM-DD <what was deviated & why> — return condition: <trigger> (#N)
```

<!-- entries below this line -->

- [ ] 2026-08-04 `set-board-status.mjs`: `process.exit(0)` сразу после записи
      «ГОТОВО» — на Windows-TTY запись асинхронна, тот же класс, что #132
      (обрезанный вывод при сделанной работе); лечится `return` вместо exit.
      Замечание ревью PR #141 — return condition: первый случай обрезанного
      «ГОТОВО» или ближайший рефактор runBoardStatus (#132)

- [ ] 2026-08-04 Тесты `gh-board-tools`: фикстуры `parsed` собраны руками, не
      через parseArgs — дрейф CLI-контракта тесты не поймают. Замечание ревью
      PR #141 — return condition: первое изменение CLI-флагов set-board-status (#132)

- [ ] 2026-07-31 Указанный в task-cycle skill `frontend-design` отсутствует и в
      репозитории, и в доступном каталоге; для #100 использованы согласованный
      владельцем wireframe и существующая дизайн-система `hours.css`. Это
      process deviation, не product gap — return condition: восстановить или
      зарегистрировать skill до следующей owner-visible frontend-задачи (#100)

- [ ] 2026-07-30 `worktree-teardown.mjs`: в robocopy-фолбэке финальный
      `cmd /c rmdir /s /q \\?\<путь>` — no-op (cmd.exe не понимает `\\?\`-префикс);
      первая ступень PS 5.1 отрабатывает, так что исход — честный exit 1, не потеря
      данных. Лечится вызовом rmdir с обычным `winPath` — return condition: первый
      реальный заход в robocopy-фолбэк (teardown упал с exit 1 на long-path) (#90)

_(Swept 2026-07-30 (#92): the /p/hours upsert-without-prefill line — the very
gap the money rule above now bans from this file — was fixed in #85/#86, not
written off.)_
