import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import type { KrMetric } from './types'

/**
 * Manual metric values (FR-3): Plane holds no business metrics (MAU, баллы
 * НМО, ₽), so their single home is metrics.yaml in this repo, keyed by the
 * stable kr_id (see deriveKrId). No entry → the KR runs in execution mode.
 */

const METRICS_FILE = 'metrics.yaml'

export async function loadMetrics(rootDir = process.cwd()): Promise<Record<string, KrMetric>> {
  let raw: string
  try {
    raw = await readFile(path.join(rootDir, METRICS_FILE), 'utf8')
  } catch {
    // Missing file is a valid state: every metric-KR simply runs in execution mode.
    return {}
  }
  return parseMetrics(raw)
}

export function parseMetrics(raw: string): Record<string, KrMetric> {
  const doc: unknown = parse(raw)
  if (doc == null) return {}
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('metrics.yaml: expected a mapping kr_id → {current, target, unit, as_of}')
  }
  const out: Record<string, KrMetric> = {}
  for (const [krId, value] of Object.entries(doc as Record<string, unknown>)) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`metrics.yaml: entry «${krId}» must be a mapping {current, target, unit, as_of}`)
    }
    const v = value as Record<string, unknown>
    out[krId] = {
      current: numberOrNull(v.current, krId, 'current'),
      target: numberOrNull(v.target, krId, 'target'),
      unit: v.unit == null ? undefined : String(v.unit),
      asOf: v.as_of == null ? undefined : String(v.as_of),
    }
  }
  return out
}

function numberOrNull(value: unknown, krId: string, field: string): number | null {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`metrics.yaml: «${krId}.${field}» must be a number or null`)
  }
  return value
}
