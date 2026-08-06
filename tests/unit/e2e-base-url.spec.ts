import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_E2E_PORT,
  E2eTargetError,
  needsPortPreflight,
  portConflictMessage,
  resolveE2eTarget,
  usesLocalWebServer,
} from '../helpers/base-url'

/**
 * Резолв базового URL e2e-сюиты (#169).
 *
 * Захардкоженный дефолтный localhost-origin в спеках и в playwright.config.ts
 * делал сюиту незапускаемой рядом с чужим стендом, а `reuseExistingServer: true` —
 * ОПАСНОЙ: сюита молча цеплялась к чужому listener'у на дефолтном порту и
 * сеяла/удаляла пользователей в общей dev-БД под чужой приёмкой. Отсюда четыре
 * инварианта, которые проверяются ниже:
 *   1) базовый URL резолвится ровно один раз, из E2E_BASE_URL / E2E_PORT;
 *   2) reuseExistingServer включается ТОЛЬКО когда цель названа явно;
 *   3) ни одна спека/хелпер e2e-контура не называет origin сама;
 *   4) проба порта выполняется только в главном процессе — worker перечитывает
 *      конфиг, когда порт уже занят НАШИМ ЖЕ сервером (ревью PR #172).
 */

describe('resolveE2eTarget — дефолт', () => {
  it('без переменных даёт localhost:3000, но НЕ считает цель явной', () => {
    const target = resolveE2eTarget({})
    expect(target.baseURL).toBe(`http://localhost:${DEFAULT_E2E_PORT}`)
    expect(target.port).toBe(3000)
    expect(target.explicit).toBe(false)
    expect(target.local).toBe(true)
    // Ключевой инвариант задачи: без явно названного порта переиспользование
    // чужого стенда запрещено.
    expect(target.reuseExistingServer).toBe(false)
  })

  it('пустые/пробельные значения считаются незаданными', () => {
    const target = resolveE2eTarget({ E2E_BASE_URL: '   ', E2E_PORT: '' })
    expect(target.baseURL).toBe(`http://localhost:${DEFAULT_E2E_PORT}`)
    expect(target.explicit).toBe(false)
  })
})

describe('resolveE2eTarget — E2E_PORT', () => {
  it('строит localhost-URL на названном порту и разрешает reuse', () => {
    const target = resolveE2eTarget({ E2E_PORT: '3005' })
    expect(target.baseURL).toBe('http://localhost:3005')
    expect(target.port).toBe(3005)
    expect(target.explicit).toBe(true)
    expect(target.local).toBe(true)
    expect(target.reuseExistingServer).toBe(true)
  })

  it.each(['abc', '0', '70000', '3005.5', '-1'])('падает на негодном порту %s', (value) => {
    expect(() => resolveE2eTarget({ E2E_PORT: value })).toThrow(E2eTargetError)
    expect(() => resolveE2eTarget({ E2E_PORT: value })).toThrow(/E2E_PORT/)
  })
})

