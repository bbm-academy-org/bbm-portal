import { GRACE_DAYS } from './config'
import type { Health, KrMetric, OkrPeriod } from './types'

/**
 * Progress model per okr-structure.md §3 — implemented server-side in one
 * place (FR-6), no weights, no hardcoded percentages.
 */

/** Unweighted mean over defined values; null when nothing is defined (§3 p.3–4). */
export function avg(values: Array<number | null>): number | null {
  const defined = values.filter((v): v is number => v != null)
  if (defined.length === 0) return null
  return defined.reduce((s, v) => s + v, 0) / defined.length
}

/** Execution-KR% — closed / all module tasks, flat (§3 p.1). Empty module → null, not 0 (FR-4). */
export function executionPct(counts: { done: number; total: number } | null): number | null {
  if (!counts || counts.total === 0) return null
  return (counts.done / counts.total) * 100
}

/** Metric-KR% = min(current/target, 1) — only when the metric is live (§3 p.2). */
export function metricPct(metric: KrMetric | null): number | null {
  if (!metric || metric.current == null || metric.target == null || metric.target <= 0) return null
  return Math.min(metric.current / metric.target, 1) * 100
}

/** Linear share of the elapsed period, 0..1 (§3 p.5). */
export function expectedShare(period: OkrPeriod, now: Date): number {
  const start = Date.parse(period.start)
  const end = Date.parse(period.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)))
}

/** True during the first GRACE_DAYS of the period — the traffic light does not judge (OQ-6 proposal). */
export function inGracePeriod(period: OkrPeriod, now: Date): boolean {
  const start = Date.parse(period.start)
  if (!Number.isFinite(start)) return false
  return now.getTime() < start + GRACE_DAYS * 24 * 60 * 60 * 1000
}

/**
 * The 70% rule (§3 p.5): fact vs linear expectation. q4 nodes get their badge
 * elsewhere; pct == null is always «не определено».
 */
export function health(pct: number | null, period: OkrPeriod, now: Date): Health {
  if (pct == null) return 'undef'
  if (inGracePeriod(period, now)) return 'on'
  const expected = expectedShare(period, now) * 100
  if (expected <= 0) return 'on'
  const ratio = pct / expected
  if (ratio >= 0.7) return 'on'
  if (ratio >= 0.4) return 'risk'
  return 'behind'
}
