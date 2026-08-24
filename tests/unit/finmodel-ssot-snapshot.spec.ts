import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// .mjs-тулинг без типов: из скрипта берётся только чистая, не ходящая в сеть часть
import { findInvariantViolations } from '../../tools/ssot/pull-finmodel.mjs'

/**
 * Снапшот SSOT — граница между этим репо и мастером в bbm-kb. Тесты здесь про
 * механику границы, а не про арифметику модели (это `finmodel-formula.spec.ts`):
 * инварианты мастера, форма закоммиченного файла и то, что джоба свежести
 * действительно блокирующая.
 *
 * Сети тут нет: скрипт ходит в bbm-kb только при прямом запуске.
 */
const repoRoot = join(import.meta.dirname, '..', '..')

const validMaster = {
  policy: {
    profit_shares: { investors: 4, author: 2, coauthors: 1 },
    royalty_percent: { total: 5, mission_fund: 2, bbm_holders: 3 },
  },
  projects: { doctor_school: { mining_weights: { pul: 4, bre: 1, con: 2 } } },
}

describe('инварианты мастера ssot/finmodel.yaml', () => {
  it('валидный мастер нарушений не даёт', () => {
    expect(findInvariantViolations(validMaster)).toEqual([])
  })

  it('ловит сплит роялти, не сходящийся с общим процентом', () => {
    const broken = {
      ...validMaster,
      policy: {
        ...validMaster.policy,
        royalty_percent: { total: 5, mission_fund: 2, bbm_holders: 4 },
      },
    }
    expect(findInvariantViolations(broken)).toContain(
      'policy.royalty_percent: mission_fund + bbm_holders != total',
    )
  })

  it('ловит дробную долю распределения', () => {
    const broken = {
      ...validMaster,
      policy: {
        ...validMaster.policy,
        profit_shares: { investors: 4.5, author: 2, coauthors: 1 },
      },
    }
    expect(findInvariantViolations(broken)).toContain(
      'policy.profit_shares: доли обязаны быть целыми',
    )
  })

  it('пустой файл — нарушение, а не «нарушений нет»', () => {
    expect(findInvariantViolations({}).length).toBeGreaterThan(0)
  })
})

describe('закоммиченный снапшот', () => {
  it('лежит в форме, которую пишет скрипт: два пробела и перевод строки в конце', () => {
    const raw = readFileSync(join(repoRoot, 'src/lib/finmodel/snapshot/finmodel.json'), 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(JSON.stringify(JSON.parse(raw), null, 2) + '\n').toBe(raw)
  })

  it('сам проходит инварианты мастера', () => {
    const data = JSON.parse(
      readFileSync(join(repoRoot, 'src/lib/finmodel/snapshot/finmodel.json'), 'utf8'),
    )
    expect(findInvariantViolations(data)).toEqual([])
  })

  it('meta.json назван источником, а не переписан руками', () => {
    const meta = JSON.parse(
      readFileSync(join(repoRoot, 'src/lib/finmodel/snapshot/meta.json'), 'utf8'),
    )
    expect(meta.source_repo).toBe('bbm-academy-org/bbm-kb')
    expect(meta.source_path).toBe('ssot/finmodel.yaml')
  })
})

describe('проводка ssot:check', () => {
  it('скрипты ssot:pull и ssot:check объявлены и зовут один файл', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts['ssot:pull']).toBe('node tools/ssot/pull-finmodel.mjs')
    expect(pkg.scripts['ssot:check']).toBe('node tools/ssot/pull-finmodel.mjs --check')
  })

  it('джоба ssot-freshness блокирующая: без continue-on-error и в needs у ci', () => {
    const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
    const job = ci.slice(ci.indexOf('\n  ssot-freshness:'), ci.indexOf('\n  ci:'))
    expect(job).toContain('pnpm ssot:check')
    expect(job).toContain('KB_READ_TOKEN')
    expect(job).not.toContain('continue-on-error')
    expect(ci).toMatch(/needs: \[[^\]]*ssot-freshness[^\]]*\]/)
  })

  it('без доступа к мастеру падает с внятной подсказкой, а не стеком Node', () => {
    // Токены гасятся явно: у разработчика они в окружении есть, и без этого
    // тест проверял бы разную ветку подсказки на разных машинах.
    const { GH_TOKEN: _gh, KB_READ_TOKEN: _kb, ...cleanEnv } = process.env
    let stderr = ''
    try {
      execFileSync(process.execPath, ['tools/ssot/pull-finmodel.mjs', '--check'], {
        cwd: repoRoot,
        encoding: 'utf8',
        // stderr читается из ошибки, а не пересылается наружу: иначе подсказка
        // ложилась бы в вывод зелёного прогона и выглядела как настоящий сбой.
        stdio: ['ignore', 'pipe', 'pipe'],
        // Пустая PATH: `gh` не найдётся — ровно тот же класс отказа, что и
        // отсутствующий секрет в CI.
        env: { ...cleanEnv, PATH: '' },
      })
      throw new Error('ожидался ненулевой выход')
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr ?? '')
    }
    expect(stderr).toContain('KB_READ_TOKEN')
    expect(stderr).not.toContain('at Object.')
  })
})
