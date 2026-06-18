'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Banner, Button } from '@payloadcms/ui'

/**
 * #17 — admin "Publish to site" panel.
 *
 * Registered via `admin.components.beforeDashboard` in payload.config.ts, so it
 * renders at the top of the Payload admin dashboard (admin-only by virtue of the
 * panel's auth). It is an internal tool: it uses Payload's own UI primitives
 * (`Button`, `Banner`) and admin CSS variables, NOT a separate brand aesthetic.
 *
 * Flow (from the issue):
 *  1. On mount fetch `GET /api/pending-changes` and render a confirmation list of
 *     the documents that have pending drafts (transparency / multi-editor
 *     safety). Nothing pending → "nothing to publish" + disabled button.
 *  2. "Publish to site" → `POST /api/publish-site`; on success start polling
 *     `GET /api/site-build-status`.
 *  3. Status panel: "Building…" for queued/in_progress; "Published (<time>)" for
 *     completed + success; "Failed → log link" (→ html_url) for completed +
 *     failure. All-null "no run yet" renders as idle.
 *  4. Button disabled while a build is running; re-enabled (and pending list
 *     refreshed) when the run reaches a terminal `completed` state.
 *  5. Poll every 4s and STOP once `completed` (no infinite polling); timers are
 *     cleaned up on unmount.
 *  6. All requests use `credentials: 'include'` so the admin session cookie is
 *     sent (the endpoints are admin-gated).
 */

const POLL_INTERVAL_MS = 4000

// How many CONSECUTIVE poll failures we tolerate before giving up. A single
// transient blip (network, a brief 502 from the GitHub site-build-status proxy)
// must NOT permanently wedge the panel on "Building…", so we keep polling across
// errors and only stop after this many in a row — at which point we clear the
// optimistic running state so the button re-enables for a manual retry.
const MAX_CONSECUTIVE_POLL_ERRORS = 3

type PendingSurface = {
  surface: string
  type: 'collection' | 'global'
  ids: Array<number | string>
  labels?: string[]
}
type PendingChanges = { pending: PendingSurface[]; count: number }

type BuildStatus = {
  status: string | null
  conclusion: string | null
  html_url: string | null
  startedAt: string | null
}

const isRunning = (s: BuildStatus | null): boolean =>
  s != null && (s.status === 'queued' || s.status === 'in_progress')

const isTerminal = (s: BuildStatus | null): boolean => s != null && s.status === 'completed'

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

const formatTime = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString()
}

