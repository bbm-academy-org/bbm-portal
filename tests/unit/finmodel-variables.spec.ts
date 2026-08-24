import { describe, expect, it } from 'vitest'

import {
  MODEL_EXAMPLE_PATHS,
  SNAPSHOT_META,
  getVariables,
  isModelExample,
} from '@/lib/finmodel/variables'

/**
 * Снапшот SSOT-переменных (мастер — `ssot/finmodel.yaml` в bbm-kb, снимается
 * `pnpm ssot:pull`). Тесты держат инварианты структуры, а не значения: значения
 * модельные, их правит владелец в мастере, и прибивать их здесь гвоздями
 * значило бы завести вторую точку правды.
 *
 * Разделение уровней (спека §9 п.1): `policy` — универсальная политика BBM,
 * `projects.doctor_school` — предметные величины конкретного проекта.
 */
describe('finmodel: снапшот переменных', () => {
  it('policy: доли распределения складываются в семь и целые', () => {
    const shares = getVariables().policy.profit_shares
    expect(shares.investors + shares.author + shares.coauthors).toBe(7)
    for (const value of Object.values(shares)) expect(Number.isInteger(value)).toBe(true)
  })

  it('policy: сплит роялти складывается в общий процент', () => {
    const royalty = getVariables().policy.royalty_percent
    expect(royalty.mission_fund + royalty.bbm_holders).toBe(royalty.total)
  })

  it('уровень проекта отделён от политики: doctor_school несёт свои величины', () => {
    const variables = getVariables()
    expect(variables.policy).not.toHaveProperty('unit_price_rub')
    const project = variables.projects.doctor_school
    expect(project.unit_price_rub).toBeGreaterThan(0)
    for (const key of ['pul', 'bre', 'con'] as const) {
      expect(Number.isInteger(project.mining_weights[key])).toBe(true)
    }
  })

  it('снапшот назван своим источником — репо, ref, коммит и хэш байт мастера', () => {
    expect(SNAPSHOT_META.source_repo).toBe('bbm-academy-org/bbm-kb')
    expect(SNAPSHOT_META.ref).toBe('main')
    expect(SNAPSHOT_META.commit_sha).toMatch(/^[0-9a-f]{40}$/)
    expect(SNAPSHOT_META.source_sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('пометки model_example приходят из мастера, а не перечислены в этом репо', () => {
    // Список путей снимается из комментариев мастера (`pnpm ssot:pull`), тест
    // держит его контракт: каждый путь ведёт к существующему числу снапшота.
    expect(MODEL_EXAMPLE_PATHS.length).toBeGreaterThan(0)
    for (const path of MODEL_EXAMPLE_PATHS) {
      const value = path
        .split('.')
        .reduce<unknown>(
          (node, key) => (node as Record<string, unknown> | undefined)?.[key],
          getVariables(),
        )
      expect(typeof value).toBe('number')
      expect(isModelExample(path)).toBe(true)
    }
    expect(isModelExample('policy.profit_shares.investors')).toBe(false)
  })
})
