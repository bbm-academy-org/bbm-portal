import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// .mjs-тулинг без типов: из скрипта берётся только чистая, не ходящая в сеть часть
import {
  buildSnapshot,
  extractModelExampleMarkers,
  findInvariantViolations,
  hasDrift,
  metaNeedsWrite,
  parseCommitProbe,
  rulesPassportDrift,
  sourceSha256,
} from '../../tools/ssot/pull-finmodel.mjs'

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
    reserve_percent: 15,
    emission_price_rub: 1000,
    examples: { team_monthly_rate_rub: 200000, team_hours_norm: 160 },
  },
  projects: {
    doctor_school: { unit_price_rub: 2000000, mining_weights: { pul: 4, bre: 1, con: 2 } },
  },
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

  it('выпавший лист мастера ловится на снятии, а не прочерком на странице', () => {
    const { emission_price_rub: _dropped, ...policy } = validMaster.policy
    expect(findInvariantViolations({ ...validMaster, policy })).toContain(
      'policy.emission_price_rub: ожидалось число, получено undefined',
    )
  })

  it('переименованный лист — тоже нарушение, а не молчаливая потеря значения', () => {
    const renamed = {
      ...validMaster,
      projects: {
        doctor_school: {
          ...validMaster.projects.doctor_school,
          mining_weights: { pull: 4, bre: 1, con: 2 },
        },
      },
    }
    expect(findInvariantViolations(renamed)).toContain(
      'projects.doctor_school.mining_weights.pul: ожидалось число, получено undefined',
    )
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

/**
 * Маркеры `model_example` живут в мастере ТОЛЬКО как YAML-комментарии, а
 * `parse()` комментарии выбрасывает. Пока они не снимаются вместе со
 * значениями, «пометка» пересказывается руками в типах — второй источник
 * правды ровно там, где этот модуль вводит SSOT-контракт.
 */
describe('пометки model_example снимаются из мастера', () => {
  const master = [
    '# Схема:',
    '#   reserve_percent: <число>   # model_example; в шапке это не значение',
    'policy:',
    '  profit_shares:',
    '    investors: 4',
    '  reserve_percent: 15          # model_example',
    '  emission_price_rub: 1000     # model_example (пример звонка 06.08)',
    '  examples:',
    '    team_monthly_rate_rub: 200000   # model_example',
    '    team_hours_norm: 160',
    'projects:',
    '  doctor_school:',
    '    unit_price_rub: 2000000    # model_example (резолюция №1)',
    '    mining_weights:            # предложение BBM 4:1:2',
    '      pul: 4',
    '',
  ].join('\n')

  it('путь маркера собирается по вложенности, комментарий-шапка не считается значением', () => {
    expect(extractModelExampleMarkers(master)).toEqual([
      'policy.reserve_percent',
      'policy.emission_price_rub',
      'policy.examples.team_monthly_rate_rub',
      'projects.doctor_school.unit_price_rub',
    ])
  })

  it('снапшот несёт список маркеров рядом со значениями', () => {
    const data = JSON.parse(
      readFileSync(join(repoRoot, 'src/lib/finmodel/snapshot/finmodel.json'), 'utf8'),
    )
    expect(data.model_example).toEqual([
      'policy.reserve_percent',
      'policy.emission_price_rub',
      'policy.examples.team_monthly_rate_rub',
      'projects.doctor_school.unit_price_rub',
    ])
  })

  it('снятие маркера в мастере — дрейф снапшота, а не молчаливая правка', () => {
    const without = master.replace(
      '  reserve_percent: 15          # model_example',
      '  reserve_percent: 15',
    )
    expect(extractModelExampleMarkers(without)).not.toContain('policy.reserve_percent')
    expect(buildSnapshot(without)).not.toEqual(buildSnapshot(master))
  })
})

/**
 * Дырка свежести: `--check` сравнивал РАЗОБРАННЫЕ значения, поэтому правка
 * одних комментариев мастера (пометка, подпись Эдуарда под весами майнинга)
 * давала нулевой дрейф и зелёную джобу.
 */
describe('свежесть считается по сырым байтам мастера', () => {
  const yamlA = 'policy:\n  reserve_percent: 15   # model_example\n'
  const yamlB = 'policy:\n  reserve_percent: 15   # model_example (подтверждено 2026-08-24)\n'

  it('правка одного комментария меняет хэш источника', () => {
    expect(sourceSha256(yamlA)).not.toBe(sourceSha256(yamlB))
  })

  it('дрейф ловится даже когда сериализованный снапшот совпал байт в байт', () => {
    const snapshotRaw = JSON.stringify(buildSnapshot(yamlA), null, 2) + '\n'
    const meta = { source_sha256: sourceSha256(yamlA) }
    expect(hasDrift(snapshotRaw, meta, yamlA)).toBe(false)
    expect(hasDrift(snapshotRaw, meta, yamlB)).toBe(true)
  })

  it('в закоммиченном meta.json хэш источника записан', () => {
    const meta = JSON.parse(
      readFileSync(join(repoRoot, 'src/lib/finmodel/snapshot/meta.json'), 'utf8'),
    )
    expect(meta.source_sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('meta.json переписывается только когда в паспорте что-то изменилось', () => {
  const core = {
    source_repo: 'bbm-academy-org/bbm-kb',
    ref: 'main',
    source_path: 'ssot/finmodel.yaml',
    commit_sha: 'f1d15e1367ca726668a25dc23893bfd0a945ce04',
    source_sha256: 'a'.repeat(64),
  }

  it('другой pulled_at сам по себе не повод переписывать файл', () => {
    expect(metaNeedsWrite({ ...core, pulled_at: '2020-01-01T00:00:00.000Z' }, core)).toBe(false)
  })

  it('новый коммит мастера — повод', () => {
    expect(
      metaNeedsWrite(
        { ...core, pulled_at: '2020-01-01T00:00:00.000Z' },
        { ...core, commit_sha: 'b'.repeat(40) },
      ),
    ).toBe(true)
  })
})

/**
 * Паспорт документа (#193, ревью PR #325 п.5 и п.7).
 *
 * Свежесть документа считалась по байтам и их хэшу — а поля паспорта
 * (`commit_sha`, `commit_date`, `source_path`) не перепроверялись вообще.
 * Переименование файла в мастере или любая смена его последнего коммита при
 * тех же байтах оставляли `ssot:check` зелёным, пока строка «версия …» под
 * документом показывала не то. Второй сюжет тот же по классу: пустой ответ
 * `commits?path=` клал в паспорт пустую строку вместо того, чтобы уронить
 * снятие.
 */
describe('паспорт нормативного документа', () => {
  const passport = {
    source_path: 'content/finmodel/index.mdx',
    commit_sha: 'f'.repeat(40),
    commit_date: '2026-08-11T12:12:53Z',
  }

  it('совпадающий паспорт дрейфа не даёт', () => {
    expect(rulesPassportDrift({ rules: { ...passport } }, passport)).toEqual([])
  })

  it('переименование файла в мастере — дрейф, хотя байты те же', () => {
    const stale = { rules: { ...passport, source_path: 'content/finmodel/rules.mdx' } }
    expect(rulesPassportDrift(stale, passport)).toContain('source_path')
  })

  it('новый коммит документа — дрейф, даже если текст не менялся', () => {
    const stale = { rules: { ...passport, commit_sha: 'a'.repeat(40) } }
    expect(rulesPassportDrift(stale, passport)).toContain('commit_sha')
  })

  it('отсутствующий блок паспорта — дрейф целиком, а не «нарушений нет»', () => {
    expect(rulesPassportDrift(null, passport).length).toBeGreaterThan(0)
    expect(rulesPassportDrift({}, passport).length).toBeGreaterThan(0)
  })

  it('ответ gh разбирается в sha и дату', () => {
    expect(
      parseCommitProbe('f1d15e1367ca726668a25dc23893bfd0a945ce04 2026-08-11T12:12:53Z'),
    ).toEqual({
      sha: 'f1d15e1367ca726668a25dc23893bfd0a945ce04',
      date: '2026-08-11T12:12:53Z',
    })
  })

  it('пустой ответ — ошибка, а не пустой sha в паспорте', () => {
    // `.[0]` по пустому массиву даёт «null null»; молча записанный, он стал бы
    // подписью «версия ...» под нормативным документом.
    expect(() => parseCommitProbe('')).toThrow(/commits/)
    expect(() => parseCommitProbe('null null')).toThrow(/commits/)
  })
})
