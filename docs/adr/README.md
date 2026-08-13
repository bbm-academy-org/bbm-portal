# ADRs — BBM Platform engineering decisions

Architecture Decision Records for the BBM Platform code estate. Per ADR-002, platform
engineering ADRs live in this repo (next to the code they govern); holding-level
knowledge lives in `bbm-kb`; platform-wide architecture specs (D-001..D-029) live in
`bbm-platform-prd`.

| #       | Title                                                                                                                                          | Status              | Where                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| ADR-001 | Leads receiver = `Leads` collection in this Payload app                                                                                        | Accepted 2026-06-12 | Recorded in `bbm-public-website/docs/infrastructure-decisions.md` (pre-dates this directory) |
| ADR-002 | [Repository & module strategy for the BBM Platform](./002-repository-and-module-strategy.md)                                                   | Accepted 2026-07-24 | This directory                                                                               |
| ADR-003 | [Domain topology — `cms.bbm.academy` vs `portal.bbm.academy`](./003-domain-topology-cms-vs-portal.md)                                          | Accepted 2026-07-24 | This directory                                                                               |
| ADR-004 | [Platform persistence foundation — the `platform` database, drizzle, and our own migration pipeline](./004-platform-persistence-foundation.md) | Accepted 2026-08-11 | This directory                                                                               |

Numbering is ecosystem-wide and append-only; ADR-001 keeps its historical home.

## ADR canon

**Format.** One file per decision, `NNN-<slug>.md`, English, numbered sections.
Ids are unpadded three digits (`ADR-002`) and are never reused. Every ADR is
listed in the table above with its status and date.

**Statuses.** `Proposed` (written, not yet agreed) → `Accepted <date>` (the rule)
→ `Superseded by ADR-NNN <date>` (a later ADR replaces it wholesale). A
superseded ADR is **kept**, never deleted: it is the only explanation of why the
system used to be shaped the way it was.

**Revising an ADR — two modes, and the trigger is production.** This repo ships:
`portal.bbm.academy` and `cms.bbm.academy` are live, so an ADR is often the
explanation of a running system rather than a plan.

- The decision is **not yet running in production** → **inline rewrite**. The
  body reads as if the current decision were always the decision; the drafting
  history lives in `git log`.
- The decision **is running in production** → **amendment block** (`A1`, `A2`, …)
  appended at the end, with the original section left intact and marked
  `> Superseded by A1 (<date>)`.

Concrete test: if reverting the decision today would need a deploy, a migration,
or a DNS/IdP change, it is running in production. The full procedure — including
the mandatory two-direction cross-reference sweep — is the
[`do-adr-revision`](../../.claude/skills/do-adr-revision/SKILL.md) skill. Reading
ADRs before designing anything is [`read-relevant-adrs`](../../.claude/skills/read-relevant-adrs/SKILL.md).

**ADRs vs specs.** An ADR records an engineering decision and its consequences;
a spec (`docs/specs/`) records what gets built and how the owner verifies it.
A spec cites the ADRs binding it in its `## Prior decisions` section.
