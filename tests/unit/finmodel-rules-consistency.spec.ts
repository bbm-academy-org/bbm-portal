import { describe, expect, it } from 'vitest'

import { formatPercent, formatRub, getVariables, RULES_MDX } from '@/lib/finmodel'
import { documentToc, headingText, sectionId } from '@/modules/finmodel/view/toc'
import { resolveVar } from '@/modules/finmodel/view/V'

/**
 * Согласованность нормативного документа «Смарт-контракт BBM» с кодом (#193).
 *
 * Документ мастерится НЕ здесь: его мастер — `content/finmodel/index.mdx` в
 * bbm-kb, сюда он приезжает байт в байт (`pnpm ssot:pull`). Поэтому тесты ниже
 * — не про формулировки владельца, а про единственный машинный контракт между
 * текстом и кодом: каждое число документа приходит из снапшота через `<V/>`, и
 * ни одно не набрано руками.
 *
 * Почему это тест, а не договорённость: набранное руками число молча
 * расходится с мастером значений при первой же его правке, и расхождение видит
 * читатель, а не автор. Сломать тест обязана ровно та правка, которая заменяет
 * `<V/>` на цифру.
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
    // во фронтматтере — отрендерить его вместо документа значило бы показать
    // читателю пустую нормативную страницу как настоящую.
    expect(RULES_MDX).not.toMatch(/^status:\s*pending\s*$/m)
  })

  it('несёт разделы, из которых собирается оглавление', () => {
    const headings = [...RULES_MDX.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim())
    expect(headings.length).toBeGreaterThanOrEqual(5)
    expect(new Set(headings).size).toBe(headings.length)
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

/**
 * Оглавление и якоря — две стороны одного алгоритма: список слева считает
 * `documentToc`, id заголовка справа — компонент `h2` рендерера, и оба зовут
 * `sectionId`. Тест держит именно стык: ссылка обязана вести в существующий
 * раздел, а не в пустоту.
 */
describe('оглавление ведёт в разделы документа', () => {
  const toc = documentToc(RULES_MDX)

  it('собрано из всех разделов, ни один id не пуст и не повторяется', () => {
    const headings = [...RULES_MDX.matchAll(/^## +(.+?)\s*$/gm)].map((match) => match[1])
    expect(toc.map((entry) => entry.title)).toEqual(headings)
    expect(toc.every((entry) => entry.id.length > 0)).toBe(true)
    expect(new Set(toc.map((entry) => entry.id)).size).toBe(toc.length)
  })

  it('якорь заголовка считается тем же способом, что и ссылка', () => {
    // Ровно тот путь, которым идёт компонент `h2` в components-map рендерера:
    // текст детей → sectionId.
    for (const entry of toc) {
      expect(sectionId(headingText(entry.title))).toBe(entry.id)
    }
  })

  it('кириллица не транслитерируется, разделители схлопываются', () => {
    expect(sectionId('Я работаю в команде проекта')).toBe('я-работаю-в-команде-проекта')
    expect(sectionId('Я врач (пример аудитории — Doctor.School)')).toBe(
      'я-врач-пример-аудитории-doctor-school',
    )
    expect(sectionId('— — —')).toBe('section')
  })
})
