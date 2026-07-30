import { describe, expect, it } from 'vitest'

import {
  decideBlock as decideCompletionBlock,
  extractLastAssistantText,
  hasEyesOrNoVisualChange,
  isCompletionReport,
  isTerminalReport,
} from '../../tools/hooks/completion-report-gate.mjs'
import {
  decideBlock as decideDeviationsBlock,
  hasDeviationsLine,
} from '../../tools/hooks/deviations-gate.mjs'

/**
 * Два Stop-гейта (#91) делят один распознаватель терминального отчёта, поэтому
 * ложное срабатывание распознавателя блокировало бы остановку дважды — набор
 * кейсов ниже держит границу «отчёт о завершении» против статусов и вопросов.
 */

const REPORT_NO_MARKERS = 'Готово: PR #92 смержен, issue закрыт. Всё зелёное.'

describe('распознаватель терминального отчёта', () => {
  it('видит отчёт о завершении: глагол завершения + ссылка на issue/PR', () => {
    expect(isCompletionReport(REPORT_NO_MARKERS)).toBe(true)
    expect(isCompletionReport('PR #92 merged, ветка удалена')).toBe(true)
  })

  it('не считает отчётом текст без ссылки или без глагола завершения', () => {
    expect(isCompletionReport('Всё смержено и закрыто')).toBe(false)
    expect(isCompletionReport('Смотрю issue #92, разбираюсь')).toBe(false)
  })

  it('вычитает отрицания — «не смержен» это работа в полёте', () => {
    expect(isCompletionReport('PR #92 ещё не смержен, жду ревью')).toBe(false)
  })

  it('исключает вопрос владельцу, промежуточный статус и предложение следующего шага', () => {
    expect(isTerminalReport('PR #92 смержен. Закрывать ли issue #91?')).toBe(false)
    expect(isTerminalReport('⏳ Checkpoint: PR #92 смержен в ветку, жду CI')).toBe(false)
    expect(isTerminalReport('PR #92 смержен. Предлагаю запустить /wrap.')).toBe(false)
    expect(isTerminalReport(REPORT_NO_MARKERS)).toBe(true)
  })
})

describe('completion-report-gate (stage 6)', () => {
  it('блокирует отчёт без «Проверить глазами» и без честной формулы', () => {
    expect(
      decideCompletionBlock({ stopHookActive: false, lastAssistantText: REPORT_NO_MARKERS }),
    ).toEqual({ block: true })
  })

  it('пропускает отчёт с «Проверить глазами: <URL>»', () => {
    expect(
      decideCompletionBlock({
        stopHookActive: false,
        lastAssistantText: `${REPORT_NO_MARKERS}\nПроверить глазами: https://portal.bbm.academy/p/hours`,
      }).block,
    ).toBe(false)
  })

  it('пропускает честную формулу невидимого изменения', () => {
    expect(hasEyesOrNoVisualChange('визуально ничего не меняется; проверяется так: тестами')).toBe(
      true,
    )
    expect(hasEyesOrNoVisualChange('**Проверить глазами:** /p/okr')).toBe(true)
    expect(hasEyesOrNoVisualChange('визуальных изменений нет')).toBe(true)
    expect(hasEyesOrNoVisualChange('всё готово')).toBe(false)
  })

  it('loop-guard: после одного блока остановка проходит', () => {
    expect(
      decideCompletionBlock({ stopHookActive: true, lastAssistantText: REPORT_NO_MARKERS }).block,
    ).toBe(false)
  })

  it('нет ассистентского текста — блокировать нечего (fail-open)', () => {
    expect(decideCompletionBlock({ stopHookActive: false, lastAssistantText: null }).block).toBe(
      false,
    )
  })
})

describe('deviations-gate (stage 7)', () => {
  const withEyes = `${REPORT_NO_MARKERS}\nПроверить глазами: https://portal.bbm.academy/p/okr`

  it('блокирует отчёт без строки «Отклонения от конвенций»', () => {
    expect(decideDeviationsBlock({ stopHookActive: false, lastAssistantText: withEyes })).toEqual({
      block: true,
    })
  })

  it('пропускает и «нет», и список — гейт судит присутствие строки, не содержание', () => {
    expect(hasDeviationsLine('Отклонения от конвенций: нет')).toBe(true)
    expect(hasDeviationsLine('**Отклонения от конвенций:** порог гарда 3, а не 5')).toBe(true)
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        lastAssistantText: `${withEyes}\nОтклонения от конвенций: нет`,
      }).block,
    ).toBe(false)
  })

  it('оба гейта срабатывают на одном множестве сообщений', () => {
    const interim = '⏳ Checkpoint: PR #92 смержен в ветку, жду CI'
    expect(decideCompletionBlock({ stopHookActive: false, lastAssistantText: interim }).block).toBe(
      false,
    )
    expect(decideDeviationsBlock({ stopHookActive: false, lastAssistantText: interim }).block).toBe(
      false,
    )
  })

  it('loop-guard общий для обоих гейтов', () => {
    expect(decideDeviationsBlock({ stopHookActive: true, lastAssistantText: withEyes }).block).toBe(
      false,
    )
  })
})

describe('чтение транскрипта', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', message: { content: 'привет' } }),
    JSON.stringify({ type: 'assistant', message: { id: 'a1', content: 'первый ход' } }),
    '{ битая строка',
    JSON.stringify({
      type: 'assistant',
      message: { id: 'a2', content: [{ type: 'text', text: 'часть 1' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { id: 'a2', content: [{ type: 'text', text: 'часть 2' }] },
    }),
  ].join('\n')

  it('склеивает блоки последнего хода и переживает битые строки', () => {
    expect(extractLastAssistantText(jsonl)).toBe('часть 1\nчасть 2')
  })

  it('пустой транскрипт даёт null', () => {
    expect(extractLastAssistantText('')).toBeNull()
  })
})
