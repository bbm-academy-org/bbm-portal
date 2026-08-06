---
name: research-ui-element
description: Dispatch an Opus subagent to research ONE element class that the whitelist registry does not cover — real reference pages, the permissive-registry search, 2-3 rendered options for the owner's Stage-A pick, and a drop-in whitelist row. Use before building an element class whose look is genuinely open. Project-local; this repo only.
---

# research-ui-element — research one element class, once

**Kind:** procedural · **Mode:** dispatch (the lead dispatches a fresh-context
Opus subagent; the lead itself never does this research inline — that is how it
turns into three plausible sentences instead of research).

Its output is **one row plus its backing section** for
[`docs/design/ui-whitelist.md`](../../../docs/design/ui-whitelist.md): written
once, reused afterwards. A class already in the registry is **never**
re-researched.

## When to dispatch (the lead's gate)

- **Dispatch** when the task builds an element class the registry does not cover
  **and** the look is genuinely open — i.e. `design-source/` does not already
  settle it. First menu, first modal, first data table, first date control.
- **Do NOT dispatch** when the class is covered by the registry, or when the
  vendored design source already specifies it. Reuse. Re-researching a settled
  class is exactly the waste the registry exists to prevent.
- **Not research, but a revision** — a settled class that genuinely must change
  is an edit to its registry row with the driver recorded in the PR.

Today the registry is empty, so most classes qualify on the first test — apply
the second one honestly: if the owner's vendored design already shows the
element, you have your answer and need no subagent.

Dispatch per CLAUDE.md → "Subagents and models": explicit `model: opus`, return
contract ≤30 lines, heavy output to a scratchpad file.

---

## Subagent brief (paste this as the subagent's instructions)

You are a UI-element researcher for **bbm-portal** (Next.js 16 + React 19, Payload
CMS; proprietary/`UNLICENSED`; no UI kit, no tokens file, no showcase). You
research **one element class** and return **one whitelist entry**. You do not
write production UI, do not adopt code into the repo, and do not open a PR. Your
deliverable is a researched, owner-pickable proposal.

**Input from the lead:** the element class; the target surface and the concrete
job it must do; the path of the relevant `design-source/` file if one exists; the
content states it must hold.

**Procedure**

1. **Read what the repo already has.** `design-source/` (does the owner's design
   already answer this?), `docs/design/ui-whitelist.md` (is it in fact covered?),
   and the existing surfaces (`src/app/(platform)/**`, `src/modules/**`,
   `src/components/PublishPanel.tsx`) so the proposal matches the house look
   rather than importing a foreign one.
2. **Search the permissive registries and record the result** — shadcn/ui
   (Radix) · Origin UI · Intent UI / JollyUI (React-Aria) · Kibo UI. Note
   license, RSC boundary, a11y, dependency weight, freshness. If none fit, state
   the **negative result explicitly** — that is what justifies bespoke. This repo
   is proprietary: MIT/permissive only, adopted as **owned code** (copied and
   re-skinned), never a runtime UI-kit dependency.
3. **Web-first best practice — fetch real pages, cite URLs.** `WebFetch` the
   actual references: GOV.UK Design System · GitHub Primer · Shopify Polaris ·
   IBM Carbon · Adobe React-Aria · NN/g · Baymard. Extract the concrete rule
   (states, spacing, a11y, contrast, focus, reduced motion) with the URL. A claim
   "confirmed" from a search-result snippet is not research — open the page.
   Web design systems lead; do not lead with Material/Android.
4. **Build 2–3 rendered options.** A standalone HTML preview, screenshotted at
   production width, showing each option **in the state that exhibits the
   difference** — not three happy-path thumbnails. A look decision is never a
   text questionnaire (task-cycle stage 1b: the owner picks from something they
   can see).
5. **Say how it is implemented here.** Which file it would live in, what it
   depends on, and — honestly — whether it should wait for the UI kit (#112)
   instead of hardening a one-off now.

**Return contract.** Write the full section to the scratchpad file the lead
names. Your final message = that file path + the screenshot paths + a ≤10-line
summary with your recommended pick and why. Do not paste the section into the
reply.

**Section shape (drop-in for the whitelist doc):**

```md
## <element class> · status: researched

**Unit & states.** …
**Best-practice rule + citations.** … (real URLs you fetched)
**Registry search.** shadcn/… | Origin/… | Intent·Jolly/… | Kibo/… → adopted <x> @ <license> / no fit because …
**Rendered options.** <2–3, screenshot paths; owner pick left blank>
**Implementation here.** <file, deps, or "wait for #112 because …">
```

**Failure modes**

- Researching a class the vendored design or the registry already settles.
- Citing snippets instead of fetched pages.
- Text options instead of rendered ones.
- Recommending a runtime UI-kit dependency, or a paid/proprietary registry's
  code, into a proprietary repo.
- Pasting the whole section into the reply instead of the scratchpad file.

---

## What the lead does with the result

Present the rendered options to the owner (**Stage A**, task-cycle 1b), record
the pick in the issue, then build it via
[`build-ui-from-design-system`](../build-ui-from-design-system/SKILL.md). The
whitelist row is added once the built class actually shipped and passed Stage B —
a researched-but-unbuilt class is a proposal, not a settled standard.
