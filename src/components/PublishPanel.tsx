'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Banner, Button } from '@payloadcms/ui'

/**
 * #45 — admin publish panel, rebuilt for the "publish = live" model (#40).
 *
 * Registered via `admin.components.beforeDashboard` in payload.config.ts, so it
 * renders at the top of the Payload admin dashboard (admin-only by virtue of the
 * panel's auth). It is an internal tool: it uses Payload's own UI primitives
 * (`Button`, `Banner`) and admin CSS variables, NOT a separate brand aesthetic.
 *
 * The redesign moved "go live" onto the native in-page "Publish changes" button
 * (an `afterChange` hook fires a whole-site rebuild, #42). So this panel is no
 * longer the only path to production — it becomes two things:
 *
 *   (a) an HONEST site↔CMS drift indicator: is the live site current with what
 *       has been published in the CMS, is a build running, or has it fallen
 *       behind (a publish landed but its build hasn't succeeded yet)? and
 *   (b) the explicit BATCH publish path + manual rebuild safety net.
 *
 * Primary data source is `GET /api/site-sync-status` (#44) — ONE consolidated
 * read that joins pending-draft count, the publish-side `lastPublishedAt`, and
 * the GitHub Actions run state into a single shape. Driving the whole panel off
 * one endpoint keeps the indicator and the button always mutually consistent.
 *
 * Indicator (#52) — driven by ONE server-computed `syncState` enum
 * (`'in-sync' | 'building' | 'failed'`), which replaces the old overloaded
 * `inSync`/`building` booleans. `data-status` mirrors `syncState` directly. The
 * three states (visible once the first read lands):
 *   - 'building'                 → 🔄 "Идёт сборка…" (+ view-run link when
 *                                  present), regardless of pendingCount. This now
 *                                  INCLUDES the post-publish "run not yet
 *                                  registered" gap, so a normal publish no longer
 *                                  flashes red.
 *   - 'failed'                   → ⚠️ red "Сборка упала (…timestamps…)" (+ a build
 *                                  log link when present) + the rebuild button,
 *                                  regardless of pendingCount. The server scopes
 *                                  this to a terminal failed run for THIS publish.
 *   - 'in-sync' && pendingCount===0 → ✅ "Сайт совпадает с CMS" (+ last build time);
 *   - 'in-sync' && pendingCount>0   → NOTHING in the green slot (#50).
 *     `syncState` is published-vs-built and ignores unpublished drafts, so with
 *     staged drafts the green "matches CMS" banner would over-claim and
 *     contradict the pending list — the pending list + publish button below IS
 *     the message. `data-status` stays "in-sync" (the published content is live).
 *
 * Action button (scope-correct; HIDDEN when there is nothing to do):
 *   - pendingCount > 0 && syncState !== 'building' → primary "Опубликовать N
 *                                  изменений на сайт" (batch publish + rebuild);
 *   - pendingCount === 0 && syncState === 'failed' → secondary "Пересобрать сайт"
 *                                  (manual rebuild safety net);
 *   - syncState === 'in-sync' (no pending) → NO button (status only);
 *   - syncState === 'building'   → NO button (the build is already running).
 * Both buttons POST `/api/publish-site` (the batch endpoint also rebuilds).
 *
 * Confirm-list: when `pendingCount > 0` we fetch `GET /api/pending-changes` and
 * list the labelled pending surfaces/docs (transparency / multi-editor safety).
 *
 * All requests use `credentials: 'include'` so the admin session cookie is sent
 * (every endpoint is admin-gated).
 */

// Poll cadences. FAST while a build is in flight so "building → done" lands
// quickly; SLOW while idle so an open dashboard still drifts toward truth (a
// publish made elsewhere, a build that finished) without hammering GitHub.
const FAST_POLL_MS = 4000
const SLOW_POLL_MS = 25000

// How many CONSECUTIVE poll failures we tolerate before backing off. A single
// transient blip (network, a brief 502 from the GitHub proxy behind
// site-sync-status) must NOT wedge the panel, so we keep polling across errors
// and only after this many in a row surface a hard notice — but we KEEP a slow
// poll alive so the panel still self-heals once the backend recovers.
const MAX_CONSECUTIVE_POLL_ERRORS = 3

