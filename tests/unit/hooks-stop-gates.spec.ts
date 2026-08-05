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
  detectHaltSignal,
  hasDeviationsLine,
  hasNoDeviationsValue,
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

  // Пункт 5 формы stage 6 — «вопросы владельцу», поэтому каноничный отчёт почти
  // всегда оканчивается строкой с «?». Освобождать его от гейтов нельзя: иначе
  // гейт ловил бы только отчёты, нарушающие форму по последнему пункту
  // (ревью PR #99).
  it('развёрнутый отчёт stage 6, оканчивающийся вопросом владельцу, остаётся терминальным', () => {
    const report = [
      'Гейты хуков расконсервированы: PR #99 смержен, issue #91 закрыт.',
      'Проверить глазами: визуально ничего не меняется; проверяется так: тестами.',
      'Статус: смержено, задеплоя не требует.',
      '100% от заявленного объёма.',
      'Отклонения от конвенций: нет.',
      'Вопрос: оставляем порог dispatch-гарда равным 3?',
    ].join('\n')
    expect(isTerminalReport(report)).toBe(true)
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

describe('deviations-gate: самосертификация «нет» после стопа владельца', () => {
  const withEyes = `${REPORT_NO_MARKERS}\nПроверить глазами: https://portal.bbm.academy/p/okr`
  const noDeviations = `${withEyes}\n**Отклонения от конвенций:** нет.`
  const listed = `${withEyes}\nОтклонения от конвенций: диспетчеризация через staging вместо прямого применения.`

  it('распознаёт значение «нет» после маркера', () => {
    expect(hasNoDeviationsValue('Отклонения от конвенций: нет')).toBe(true)
    expect(hasNoDeviationsValue('**Отклонения от конвенций:** нет.')).toBe(true)
    expect(hasNoDeviationsValue('Отклонения от конвенций: значимых отклонений нет')).toBe(true)
    expect(hasNoDeviationsValue('Отклонения от конвенций: три штуки, см. ниже')).toBe(false)
    expect(hasNoDeviationsValue(listed)).toBe(false)
  })

  it('«нет» + стоп владельца в сессии → блок', () => {
    const d = decideDeviationsBlock({
      stopHookActive: false,
      lastAssistantText: noDeviations,
      haltSignal: true,
    })
    expect(d.block).toBe(true)
    expect(d.reason).toBe('self-cert')
  })

  it('«нет» в тихой сессии проходит', () => {
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        lastAssistantText: noDeviations,
        haltSignal: false,
      }).block,
    ).toBe(false)
  })

  it('список отклонений после стопа проходит — loop-guard исправленного отчёта', () => {
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        lastAssistantText: listed,
        haltSignal: true,
      }).block,
    ).toBe(false)
  })

  it('отсутствие строки блокирует как раньше, независимо от сигнала стопа', () => {
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        lastAssistantText: withEyes,
        haltSignal: true,
      }).block,
    ).toBe(true)
  })
})

describe('deviations-gate: распознавание стопа владельца в транскрипте', () => {
  it('видит queued_command от человека', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: 'привет' } }),
      JSON.stringify({
        type: 'user',
        attachment: { type: 'queued_command', origin: { kind: 'human' }, prompt: 'тормози' },
      }),
    ].join('\n')
    expect(detectHaltSignal(jsonl)).toBe(true)
  })

  it('видит обычное человеческое сообщение и прошлый блок Stop-хука', () => {
    expect(
      detectHaltSignal(
        JSON.stringify({ type: 'user', message: { content: 'стоп, что ты делаешь' } }),
      ),
    ).toBe(true)
    expect(
      detectHaltSignal(
        JSON.stringify({ type: 'user', message: { content: '⛔ deviations gate (#91): …' } }),
      ),
    ).toBe(true)
  })

  it('тихая сессия и битые строки сигнала не дают', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: 'давай дальше' } }),
      '{ битая строка',
      JSON.stringify({ type: 'assistant', message: { id: 'a1', content: 'останови сервер' } }),
    ].join('\n')
    expect(detectHaltSignal(jsonl)).toBe(false)
    expect(detectHaltSignal('')).toBe(false)
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
