# DEBT.md — minor convention deviations (decision-debt lite)

Rules (issue #65, owner decision 2026-07-24):

- **Significance threshold:** anything serious gets its own GitHub issue —
  never a line here. This file is for small, deliberate deviations only.
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

- [ ] 2026-07-30 Форма участника в админке часов — полный upsert без предзаполнения: правка существующего участника с пустыми вилкой/грейдом молча обнуляет их (после снятия required это денежное поле — вычисленная ставка исчезает). Осознанно оставлено ради простоты MVP-формы — return condition: первый инцидент обнуления вилки/грейда у реального участника → предзаполнение формы или merge-семантика пустых полей (#83)