type PendingSurface = {
  surface: string
  type: 'collection' | 'global'
  ids: Array<number | string>
  labels?: string[]
}
type PendingChanges = { pending: PendingSurface[]; count: number }

/** The current GitHub Actions run, as surfaced by `/api/site-sync-status`. */
type CurrentRun = {
  status: string | null
  conclusion: string | null
  html_url: string | null
  startedAt: string | null
}

/** The server-computed sync state (#52). Mirrors siteSyncStatus.ts's enum. */
type SyncState = 'in-sync' | 'building' | 'failed'

/** The consolidated drift read (`GET /api/site-sync-status`, #44, #52). */
type SiteSyncStatus = {
  pendingCount: number
  lastPublishedAt: string | null
  lastSuccessfulBuildAt: string | null
  currentRun: CurrentRun | null
  syncState: SyncState
}

/**
 * A run has FAILED iff it reached a terminal, non-success conclusion. GitHub
 * sets `conclusion` only once a run completes; while queued/in_progress it is
 * null. So a non-null conclusion that isn't `success` is a real failure (e.g.
 * `failure`, `cancelled`, `timed_out`) and earns a build-log link in the 'failed'
 * state. The server uses the SAME definition to compute `syncState === 'failed'`
 * (keep them consistent); here it just decides whether to render the log link.
 */
const runFailed = (run: CurrentRun | null): boolean =>
  run != null && run.conclusion != null && run.conclusion !== 'success'

const fetchJSON = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, { credentials: 'include', ...init })
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      detail = body?.error ?? ''
    } catch {
      /* non-JSON error body — fall through to the status text */
    }
    throw new Error(detail || `Request failed (HTTP ${res.status})`)
  }
  return (await res.json()) as T
}

/**
 * Format an ISO time as Russian `DD.MM.YYYY HH:MM:SS` (24-hour, local time, no
 * AM/PM). Built from the date parts rather than `toLocaleString` so the format is
 * locale-independent (an editor's US-locale browser must not flip it to M/D/YYYY
 * with AM/PM). Defensive: null / invalid → an em dash, never a crash.
 */
const formatTime = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `${date} ${time}`
}

/**
 * Russian pluralization for "изменение" (change): 1 → изменение, 2–4 →
 * изменения, 0/5+ → изменений (with the usual 11–14 exception). Used to build
 * the batch button's "Опубликовать N изменени… на сайт" label correctly.
 */
const pluralizeChanges = (n: number): string => {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'изменений'
  const mod10 = n % 10
  if (mod10 === 1) return 'изменение'
  if (mod10 >= 2 && mod10 <= 4) return 'изменения'
  return 'изменений'
}

