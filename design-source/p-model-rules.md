# `/p/model/rules` — «Смарт-контракт BBM», Stage-A pick (issue #193)

Owner pick, 2026-08-24 (AskUserQuestion in the #193 session; recorded in the
issue comment). Fidelity: described layout — the lowest Stage-A permits; the
description below is the picked option **verbatim** (option «Документ с
оглавлением», the recommended one of three).

## Placement ruling (same ask, first question)

The page is **NOT public**: it lives at `/p/model/rules` inside the Zitadel-gated
`(platform)` route group (same gate as `/p/hours`), visible to signed-in BBM
members only. This is an owner revision of the finmodel presentation spec §6
(«Смарт-контракт — открыто после юр-валидации») and of the issue #193 body
(«renders it publicly»): the page is part of the portal workspace being stood up
(epic #112), not of a public `/model` section. The legal-validation owner gate
stops being a visibility blocker.

## Picked layout — «Документ с оглавлением»

Двухколоночная на десктопе: слева липкое оглавление (собирается из заголовков
разделов — «Из каждых 100 рублей», «Я работаю», «Я автор», «Я инвестор»,
«Я врач», словарь), справа колонка документа ~720px. На мобильном оглавление
сворачивается наверх. Плюс: в длинном документе роль сразу находит свой раздел —
это главный сценарий чтения по спеке.

```
┌────────────┬──────────────────────────────┐
│ Оглавление │  Смарт-контракт BBM   [драфт]│
│ • Из 100 ₽ │                              │
│ • Я работаю│  Это правила, по которым…    │
│ • Я автор  │                              │
│ • Я инвестор  ## Из каждых 100 рублей     │
│ • Я врач   │  1. Резерв — 15%…            │
│ • Словарь  │  2. Оплата команды…          │
│  (липкое)  │  …                           │
│            │──────────────────────────────│
│            │  версия f1d15e1 · 2026-08-24 │
└────────────┴──────────────────────────────┘
```

Content set the layout must hold: page title «Смарт-контракт BBM»; the draft
marker (the document is a draft until the two owner gates — legal wording,
Eduard's glossary/weights confirmation); the full rendered MDX document from
`src/lib/finmodel/snapshot/rules.mdx` with `<V/>` numbers substituted from the
snapshot (headings, tables, blockquotes, ~10 screens); footer with the snapshot
version passport (commit sha, 7 chars + date).

## States the picked option does NOT show

- TOC behaviour while scrolling (active-section highlight) — implementer's call,
  not required.
- Mobile collapsed-TOC interaction (static list on top is acceptable v1).
- Error state: snapshot missing/unresolvable `<V/>` — build/test failure by
  design (never a silent dash), so no runtime error UI.
- Loading state: none — RSC, server-rendered.
