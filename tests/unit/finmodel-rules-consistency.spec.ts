import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatPercent, formatRub, getVariables, resolveVar } from '@/lib/finmodel'

/**
 * Снимок читается с диска прямо здесь, а не через дверь в `src/lib`: у текста
 * документа в этом репо ровно один потребитель — вот этот тест (рендерит
 * документ KB, см. шапку ниже). Заводить ради него рантайм-модуль с лоадером и
 * объявлениями в конфигах сборщиков значило бы построить механизм для ноля
 * потребителей.
 */
const RULES_MDX = readFileSync(
  join(import.meta.dirname, '..', '..', 'src', 'lib', 'finmodel', 'snapshot', 'rules.mdx'),
  'utf8',
)

/**
 * Согласованность нормативного документа «Смарт-контракт BBM» с кодом (#193).
 *
 * Документ мастерится НЕ здесь: его мастер — `content/finmodel/index.mdx` в
 * bbm-kb, сюда он приезжает байт в байт (`pnpm ssot:pull`), а РЕНДЕРИТ его KB
 * (kb.bbm.academy/finmodel) — портальную страницу владелец отменил 2026-08-24.
 * Значит, единственное, ради чего снимок лежит в этом репо, — вот эти
 * проверки: машинный контракт между текстом владельца и кодом расчётов.
 *
 * Контракт: каждое число документа приходит из снапшота через `<V/>`, и ни
 * одно не набрано руками. Почему это тест, а не договорённость: набранное
 * руками число молча расходится с мастером значений при первой же его правке,
 * и расхождение видит читатель, а не автор. Сломать тест обязана ровно та
 * правка, которая заменяет `<V/>` на цифру.
 */

/** MDX-комментарии — не тело документа: в них живут служебные пометки. */
function documentBody(mdx: string): string {
  return mdx.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

/** Тело без подстановок — то, что автор набрал руками. */
function bodyWithoutSubstitutions(mdx: string): string {
  return documentBody(mdx).replace(/<V\s[^>]*\/>/g, '')
}

function usedVariableKeys(mdx: string): string[] {
  return [...documentBody(mdx).matchAll(/<V\s+k="([^"]+)"/g)].map((match) => match[1])
}

describe('нормативный документ: снимок мастера', () => {
  it('приехал целиком, а не заглушкой', () => {
    expect(RULES_MDX.length).toBeGreaterThan(1000)
    expect(RULES_MDX).toContain('title: Смарт-контракт BBM')
    // Стаб мастера («документ перенесён, здесь ничего нет») помечается статусом
    // во фронтматтере. Сверять с ним значило бы объявить согласованным пустой
    // файл: подстановок в стабе нет, и все проверки ниже прошли бы вхолостую.
    expect(RULES_MDX).not.toMatch(/^status:\s*pending\s*$/m)
  })
})

/**
 * Пин подстановок: какие ключи документ зовёт и сколько раз.
 *
 * Проверка «нет чисел, набранных руками» ниже ловит только те значения, у
 * которых есть единица измерения: процент и рубль опознаются в тексте. Доли
 * распределения рендерятся голыми целыми, и `4` в теле документа встречается
 * законно («40 часов»), поэтому со стороны текста такую подмену не поймать
 * вообще — `<V k="policy.profit_shares.author" />`, заменённый на «2», не
 * нарушал ни одного из тех правил.
 *
 * Поэтому контракт закреплён с ДРУГОЙ стороны: не «каких чисел в тексте нет»,
 * а «какие подстановки в тексте есть». Удалённая или подменённая `<V/>` роняет
 * тест мгновенно; новая подстановка в мастере — осознанная правка одной строки
 * здесь, на которую смотрит ревьюер.
 */
describe('состав подстановок документа закреплён', () => {
  // Список ведётся руками намеренно: он и есть предмет договорённости.
  const EXPECTED_KEY_COUNTS: Record<string, number> = {
    'policy.profit_shares.author': 3,
    'policy.profit_shares.coauthors': 1,
    'policy.profit_shares.investors': 2,
    'policy.reserve_percent': 1,
    'policy.royalty_percent.bbm_holders': 3,
    'policy.royalty_percent.mission_fund': 2,
    'policy.royalty_percent.total': 2,
  }

  it('документ зовёт ровно те ключи и ровно столько раз', () => {
    const counts: Record<string, number> = {}
    for (const key of usedVariableKeys(RULES_MDX)) {
      counts[key] = (counts[key] ?? 0) + 1
    }
    expect(counts).toEqual(EXPECTED_KEY_COUNTS)
  })

  it('каждый закреплённый ключ разрешается в снапшоте', () => {
    // Иначе пин можно было бы «починить» опечаткой, а не правкой документа.
    const variables = getVariables()
    for (const key of Object.keys(EXPECTED_KEY_COUNTS)) {
      expect(typeof resolveVar(variables, key)).toBe('number')
    }
  })
})

describe('каждое число документа приходит из снапшота', () => {
  it('все ключи <V/> разрешаются в числа снапшота', () => {
    const variables = getVariables()
    const keys = usedVariableKeys(RULES_MDX)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(() => resolveVar(variables, key)).not.toThrow()
      expect(typeof resolveVar(variables, key)).toBe('number')
    }
  })

  it('оборванный ключ — исключение, а не молчаливый прочерк', () => {
    const variables = getVariables()
    expect(() => resolveVar(variables, 'policy.нет_такого')).toThrow(/policy\.нет_такого/)
    expect(() => resolveVar(variables, 'policy.royalty_percent')).toThrow()
  })
})

describe('в теле документа нет чисел, набранных руками', () => {
  const body = bodyWithoutSubstitutions(RULES_MDX)

  it('ни одного процента вне <V/>', () => {
    // Все проценты документа — это ставка резерва и сплит роялти, и все они
    // подставляются. Литерал `15%`, набранный вместо `<V k="…" unit="%" />`,
    // переживёт правку мастера и станет неправдой.
    expect(body).not.toMatch(/\d\s*%/)
  })

  it('ни одной суммы в рублях вне <V/>', () => {
    expect(body).not.toContain('₽')
  })

  it('пропорция распределения не набрана цифрами', () => {
    // «4 : 2 : 1» в тексте — три значения `policy.profit_shares`, каждое своим
    // `<V/>`; набранная пропорция разъехалась бы с ними целиком.
    expect(body).not.toMatch(/\d\s*:\s*\d\s*:\s*\d/)
  })

  it('форматированные значения снапшота в теле не встречаются', () => {
    // Проверка от значений, а не от жёстких литералов: список строится из
    // снапшота, поэтому правка мастера меняет и то, что тест ищет.
    const policy = getVariables().policy
    const forbidden = [
      formatPercent(policy.reserve_percent),
      formatPercent(policy.royalty_percent.total),
      formatPercent(policy.royalty_percent.mission_fund),
      formatPercent(policy.royalty_percent.bbm_holders),
      formatRub(policy.emission_price_rub),
    ]
    for (const literal of forbidden) {
      expect(body).not.toContain(literal)
    }
  })
})