export const PublishPanel: React.FC = () => {
  const [pending, setPending] = useState<PendingChanges | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [build, setBuild] = useState<BuildStatus | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Held timer + a mounted flag so polling stops on unmount (no setState after
  // unmount, no infinite poll). A ref avoids re-creating the poll loop on render.
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  // Count of CONSECUTIVE poll failures; reset to 0 on any successful poll. Drives
  // the H1 self-heal: tolerate transient errors, give up (re-enable) only after a
  // sustained run of them.
  const pollErrorsRef = useRef(0)

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
  // `setTimeout` re-fire can reference the latest function without `pollStatus`
  // referring to itself before declaration (the recursion is via `pollRef`'s
  // sibling `pollFnRef`, set in an effect below). When the run is terminal we
  // stop polling and refresh the pending list (now empty for what just shipped).
  const pollFnRef = useRef<() => void>(() => {})

  const pollStatus = useCallback(async () => {
    try {
      const status = await fetchJSON<BuildStatus>('/api/site-build-status')
      if (!mountedRef.current) return
      // A good read clears any prior transient error and resets the failure run.
      pollErrorsRef.current = 0
      setActionError(null)
      setBuild(status)
      if (isTerminal(status)) {
        clearPoll()
        void loadPending()
        return
      }
    } catch (err) {
      if (!mountedRef.current) return
      // H1: a transient poll failure must NEVER permanently wedge the panel on
      // "Building…". So we do NOT stop on the first error — we surface a
      // non-blocking notice and KEEP polling so the running build's status can
      // resume on its own. Only after MAX_CONSECUTIVE_POLL_ERRORS failures in a
      // row do we give up: stop polling AND clear the optimistic running state
      // (`setBuild(null)`) so the button RE-ENABLES for a manual retry, with the
      // error still visible. The invariant: a failed fetch always ends either
      // (a) still polling a genuinely running build, or (b) button re-enabled —
      // never a permanently disabled "Building…".
      pollErrorsRef.current += 1
      if (pollErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
        setActionError(
          `Could not read the build status after ${MAX_CONSECUTIVE_POLL_ERRORS} attempts ` +
            `(${(err as Error).message}). Stopped polling — re-check the run, then publish again if needed.`,
        )
        clearPoll()
        setBuild(null) // drop optimistic "running" → button re-enables for retry
        return
      }
      // Transient: keep the running state, surface a soft notice, reschedule.
      setActionError(`Status check failed, retrying… (${(err as Error).message})`)
      pollRef.current = setTimeout(() => pollFnRef.current(), POLL_INTERVAL_MS)
      return
    }
    // Still running (or no-run-yet that we are watching after a publish) — poll on.
    if (mountedRef.current) {
      pollRef.current = setTimeout(() => pollFnRef.current(), POLL_INTERVAL_MS)
    }
  }, [clearPoll, loadPending])

  // Keep the ref pointed at the latest `pollStatus` so scheduled re-fires (and
  // the timeout closure above) always invoke the current implementation.
  useEffect(() => {
    pollFnRef.current = () => void pollStatus()
  }, [pollStatus])

  // On mount: load the confirm-list AND read the current build status once, so a
  // build already running when the dashboard opens is reflected (and polled).
  // All state updates here happen asynchronously (after `await`), so they are not
  // synchronous-in-effect renders — the bootstrap is kicked off, not awaited.
  const bootstrap = useCallback(async () => {
    await loadPending()
    try {
      const status = await fetchJSON<BuildStatus>('/api/site-build-status')
      if (!mountedRef.current) return
      setBuild(status)
      if (isRunning(status)) {
        pollRef.current = setTimeout(() => void pollStatus(), POLL_INTERVAL_MS)
      }
    } catch {
      /* a status read failure on mount is non-fatal: the panel still works */
    }
  }, [loadPending, pollStatus])

  useEffect(() => {
    mountedRef.current = true
    // `bootstrap` only ever calls setState AFTER an `await` (async network I/O),
    // so it never triggers a synchronous cascading render — it is a fire-and-
    // forget data load, the intended use of an effect. The compiler rule cannot
    // see through the async boundary, hence the precise, justified disable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void bootstrap()
    return () => {
      mountedRef.current = false
      clearPoll()
    }
  }, [bootstrap, clearPoll])

  const onPublish = useCallback(async () => {
    setActionError(null)
    setPublishing(true)
    try {
      await fetchJSON('/api/publish-site', { method: 'POST' })
      // Optimistically reflect "Building…" until the first status poll lands.
      if (mountedRef.current) {
        setBuild({ status: 'queued', conclusion: null, html_url: null, startedAt: null })
      }
      clearPoll()
      pollErrorsRef.current = 0 // fresh publish → fresh retry budget
      void pollStatus()
    } catch (err) {
      if (mountedRef.current) setActionError((err as Error).message)
    } finally {
      if (mountedRef.current) setPublishing(false)
    }
  }, [clearPoll, pollStatus])

  const running = isRunning(build) || publishing
  const hasPending = (pending?.count ?? 0) > 0
  const buttonDisabled = running || !hasPending

  // A single token naming the visible build-status branch (the status panel is a
  // wrapper carrying `data-status`; <Banner> can't, so the wrapper owns it). Used
  // by the e2e to assert each visible state deterministically.
  const statusKey: 'idle' | 'building' | 'published' | 'failed' =
    build == null || (build.status == null && build.conclusion == null)
      ? 'idle'
      : isRunning(build)
        ? 'building'
        : build.status === 'completed' && build.conclusion === 'success'
          ? 'published'
          : build.status === 'completed'
            ? 'failed'
            : 'idle'

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
      <h2 style={{ marginTop: 0 }}>Publish to site</h2>

      {/* 1 — confirmation list of pending changes */}
      <section data-testid="pending-changes" style={{ marginBottom: 'var(--base, 20px)' }}>
        {pendingError ? (
          <Banner type="error">Could not load pending changes: {pendingError}</Banner>
        ) : pending == null ? (
          <p style={{ color: 'var(--theme-elevation-400)' }}>Checking for pending changes…</p>
        ) : !hasPending ? (
          <div data-testid="nothing-to-publish">
            <Banner type="default">
              Nothing to publish — the site is up to date with the CMS.
            </Banner>
          </div>
        ) : (
          <div>
            <p style={{ marginTop: 0 }}>
              <strong>{pending.count}</strong>{' '}
              {pending.count === 1 ? 'change' : 'changes'} pending across the build surfaces:
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

      {/* 2 — the publish action (disabled while a build runs or nothing pending) */}
      <Button
        buttonStyle="primary"
        onClick={() => void onPublish()}
        disabled={buttonDisabled}
        aria-label="Publish to site"
      >
        {running ? 'Building…' : 'Publish to site'}
      </Button>

      {actionError && (
        <div style={{ marginTop: 'var(--base, 20px)' }}>
          <Banner type="error">{actionError}</Banner>
        </div>
      )}

      {/* 3 — live status panel. `data-status` lives on the wrapping <section>
          (Payload's <Banner> does not forward data-* attributes), and only one
          branch renders at a time, so the wrapper's status is unambiguous. */}
      <section
        data-testid="build-status"
        data-status={statusKey}
        style={{ marginTop: 'var(--base, 20px)' }}
      >
        {build == null || (build.status == null && build.conclusion == null) ? (
          <p style={{ color: 'var(--theme-elevation-400)', margin: 0 }}>
            No site build has run yet.
          </p>
        ) : isRunning(build) ? (
          <Banner type="info">
            Building… {build.html_url ? <a href={build.html_url}>view run</a> : null}
          </Banner>
        ) : build.status === 'completed' && build.conclusion === 'success' ? (
          <Banner type="success">
            Published{build.startedAt ? ` (${formatTime(build.startedAt)})` : ''}.
          </Banner>
        ) : build.status === 'completed' ? (
          <Banner type="error">
            Build failed{build.conclusion ? ` (${build.conclusion})` : ''}.{' '}
            {build.html_url ? (
              <a href={build.html_url} target="_blank" rel="noreferrer">
                View log
              </a>
            ) : null}
          </Banner>
        ) : (
          <p style={{ color: 'var(--theme-elevation-400)', margin: 0 }}>
            No site build has run yet.
          </p>
        )}
      </section>
    </div>
  )
}

export default PublishPanel