describe('resolveE2eTarget — E2E_BASE_URL', () => {
  it('берёт URL как есть и снимает хвостовые слэши', () => {
    const target = resolveE2eTarget({ E2E_BASE_URL: 'http://localhost:3007//' })
    expect(target.baseURL).toBe('http://localhost:3007')
    expect(target.port).toBe(3007)
    expect(target.explicit).toBe(true)
    expect(target.reuseExistingServer).toBe(true)
  })

  it('выводит порт из схемы, когда он не указан', () => {
    expect(resolveE2eTarget({ E2E_BASE_URL: 'https://stand.example' }).port).toBe(443)
    expect(resolveE2eTarget({ E2E_BASE_URL: 'http://stand.example' }).port).toBe(80)
  })

  it('падает на неразбираемом URL', () => {
    expect(() => resolveE2eTarget({ E2E_BASE_URL: 'not a url' })).toThrow(/E2E_BASE_URL/)
  })

  // Ревью PR #172: `new URL('localhost:3005')` разбирается — как протокол
  // `localhost:` — и раньше уезжал дальше с портом 0, вопреки докблоку резолвера.
  it.each(['localhost:3005', 'ws://localhost:3005', 'file:///tmp/stand'])(
    'падает на не-http(s) значении %s',
    (value) => {
      expect(() => resolveE2eTarget({ E2E_BASE_URL: value })).toThrow(E2eTargetError)
      expect(() => resolveE2eTarget({ E2E_BASE_URL: value })).toThrow(/http:\/\/ or https:\/\//)
    },
  )

  it.each(['http://localhost:3005', 'http://127.0.0.1:3005', 'http://[::1]:3005'])(
    'считает %s локальной целью',
    (value) => {
      expect(resolveE2eTarget({ E2E_BASE_URL: value }).local).toBe(true)
    },
  )

  it('считает внешний origin нелокальной целью', () => {
    expect(resolveE2eTarget({ E2E_BASE_URL: 'https://portal.bbm.academy' }).local).toBe(false)
  })
})

describe('resolveE2eTarget — обе переменные', () => {
  it('пропускает согласованную пару', () => {
    const target = resolveE2eTarget({ E2E_BASE_URL: 'http://localhost:3005', E2E_PORT: '3005' })
    expect(target.baseURL).toBe('http://localhost:3005')
    expect(target.port).toBe(3005)
  })

  it('падает, когда порт в URL и E2E_PORT расходятся — молча выбирать нельзя', () => {
    expect(() =>
      resolveE2eTarget({ E2E_BASE_URL: 'http://localhost:3005', E2E_PORT: '3006' }),
    ).toThrow(E2eTargetError)
    expect(() =>
      resolveE2eTarget({ E2E_BASE_URL: 'http://localhost:3005', E2E_PORT: '3006' }),
    ).toThrow(/E2E_BASE_URL[\s\S]*E2E_PORT|E2E_PORT[\s\S]*E2E_BASE_URL/)
  })
})

describe('usesLocalWebServer', () => {
  it('дефолтный запуск — локальный сервер поднимаем мы', () => {
    expect(usesLocalWebServer({}, resolveE2eTarget({}))).toBe(true)
  })

  it('PORTAL_E2E_BASE_URL — режим задеплоенного стенда, локального сервера нет', () => {
    const env = { PORTAL_E2E_BASE_URL: 'https://portal.bbm.academy' }
    expect(usesLocalWebServer(env, resolveE2eTarget(env))).toBe(false)
  })

  it('нелокальный E2E_BASE_URL — тоже нет: иначе webServer унёс бы PORT=443', () => {
    const env = { E2E_BASE_URL: 'https://stand.example' }
    expect(usesLocalWebServer(env, resolveE2eTarget(env))).toBe(false)
  })
})

describe('needsPortPreflight — регрессия из ревью PR #172', () => {
  it('в главном процессе дефолтного запуска проба нужна', () => {
    expect(needsPortPreflight({}, resolveE2eTarget({}))).toBe(true)
  })

  it('в worker-процессе пробы НЕТ — порт там занят нашим же webServer', () => {
    // Playwright перечитывает playwright.config.ts в каждом worker'е уже ПОСЛЕ
    // старта своего webServer. Проба на верхнем уровне видела бы занятый порт и
    // роняла бы всю сюиту сообщением про чужой стенд — при свободном 3000.
    // TEST_WORKER_INDEX выставлен только в worker'е, это и есть шов.
    const env = { TEST_WORKER_INDEX: '0' }
    expect(needsPortPreflight(env, resolveE2eTarget(env))).toBe(false)
  })

  it('при явно названной цели пробы нет — оператор отвечает за свой порт', () => {
    const env = { E2E_PORT: '3005' }
    expect(needsPortPreflight(env, resolveE2eTarget(env))).toBe(false)
  })

  it('в режиме задеплоенного стенда пробы нет', () => {
    const env = { PORTAL_E2E_BASE_URL: 'https://portal.bbm.academy' }
    expect(needsPortPreflight(env, resolveE2eTarget(env))).toBe(false)
  })
})

describe('e2e-контур не содержит захардкоженных origin (критерий приёмки #169)', () => {
  // Тот же смысл, что `grep -rn "localhost:3000" tests/ playwright.config.ts`,
  // только шире (любой порт/любой хост) и навсегда: критерий приёмки, который
  // умеет падать сам, а не живёт в теле issue. tests/unit сюда не входит —
  // platform-host-allowlist.spec.ts законно держит `localhost:3000` как фикстуру
  // host-allowlist'а, к таргетингу e2e отношения не имеющую.
  const ORIGIN_RE = /https?:\/\/(localhost|127\.0\.0\.1)/
  // Единственное место, которому origin строить и положено, — сам резолвер.
  const RESOLVER = join('tests', 'helpers', 'base-url.ts')

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : []
    })

  const scanned = [
    ...sources(join('tests', 'e2e')),
    ...sources(join('tests', 'helpers')),
    'playwright.config.ts',
  ].filter((file) => file !== RESOLVER)

  it('видит все файлы контура', () => {
    // Защита от самого себя: пустой список файлов дал бы вечно зелёную проверку.
    expect(scanned.length).toBeGreaterThan(5)
  })

  it.each(scanned)('%s не называет localhost-origin', (file) => {
    const offending = readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => [index + 1, line] as const)
      .filter(([, line]) => ORIGIN_RE.test(line))
      .map(([number, line]) => `${file}:${number}: ${line.trim()}`)
    expect(offending, 'origin берётся из baseURL (tests/helpers/base-url.ts)').toEqual([])
  })
})

describe('portConflictMessage', () => {
  const msg = portConflictMessage(3000)

  it('называет занятый порт и рабочий выход — свой порт через dev:ports', () => {
    expect(msg).toContain('3000')
    expect(msg).toContain('pnpm dev:ports')
    expect(msg).toContain('E2E_PORT')
  })

  it('запрещает убивать чужой listener, а не предлагает включить reuse', () => {
    expect(msg).toContain('Do NOT kill a listener you did not start')
    expect(msg).not.toContain('reuseExistingServer: true')
  })
})