export const PublishPanel: React.FC = () => {
  const [sync, setSync] = useState<SiteSyncStatus | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingChanges | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Held timer + a mounted flag so polling stops on unmount (no setState after
  // unmount, no infinite poll). A ref avoids re-creating the poll loop on render.
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  // Count of CONSECUTIVE poll failures; reset to 0 on any successful poll. Drives
  // the self-heal: tolerate transient errors, surface a hard notice only after a
  // sustained run — but never stop polling, so the panel recovers on its own.
  const pollErrorsRef = useRef(0)
  // True WHILE a `pollStatus` read is in flight. A focus event or an onPublish
  // can fire a poll while an earlier one is still mid-`await`; without this guard
  // each would start a second concurrent fetch and each completion would call
  // `schedule()`, spawning a SECOND timer chain (the first is leaked). Repeated
  // focus events would fan that out unboundedly and hammer the GitHub-backed
  // endpoint. So overlapping entrants early-return; the in-flight poll reschedules.
  const isPollingRef = useRef(false)
  // Tracks the previous `building` value so we can detect a build COMPLETING
  // (building → not building) and refresh the pending list at that edge (the
  // surfaces that just shipped are now published, so the confirm-list shrinks).
  const wasBuildingRef = useRef(false)

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const loadPending = useCallback(async () => {
    try {
      const data = await fetchJSON<PendingChanges>('/api/pending-changes')
      if (mountedRef.current) {
        setPending(data)
        setPendingError(null)
      }
    } catch (err) {
      if (mountedRef.current) setPendingError((err as Error).message)
    }
  }, [])

  // One status read + recursive scheduling. The loop body is held in a ref so the
  // `setTimeout` re-fire references the latest function without `pollStatus`
  // referring to itself before declaration (the recursion goes through
  // `pollFnRef`, set in an effect below). The cadence is data-driven: FAST while
  // building, SLOW while idle. The loop NEVER stops on its own — `building` just
  // changes how often it runs — so an open dashboard always trends toward truth.
  const pollFnRef = useRef<() => void>(() => {})

  const schedule = useCallback((building: boolean) => {
    // Clear before set so the stored timer is always the ONLY live one — a stray
    // earlier timer (e.g. one whose `pollStatus` was just superseded) can never be
    // overwritten-and-leaked into a second concurrent chain.
    if (pollRef.current) clearTimeout(pollRef.current)
    pollRef.current = setTimeout(
      () => pollFnRef.current(),
      building ? FAST_POLL_MS : SLOW_POLL_MS,
    )
  }, [])

  const pollStatus = useCallback(async () => {
    // Overlap guard: if a read is already in flight (a focus/publish fired while
    // an earlier poll is mid-`await`), do NOT start a second concurrent fetch —
    // the in-flight poll will reschedule on completion. Without this, two reads
    // would each call `schedule()` and spawn two timer chains.
    if (isPollingRef.current) return
    isPollingRef.current = true
    try {
      const status = await fetchJSON<SiteSyncStatus>('/api/site-sync-status')
      if (!mountedRef.current) return
      // A good read clears any prior transient error and resets the failure run.
      pollErrorsRef.current = 0
      setSyncError(null)
      setSync(status)

      // Edge: a build just COMPLETED (was building, now isn't). Refresh the
      // confirm-list — the surfaces that shipped are published now, so pending
      // should have shrunk (typically to zero). `wasBuildingRef` is updated
      // AFTER the comparison so we only fire once per transition.
      const isBuilding = status.syncState === 'building'
      if (wasBuildingRef.current && !isBuilding) {
        void loadPending()
      }
      wasBuildingRef.current = isBuilding

      if (mountedRef.current) schedule(isBuilding)
    } catch (err) {
      if (!mountedRef.current) return
      // A transient poll failure must NEVER wedge the panel: we keep the last
      // good `sync` on screen and keep polling. After MAX_CONSECUTIVE_POLL_ERRORS
      // in a row we surface a hard notice, but STILL reschedule on the SLOW
      // cadence so the panel self-heals once the backend recovers — there is no
      // terminal "stuck" state, only "stale + retrying".
      pollErrorsRef.current += 1
      if (pollErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
        setSyncError(
          `Не удалось прочитать статус синхронизации после ${MAX_CONSECUTIVE_POLL_ERRORS} попыток ` +
            `(${(err as Error).message}). Показаны последние данные — повтор продолжается.`,
        )
      } else {
        setSyncError(`Проверка статуса не удалась, повтор… (${(err as Error).message})`)
      }
      // Reschedule SLOW while erroring, regardless of the last known `building`.
      schedule(false)
    } finally {
      // Always release the in-flight flag, even on an early unmount return — so a
      // remount / the next timer fire can poll again.
      isPollingRef.current = false
    }
  }, [loadPending, schedule])

  // Keep the ref pointed at the latest `pollStatus` so scheduled re-fires (and
  // the focus listener / timeout closures) always invoke the current impl.
  useEffect(() => {
    pollFnRef.current = () => void pollStatus()
  }, [pollStatus])

  // On mount: read the sync status once and, if there are pending drafts, load
  // the confirm-list. The sync read also seeds the recursive poll loop (via
  // `pollStatus`'s own reschedule). All state updates here happen AFTER an
  // `await` (async network I/O), so none is a synchronous-in-effect render.
  const bootstrap = useCallback(async () => {
    try {
      const status = await fetchJSON<SiteSyncStatus>('/api/site-sync-status')
      if (!mountedRef.current) return
      setSync(status)
      setSyncError(null)
      const isBuilding = status.syncState === 'building'
      wasBuildingRef.current = isBuilding
      if (status.pendingCount > 0) void loadPending()
      schedule(isBuilding)
    } catch (err) {
      // A status read failure on mount is non-fatal: surface it and start a SLOW
      // retry loop so the panel still self-heals once the backend recovers.
      if (!mountedRef.current) return
      setSyncError((err as Error).message)
      schedule(false)
    }
  }, [loadPending, schedule])

  useEffect(() => {
    mountedRef.current = true
    // `bootstrap` only ever calls setState AFTER an `await` (async network I/O),
    // so it never triggers a synchronous cascading render — it is a fire-and-
    // forget data load, the intended use of an effect. The compiler rule cannot
    // see through the async boundary, hence the precise, justified disable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void bootstrap()

    // Re-fetch on window focus so returning to the tab shows fresh state without
    // waiting out the slow poll. We clear the pending timer and poll immediately;
    // `pollStatus` reschedules itself at the correct cadence afterwards.
    const onFocus = () => {
      clearPoll()
      pollFnRef.current()
    }
    window.addEventListener('focus', onFocus)

    return () => {
      mountedRef.current = false
      clearPoll()
      window.removeEventListener('focus', onFocus)
    }
  }, [bootstrap, clearPoll])

  const onPublish = useCallback(async () => {
    setActionError(null)
    setPublishing(true)
    try {
      await fetchJSON('/api/publish-site', { method: 'POST' })
      // Optimistically reflect "building" until the first status poll lands, so
      // the indicator flips immediately and the action button hides. The real
      // run state replaces this on the next poll (kicked off right below).
      if (mountedRef.current) {
        setSync((prev) =>
          prev
            ? { ...prev, syncState: 'building' }
            : {
                pendingCount: 0,
                lastPublishedAt: null,
                lastSuccessfulBuildAt: null,
                currentRun: null,
                syncState: 'building',
              },
        )
        wasBuildingRef.current = true
      }
      clearPoll()
      pollErrorsRef.current = 0 // fresh publish → fresh retry budget
      pollFnRef.current() // poll now; it reschedules on the FAST cadence
    } catch (err) {
      if (mountedRef.current) setActionError((err as Error).message)
    } finally {
      if (mountedRef.current) setPublishing(false)
    }
  }, [clearPoll])

  const pendingCount = sync?.pendingCount ?? 0
  const hasPending = pendingCount > 0
  // Default to 'in-sync' before the first read so no button/banner renders early.
  const syncState: SyncState = sync?.syncState ?? 'in-sync'
  const building = syncState === 'building'

  // The action button decision table (see the file header), re-derived from the
  // single `syncState` enum (#52). Exactly one is true at a time, and both map to
  // the SAME POST /api/publish-site:
  //   - hasPending && !building       → primary batch publish ("Опубликовать N…");
  //   - !hasPending && syncState==='failed' → secondary manual rebuild ("Пересобрать сайт").
  // In every other case (in-sync with no pending, or building) NO button renders —
  // the e2e asserts the button is ABSENT from the DOM in the in-sync/building states.
  const showBatchPublish = hasPending && !building
  const showRebuild = !hasPending && syncState === 'failed'
  const showActionButton = showBatchPublish || showRebuild

  return (
    <div
      style={{
        border: '1px solid var(--theme-elevation-150)',
        borderRadius: 'var(--style-radius-m, 4px)',
        padding: 'var(--base, 20px)',
        marginBottom: 'calc(2 * var(--base, 20px))',
        background: 'var(--theme-elevation-50)',
      }}
    >
      <h2 style={{ marginTop: 0 }}>Публикация на сайт</h2>

      {/* 1 — drift indicator (always visible once the first read lands). The
          `data-status` lives on this wrapping <section> (Payload's <Banner> does
          not forward data-* attributes), and exactly one branch renders, so the
          wrapper's status is unambiguous for the e2e. */}
      <section
        data-testid="sync-status"
        data-status={sync ? sync.syncState : undefined}
        style={{ marginBottom: 'var(--base, 20px)' }}
      >
        {syncError && (
          <div style={{ marginBottom: sync ? 'var(--base, 20px)' : 0 }}>
            <Banner type="error">Не удалось загрузить статус синхронизации: {syncError}</Banner>
          </div>
        )}
        {sync == null ? (
          syncError ? null : (
            <p style={{ color: 'var(--theme-elevation-400)', margin: 0 }}>
              Проверка синхронизации сайта…
            </p>
          )
        ) : sync.syncState === 'building' ? (
          // Includes the post-publish "run not yet registered" gap (#52): the
          // server returns 'building', not red, for a normal in-flight publish.
          <Banner type="info">
            🔄 Идёт сборка…{' '}
            {sync.currentRun?.html_url ? (
              <a href={sync.currentRun.html_url} target="_blank" rel="noreferrer">
                посмотреть запуск
              </a>
            ) : null}
          </Banner>
        ) : sync.syncState === 'failed' ? (
          <Banner type="error">
            ⚠️ Сборка упала (опубликовано {formatTime(sync.lastPublishedAt)}, собрано{' '}
            {formatTime(sync.lastSuccessfulBuildAt)}).{' '}
            {runFailed(sync.currentRun) && sync.currentRun?.html_url ? (
              <a href={sync.currentRun.html_url} target="_blank" rel="noreferrer">
                лог сборки
              </a>
            ) : null}
          </Banner>
        ) : (
          // syncState === 'in-sync'. #50: the green "matches CMS" banner is HONEST
          // only with no staged drafts. `syncState` is published-vs-built and
          // deliberately ignores unpublished drafts (siteSyncStatus.ts), so once
          // pendingCount > 0 the CMS holds changes the live site does not reflect
          // — the green banner would over-claim and contradict the pending list
          // below. Suppress it; the pending list + batch publish button is the
          // message. (data-status stays "in-sync": the published content is live.)
          sync.pendingCount > 0 ? null : (
            <Banner type="success">
              ✅ Сайт совпадает с CMS (собрано {formatTime(sync.lastSuccessfulBuildAt)}).
            </Banner>
          )
        )}
      </section>

      {/* 2 — confirm-list of pending changes (only when there are any). Same
          rendering as before; reuses data-testid="pending-changes" /
          "pending-item" that the e2e relies on. */}
      {hasPending && (
        <section data-testid="pending-changes" style={{ marginBottom: 'var(--base, 20px)' }}>
          {pendingError ? (
            <Banner type="error">Не удалось загрузить список изменений: {pendingError}</Banner>
          ) : pending == null ? (
            <p style={{ color: 'var(--theme-elevation-400)', margin: 0 }}>Загрузка изменений…</p>
          ) : (
            <div>
              <p style={{ marginTop: 0 }}>
                <strong>{pending.count}</strong> {pluralizeChanges(pending.count)} ожидают
                публикации:
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {pending.pending.map((surface) => (
                  <li key={surface.surface} style={{ marginBottom: '0.5rem' }}>
                    <strong>{surface.surface}</strong>{' '}
                    <span style={{ color: 'var(--theme-elevation-400)' }}>({surface.type})</span>
                    <ul style={{ margin: '0.25rem 0', paddingLeft: '1.25rem' }}>
                      {surface.ids.map((id, i) => (
                        <li key={String(id)} data-testid="pending-item">
                          {surface.labels?.[i] ?? String(id)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 3 — the action button. Scope-correct and HIDDEN when there is nothing
          to do (in-sync, or already building): in those cases NOTHING is in the
          DOM, which the e2e asserts. Both visible variants POST /publish-site. */}
      {showActionButton && (
        <Button
          buttonStyle={showBatchPublish ? 'primary' : 'secondary'}
          onClick={() => void onPublish()}
          disabled={publishing}
          aria-label={
            showBatchPublish
              ? `Опубликовать ${pendingCount} ${pluralizeChanges(pendingCount)} на сайт`
              : 'Пересобрать сайт'
          }
        >
          {showBatchPublish
            ? `Опубликовать ${pendingCount} ${pluralizeChanges(pendingCount)} на сайт`
            : 'Пересобрать сайт'}
        </Button>
      )}

      {actionError && (
        <div style={{ marginTop: 'var(--base, 20px)' }}>
          <Banner type="error">{actionError}</Banner>
        </div>
      )}
    </div>
  )
}

export default PublishPanel
