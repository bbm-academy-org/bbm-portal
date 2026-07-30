# CMS→site publish model redesign

- **Issue:** [bbm-portal #40](https://github.com/bbm-academy-org/bbm-portal/issues/40)
- **Status:** Design approved (brainstorming) — ready for implementation plan
- **Date:** 2026-06-23

## Problem

Two controls both read like "publish", and one of them silently lies:

- **In-page "Publish changes"** (Payload-native, in each document editor) promotes
  draft → published **inside the CMS only**. It does NOT rebuild the live static
  site, so editors who expect it to "go live" are wrong — the site stays behind.
- **Dashboard "Publish to site"** (`PublishPanel`) is currently the _only_ thing
  that triggers the static `bbm.academy` rebuild.

Compounding it, the dashboard panel reports **draft state, not site↔CMS drift**:
after a native publish it shows _"No unpublished drafts"_ even though the live
site is still behind — a contradiction the owner flagged. The root cause is the
**publication model**, not the label on one button.

## Goals

1. **No button lies.** Every "publish" affordance results in the change actually
   reaching the live site. The remaining difference between the two entry points
   is **scope** (this one page vs. everything staged), never "live vs. not live".
2. **Honest, current drift indicator** on the dashboard: compare the real _last
   published-content time_ against the real _last successful site build_, and say
   plainly whether the live site matches the CMS — kept fresh without a manual
   reload.
3. **Hide actions that have nothing to do.** The dashboard publish button appears
   only when there is something to publish or the site is behind; when the site is
   in sync, the panel shows status only.

## Non-goals (out of scope for v1)

- **Debounce / coalescing of rebuilds.** Batching is done _manually and
  explicitly_ by the editor (stage as drafts → one dashboard publish). Automatic
  time-window coalescing is a deferred optimization, filed separately only if
  editors actually hit rebuild churn.
- Reworking the GitHub Actions build itself, or the live-preview pipeline.
- Per-surface / partial site builds. The site rebuild stays whole-site and
  idempotent ("last build wins").

## The UX model

Two entry points, split by **scope**; the dashboard is the honest status surface.

1. **Single page → in-page "Publish changes".** The native Payload button now
   publishes that document **and** triggers a whole-site rebuild (via an
   `afterChange` hook). Fast path: no trip to the dashboard. Payload already
   disables this button when the document has nothing new to publish — we do not
   change that.

2. **Several pages → stage as drafts, then one dashboard button.** The editor
   keeps edits as drafts (does not press the in-page publish), then clicks the
   dashboard action, which promotes **all** pending drafts across every surface in
   one transaction and fires **one** rebuild.

3. **Dashboard panel = honest drift indicator.** One of:
   - ✅ **Site matches CMS** — last successful build is newer than the last
     publish. Shows build time. **No action button.** Shown **only when there are
     no pending drafts** (`pendingCount == 0`): `inSync` is published-vs-built and
     ignores unpublished drafts, so with staged drafts the green banner would
     over-claim and contradict the pending list — it is suppressed and the pending
     list + publish button is the message (#50).
   - 🔄 **Building…** — a run is active; links to the run.
   - ⚠️ **Site is behind CMS** — a publish happened after the last successful
     build (hook fired but the run is queued/failed, or a dispatch failed). Shows
     both timestamps + a **"Rebuild site"** button (manual re-push) + a log link
     on failure.

Because **both** entry points make content live, an editor who picks the "wrong"
one still gets a correct result (live content) — at worst one extra rebuild.
There is no longer a button that silently fails to publish.

### Dashboard action button states

| Condition                                           | Button                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pendingCount > 0`                                  | **"Опубликовать N изменений на сайт"** (primary) — batch publish + 1 rebuild |
| `pendingCount == 0` and site **behind** (`!inSync`) | **"Пересобрать сайт"** (secondary) — manual re-push                          |
| `pendingCount == 0` and **in sync**, not building   | _(hidden — status only)_                                                     |
| a run is active (`building`)                        | _(hidden / disabled while "Building…" status shows)_                         |

## Architecture

### Components

1. **`SiteBuildState` global** _(new — requires a migration)_. A versionless,
   drafts-disabled global holding the publish-side truth:
   - `lastPublishedAt: Date | null` — set on every real draft→published transition
     (in-page hook) and by the batch endpoint.
   - `lastDispatchAt: Date | null` _(optional)_ — when a rebuild was last fired.
   - `lastDispatchError: string | null` _(optional)_ — last best-effort dispatch
     failure, surfaced in the "behind" state.

   Being drafts-disabled, writing to it does **not** itself trigger the publish
   hook (it is not a build surface), so there is no loop.

2. **Shared publish-rebuild hook** in `src/lib/siteSync.ts` (collection + global
   `afterChange` adapters over one core). On each surface it fires when **all** of:
   - the document's new `_status === 'published'`, **and**
   - the previous status was not already published (a real publish transition,
     not a re-save of already-published content), **and**
   - `context.skipSiteDispatch` is **not** set.

   Then it: (a) sets `SiteBuildState.lastPublishedAt = now`, and (b) fires
   `dispatchSiteBuild()` **best-effort** — a dispatch failure is logged + recorded
   in `lastDispatchError` but does **NOT** roll back or fail the publish (the
   publish already happened; the drift indicator + manual "Rebuild" are the safety
   net). The dispatch is a quick HTTP 204; it runs without blocking the publish
   response (offloaded, per Payload's "offload long-running hook work" guidance).

   The hook is registered on **all 11 drafts-enabled surfaces** (collections
   `PublicProjects`, `Team`; globals `Philosophy`, `Contact`, `SiteChrome`,
   `PageHome`, `PageAbout`, `PageContacts`, `PageParticipate`, `PagePrivacy`,
   `PageProjects`). A test asserts every drafts-enabled surface in the sanitized
   config has the hook, so a future surface can't silently miss it.

3. **`publishSite.ts` batch endpoint (modified).** Unchanged transactional
   promote-then-dispatch, with two additions:
   - every promote `update` passes `context: { skipSiteDispatch: true }` so the
     per-doc hook does **not** double-fire a rebuild → batch = exactly one build;
   - on commit it sets `SiteBuildState.lastPublishedAt = now` once, then performs
     the single `dispatchSiteBuild()` (as today, inside the rollback guard).

4. **`GET /api/site-sync-status` (new consolidated read).** One fetch that powers
   the whole panel, so it is always current:

   ```
   {
     pendingCount: number,                 // from the drafts-derived surfaces
     lastPublishedAt: string | null,       // SiteBuildState
     lastSuccessfulBuildAt: string | null, // latest completed+success run time
     currentRun: { status, conclusion, html_url, startedAt } | null,
     inSync: boolean,                      // lastSuccessfulBuildAt >= lastPublishedAt
     building: boolean
   }
   ```

   `inSync` is true when there is a successful build at least as new as the last
   publish (or when nothing has ever been published). Reuses `siteDispatch.ts`
   credentials/repo. `lastSuccessfulBuildAt` comes from the GitHub runs API
   filtered to the latest successful `repository_dispatch` run; `currentRun` is the
   latest run regardless of conclusion (drives "Building…"/"Failed").

5. **`PublishPanel.tsx` (rewritten).** Consumes `site-sync-status`:
   - renders the three-state drift indicator from `inSync` / `building` /
     `currentRun.conclusion`;
   - renders the scope-correct action button per the table above (hidden when in
     sync);
   - keeps the confirm-list of pending drafts when `pendingCount > 0` (it still
     fetches `pending-changes` for the labelled list, or the list is folded into
     the sync payload — implementation detail for the plan);
   - **freshness:** polls `site-sync-status` fast (~4s) while `building`, slow
     (~20–30s) while idle, and re-fetches on window/tab focus, so another editor's
     publish or a finished build shows up without a manual reload.

6. **`pending-changes` / `site-build-status` endpoints.** `pending-changes` stays
   as the labelled confirm-list source. `site-build-status` may stay for
   back-compat or be subsumed by `site-sync-status` (plan decides); no behavior
   the panel depends on is lost.

### Data flow

**Single-page publish (in-page button):**

```
editor clicks native "Publish changes"
  → payload.update(_status: published)
  → afterChange hook: real transition, no skip flag
      → SiteBuildState.lastPublishedAt = now
      → dispatchSiteBuild()  (best-effort, non-blocking)
  → dashboard (open elsewhere) polls site-sync-status → "Building…" → "Site matches CMS"
```

**Multi-page batch (dashboard button):**

```
editor stages pages A,B,C as drafts (no in-page publish)
  → dashboard "Опубликовать 3 изменения" → POST /api/publish-site
      → txn: promote A,B,C with context.skipSiteDispatch  (hook suppressed)
      → set SiteBuildState.lastPublishedAt = now
      → dispatchSiteBuild() once → commit
  → panel polls → one build → "Site matches CMS"
```

**Failed / still-queued build (drift):**

```
publish happened, lastPublishedAt = t1
  → build dispatch failed OR run still queued/failed
  → lastSuccessfulBuildAt < t1 → inSync=false
  → panel: "⚠ Site is behind CMS (published t1, last built t0)" + "Пересобрать сайт" [+ log link]
```

## Error handling

- **In-page hook dispatch failure** is non-fatal: the publish succeeds, the error
  is logged + recorded in `lastDispatchError`, and the panel shows "behind" with a
  manual Rebuild. Never roll back a native publish for a downstream hiccup.
- **Batch endpoint** keeps its existing strict invariant: promotes are
  transactional and roll back if the single dispatch fails (never "promoted in CMS
  but build never started" for the batch path).
- **`site-sync-status`** missing credentials → 500 (fail loudly, as today); GitHub
  network/non-2xx → 502-class; "no run yet" → well-formed nulls, never a 500.
- **Polling self-heal** (existing): transient poll failures don't permanently wedge
  the panel; after N consecutive failures it stops and re-enables manual action.

## Testing

- **Unit / integration:**
  - hook fires dispatch + sets `lastPublishedAt` on a real draft→published
    transition; does **not** fire on a re-save of already-published content; does
    **not** fire when `context.skipSiteDispatch` is set.
  - batch endpoint: 3 staged drafts → exactly **one** `dispatchSiteBuild()` call
    and one `lastPublishedAt` write (hook suppressed).
  - hook dispatch failure does not fail/rollback the publish.
  - `site-sync-status`: `inSync` true/false against published-vs-build timestamps;
    "no run yet"; building; failed.
  - registration guard: every drafts-enabled surface in the sanitized config has
    the rebuild hook.
- **E2E (`tests/e2e/publish-panel.e2e.spec.ts` rewritten):** stub
  `site-sync-status` to drive: in-sync (no button) → behind (Rebuild shown) →
  pending drafts (Publish N shown) → building → matches. Replaces the obsolete
  "No unpublished drafts / button stays enabled" assertions.

## Migration & deploy notes

- This redesign **adds a migration** (the new `SiteBuildState` global table) —
  unlike the recent app-only deploys (#37/#38). Generate with `pnpm migrate:create`
  and run `pnpm migrate` on prod as part of the deploy (Node 22; dev DB on
  TrueNAS-over-SSH `:5444` per project notes).
- No service-token shortcuts for prod writes (AGENTS.md host-ops rule). The agent
  owns host-ops (`portal-prod-tw`) and runs review→merge itself; no auto-deploy on
  main.

## Resolved decisions

- **Model:** one-step "publish = live" via `afterChange` hook (the idiomatic
  Payload pattern: publish hook → downstream deploy hook), with the dashboard
  button kept as the explicit **batch** path + manual rebuild safety net — not as
  the only way to go live.
- **No debounce in v1.** Manual staging-as-drafts is the batching story.
- **Drift via persisted `lastPublishedAt`**, not derived from `updatedAt`
  (autosave bumps `updatedAt` on drafts and would give false "behind").
- **Hide the action button when in sync.** Native in-page button state stays
  Payload-managed.
