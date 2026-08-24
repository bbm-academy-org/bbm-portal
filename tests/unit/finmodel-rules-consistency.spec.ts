import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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

  it('заголовки разделов — плоский текст, без разметки', () => {
    // `headingText` в components-map собирает якорь из ДЕТЕЙ заголовка и
    // отбрасывает всё, что не строка и не число: подчёркивание, код или
    // `<V/>` внутри `##` дали бы id, который не совпадёт со ссылкой слева.
    // Пока заголовки плоские, два источника (исходник и React-дети) сходятся;
    // это утверждение — то, что делает «пока» проверяемым.
    for (const [, title] of RULES_MDX.matchAll(/^## +(.+?)\s*$/gm)) {
      expect(title).not.toMatch(/[*_`<>[\]]/)
    }
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

/**
 * Компиляция документа — на процесс, а не на запрос (ревью PR #325, п.4).
 * Страница `force-dynamic`, но её источник константа, и без мемо каждый
 * читатель платил бы компиляцией MDX за один и тот же результат.
 */
describe('MDX компилируется один раз на процесс', () => {
  it('повторный вызов отдаёт тот же промис, а не новую компиляцию', async () => {
    const { compiledDocument } = await import('@/modules/finmodel/view/RulesDocument')
    const first = compiledDocument()
    expect(compiledDocument()).toBe(first)
    expect(await first).toBeTruthy()
  })
})

/**
 * Документ действительно ОТРЕНДЕРЕН, а не показан исходником.
 *
 * Приёмочный прогон #193 поймал ровно этот класс: четыре GFM-таблицы
 * («Выбери, кто ты», три пути, два словаря) доезжали до читателя строками
 * «| … | … |», потому что рендереру не передали remark-gfm. Компонент `table`
 * в components-map и обёртка `.rules-tablewrap` при этом выглядели рабочими —
 * они просто никогда не вызывались. Проверять надо результат, а не проводку.
 */
describe('нормативный документ рендерится, а не показывается исходником', () => {
  it('таблицы стали таблицами, а не абзацами с палками', async () => {
    const { compiledDocument } = await import('@/modules/finmodel/view/RulesDocument')
    const html = renderToStaticMarkup(
      React.createElement(React.Fragment, null, await compiledDocument()),
    )
    expect((html.match(/<table/g) ?? []).length).toBeGreaterThanOrEqual(4)
    // Обёртка горизонтального скролла тоже обязана СРАБОТАТЬ, а не существовать.
    expect((html.match(/rules-tablewrap/g) ?? []).length).toBeGreaterThanOrEqual(4)
    // Ни одной сырой строки разметки таблицы в тексте: ни разделителя `|---`,
    // ни вообще палки — в тексте документа её больше нигде нет.
    expect(html).not.toMatch(/\|\s*-{3}/)
    expect(html).not.toContain('|')
  })

  it('подстановки <V/> доехали значениями, а не тегами', async () => {
    const { compiledDocument } = await import('@/modules/finmodel/view/RulesDocument')
    const html = renderToStaticMarkup(
      React.createElement(React.Fragment, null, await compiledDocument()),
    )
    expect(html).not.toContain('<V ')
    expect(html).toContain('rules-var')
  })
})
