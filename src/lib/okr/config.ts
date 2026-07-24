import type { Mission } from './types'

/**
 * OKR module configuration (PRD FR-1): the project_id → {mission, order}
 * mapping is config, not derivable from Plane (mission lanes and O1–O5 order
 * live on the team board). Everything else is read live from Plane.
 */

export interface OkrProjectConfig {
  projectId: string
  /** Plane project identifier — doubles as the stable objective key. */
  ident: string
  mission: Mission
  order: number
}

/** Workspace `doctor-school`, projects DSG1–DSG5 (plane-cut-spec.md). */
export const OKR_WORKSPACE = 'doctor-school'

export const OKR_PROJECTS: OkrProjectConfig[] = [
  { projectId: '88af28c0-e5da-4641-bb35-41945ff60a79', ident: 'DSG1', mission: 'social', order: 1 },
  { projectId: 'da33f873-9f33-4377-98ee-aa05eb44a725', ident: 'DSG2', mission: 'social', order: 2 },
  { projectId: '2c7cd250-36fb-4a41-8159-d91462514496', ident: 'DSG3', mission: 'both', order: 3 },
  { projectId: 'adff4ed3-7ad8-4dd7-9076-0f75589ff472', ident: 'DSG4', mission: 'business', order: 4 },
  { projectId: 'b5ced082-04d6-4a73-941a-348c939aa484', ident: 'DSG5', mission: 'business', order: 5 },
]

export const GOAL_TITLE = 'Цель «Academy Doctor.School»'

/** Board horizon «OKR 01/09/26» (§2.1 p.5). */
export const OKR_PERIOD = { start: '2026-07-01', end: '2026-09-01' }

/**
 * OQ-6 (grace period of the health formula) — proposed rule: during the first
 * GRACE_DAYS of the period the traffic light does not judge (nodes with data
 * show on-track), because the linear expectation near t0 paints every fresh
 * period red. TODO(Антон): подтвердить правило и длительность.
 */
export const GRACE_DAYS = 14

/**
 * Точечный override q4-статуса (FR-2): q4 выводится из Plane target_date;
 * this map only overrides misdated nodes. Key: krId or objective ident.
 */
export const Q4_OVERRIDE: Record<string, boolean> = {}

/**
 * Static block (FR-5): fields not derivable from Plane. Team roles per
 * plane-cut-spec.md; keyed by Plane member UUID (workspace doctor-school).
 */
export interface TeamMember {
  name: string
  initials: string
  role: string
}

export const TEAM: Record<string, TeamMember> = {
  '6cd7f33c-fb90-4f46-b668-bf385804ac7f': { name: 'Антон', initials: 'АС', role: 'Tech Lead' },
  '7c8b6b4d-d2bb-439d-99b4-7129b7b845a7': { name: 'Эдуард', initials: 'ЭД', role: 'Product Lead' },
  '1b9aa5a7-5d9e-4495-8ed8-e74ad135f799': { name: 'Всеволод', initials: 'ВС', role: 'Студия · подкасты' },
  'f0b3f946-5d7a-4bc2-ac95-b231e205dc46': { name: 'Женя', initials: 'ЕГ', role: 'Сценарии · текст' },
  '12a0569a-d08b-4d26-acb2-a3ea58329650': { name: 'Катя', initials: 'ЕП', role: 'AI-продакшн' },
  '2d6730f7-bd1b-4c0d-acae-c8f5b0b0dd76': { name: 'Алиса', initials: 'АИ', role: 'Соцсети · трафик' },
  '80a414e7-3335-4b77-999e-053b764c3ff2': { name: 'Пётр', initials: 'ПГ', role: 'Методология OKR' },
}

/** Board notes that live outside the OKR tree (org-level, project DSO). */
export const OFF_TREE_NOTES: string[] = [
  'Понятийный аппарат (инвестор / рекламодатель / спонсор) и правила команды — модуль «KM & Base» проекта DSO, вне дерева OKR.',
]

const DEFAULT_BASE_URL = 'https://plane.bbm.academy/api/v1'

export function planeApiBaseUrl(): string {
  return (process.env.PLANE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
}

/** Web origin for clickable node links — the API base without the /api/v1 suffix. */
export function planeWebBaseUrl(): string {
  return planeApiBaseUrl().replace(/\/api\/v1$/, '')
}

export function planeApiToken(): string | undefined {
  return process.env.PLANE_API_TOKEN || undefined
}

/** Snapshot TTL (FR-6): 5–15 min make sense; default 10, clamped to that range. */
export function cacheTtlMs(): number {
  const raw = Number(process.env.OKR_CACHE_TTL_SECONDS)
  const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(raw, 300), 900) : 600
  return seconds * 1000
}
