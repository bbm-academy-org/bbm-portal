# ADR-005: Internal-contour surface split — text in the knowledge base, tools in the portal

**Status:** Accepted
**Date:** 2026-08-25
**Decider:** Anton Sidorov (owner) — ruling stated in the 2026-08-25 session dialogue
**Prepared by:** Claude (recorded from the owner ruling after the placement reversals of issue #193, 2026-08-24)
**Related:** ADR-003 (domain topology — `cms.bbm.academy` vs `portal.bbm.academy`), ADR-002 (repository & module strategy — modular monolith), issue #193 (finmodel normative document), issue #330 (this ADR)

## Context

Everything behind login is loosely called "the internal contour", and until now that phrase named an **access** property only — it said nothing about **where a given piece of content should live**. Two surfaces already serve it, in two different repos:

- **`kb.bbm.academy`** — the knowledge base. Repo `bbm-academy-org/bbm-kb`, Fumadocs, static export, fronted by oauth2-proxy against Zitadel. It renders **text**: documents, chapters, narratives. It has no capability to compute anything or to accept user input, by design.
- **`portal.bbm.academy/p/*`** — the platform application. This repo, Next.js modules under the `(platform)` route group behind the Zitadel OIDC gate (ADR-003 §3). It runs code: calculators, charts, accounting-style tooling, anything stateful.

ADR-003 answered _which host may serve which surface_ for the two hosts it knew about, and it answered it as a security question (default-deny per host). It did not answer the editorial question that comes first: **given a new piece of content, which of the two surfaces is it?** With no recorded rule, that question was re-litigated per task, from scratch, by whoever happened to pick the task up.

**The motivating case — the finmodel rules document (issue #193, 2026-08-24).** The normative finmodel document («Смарт-контракт BBM») went through **two placement reversals in a single day**:

1. first it was to be a public portal page;
2. then it was moved behind the gate as `/p/model/rules`;
3. then it was dropped from the portal entirely, because the text was already rendered by its owning repo at `kb.bbm.academy/finmodel`.

None of the three steps was wrong given what was written down at the time; the churn came from the absence of any recorded principle governing the choice. Building a second HTML renderer for a document that the KB already renders is duplicated surface, duplicated styling work, and — worse — a second place the text can drift.

## Decision

### 1. The internal contour has two surfaces, with a strict content split

**Static text → the knowledge base.** `kb.bbm.academy` (repo `bbm-academy-org/bbm-kb`) is the single source of truth for any textual document **and its only reading surface**. The portal never builds a duplicate HTML renderer for plain text — not as a public page, not as a `(platform)` workspace page. The KB is a **static export**: it renders content fixed at commit time, and has no capability to compute, to fetch data at request time, or to take user input.

**Everything dynamic → the portal.** Anything that computes, renders live or derived data, or takes user input — calculators with charts, accounting-style tooling, dashboards, forms — is a `bbm-portal` module at `/p/*` behind the `(platform)` Zitadel gate. This includes surfaces that are **read-only yet data-driven**: the KB cannot host them, whether or not the user ever types anything.

Both surfaces sit in the **internal contour**: reachable only after login. "Internal" here is the **access** contour, **not** a statement about repository consolidation — the surfaces stay in their own repos, exactly as ADR-002 leaves them.

### 2. The decision rule

> For a new surface, ask: **is the deliverable a static document to read — content fixed at commit time — or a tool that computes, renders live data, or takes input?** A static document → a KB page. Everything else → a portal `/p/*` module. A mixed surface splits along that line: the text chapters go to the KB, the interactive part to the portal, cross-linked.

That is one testable sentence, applied before any build starts, and it replaces re-asking the owner about placement.

**"Static" is the discriminator, not "read-only".** A surface can be entirely read-only — no form, no button, nothing the user types — and still belong in the portal, because it renders data that is computed or fetched at request time. The existing `/p/okr` dashboard is exactly that: prose-shaped output, zero user input, and impossible in the KB, which is a **static export** with no data-fetching capability at all. So the question is never "does the user type anything?" but "**is the content fixed at commit time?**" — if it is not, the KB cannot serve it and the surface is a portal module.

### 3. What the portal keeps of a KB-owned text

A committed **snapshot** of a KB-owned document may live in this repo when code has to stay consistent with it — the finmodel case: `src/lib/finmodel/snapshot/rules.mdx` feeds the text↔code consistency guard (#193, PR #325). That snapshot is a **CI concern, not a reading surface**: it is never routed, never rendered to a user, and it stays. Its presence is not a precedent for rendering it.

## Relation to ADR-003

ADR-003 fixes the **domain topology** between `cms.bbm.academy` and `portal.bbm.academy` and the default-deny host→surface mechanics. This ADR **adds the third surface** (`kb.bbm.academy`, a separate deployment in a separate repo, gated by oauth2-proxy rather than by this app's middleware) and states the **content-class rule** between the KB and the portal.

It **refines** ADR-003; it does not amend it. Nothing in ADR-003's host mapping, allowlist mechanics or `/p/*` prefix decision changes: a portal module chosen by this rule mounts exactly as ADR-003 §3 describes.

## Consequences

- **Placement stops being a per-task question.** Presentation-type work — e.g. the `/model` persona set — is scoped by §2 up front instead of re-asking the owner where it goes, and instead of discovering the answer after two reversals.
- **Textual narratives route to the KB repo.** Per the cross-repo boundary in `CLAUDE.md`, the deliverable of a bbm-portal session that surfaces such work is a **filed, epic-linked issue in `bbm-academy-org/bbm-kb`** — not an implementation started here.
- **The portal only gains pages that are tools.** Every new `/p/*` module can be justified in one sentence against §2; a proposed portal page that renders only static prose is, by this ADR, a KB page filed in the wrong repo — while a read-only page over live data is correctly a portal module.
- **One source of truth per document.** A text has exactly one rendering surface, so it cannot drift between two renderers. Where code must track a document, it tracks a snapshot under a guard (§3), which fails loudly instead of drifting silently.
- **Two auth mechanisms remain, deliberately.** The KB is gated by oauth2-proxy → Zitadel, the portal by the in-app OIDC gate (ADR-003). Both point at the same Zitadel; unifying them is not required by this ADR and is not proposed here.

## Rejected alternatives

- **Render KB text inside the portal for "one place to look".** Rejected: it duplicates the renderer and creates a second copy of the text that will drift; the finmodel reversals are the evidence. A cross-link from a portal module to the KB page costs nothing and keeps one source of truth.
- **Move the KB's content into this repo (consolidate the internal contour into one app).** Rejected: "internal" is an access property, not a repo boundary. Consolidation would fold a content estate with its own authoring workflow and its own deployment into the platform application, against ADR-002's repository strategy, and would buy nothing the cross-link does not.
- **Decide placement per task, as before.** Rejected implicitly by the incident: that is precisely the process that produced two reversals in one day on #193.

---

_Numbering is ecosystem-wide and append-only (see `docs/adr/README.md`). Accepted 2026-08-25 from the owner's ruling in session dialogue; no open owner-decision markers remain in this ADR._
