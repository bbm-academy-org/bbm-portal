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
_(No open entries. Swept 2026-07-30 (#92): the /p/hours upsert-without-prefill
line — the very gap the money rule above now bans from this file — was fixed in
#85/#86, not written off.)_
