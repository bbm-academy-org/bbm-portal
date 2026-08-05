import { describe, expect, it } from 'vitest'

import { decideBlock as decideCompletionBlock } from '../../tools/hooks/completion-report-gate.mjs'
import { decideBlock as decideDeviationsBlock } from '../../tools/hooks/deviations-gate.mjs'
import {
  decideWarn,
  hasDecisionDebtLine,
  warnMessage,
} from '../../tools/hooks/surface-decision-debt-gate.mjs'

/**
 * Третий Stop-гейт (#134) переиспользует распознаватель терминального отчёта из
 * completion-report-gate, поэтому кейсы ниже держат две границы сразу: тот же
 * набор сообщений, что у двух блокирующих гейтов, и WARN-семантика — гейт
 * никогда не останавливает остановку (промоушен severity — #136).
 */

const REPORT_NO_MARKERS = 'Готово: PR #135 смержен, issue #134 закрыт. Всё зелёное.'

/** Каноничный отчёт stage 6/7 без строки маршрутизации. */
const REPORT_STAGE67 = [
  'Гейт decision-debt портирован: PR #135 смержен, issue #134 закрыт.',
  'Проверить глазами: визуально ничего не меняется; проверяется так: тестами.',
  'Статус: смержено, деплоя не требует.',
  '100% от заявленного объёма.',
  'Отклонения от конвенций: нет.',
].join('\n')

describe('surface-decision-debt gate: распознавание строки', () => {
  it('видит строку в любом оформлении и регистре', () => {
    expect(hasDecisionDebtLine('surface-decision-debt: []')).toBe(true)
    expect(hasDecisionDebtLine('**surface-decision-debt:** issue #150')).toBe(true)
    expect(hasDecisionDebtLine('Surface-Decision-Debt : DEBT.md строка')).toBe(true)
  })

  it('не путает упоминание скилла без строки отчёта', () => {
    expect(hasDecisionDebtLine('загрузил скилл surface-decision-debt и подумал')).toBe(false)
    expect(hasDecisionDebtLine('')).toBe(false)
    expect(hasDecisionDebtLine(null)).toBe(false)
  })

  it('присутствия достаточно — содержание гейт не судит', () => {
    expect(hasDecisionDebtLine('surface-decision-debt: []')).toBe(true)
    expect(
      hasDecisionDebtLine('surface-decision-debt: порог гарда 3 вместо 5 → DEBT.md (return: #136)'),
    ).toBe(true)
  })
})

describe('surface-decision-debt gate: решение', () => {
  it('предупреждает на терминальном отчёте без строки', () => {
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: REPORT_NO_MARKERS,
      }),
    ).toEqual({
      warn: true,
    })
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: REPORT_STAGE67,
      }).warn,
    ).toBe(true)
  })

  it('молчит, когда строка есть — и пустая, и с маршрутизацией', () => {
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: `${REPORT_STAGE67}\nsurface-decision-debt: []`,
      }).warn,
    ).toBe(false)
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: `${REPORT_STAGE67}\nsurface-decision-debt: WARN вместо BLOCK → #136`,
      }).warn,
    ).toBe(false)
  })

  it('loop-guard: после блока другого Stop-гейта не предупреждает', () => {
    expect(
      decideWarn({
        stopHookActive: true,
        writeActionSeen: true,
        lastAssistantText: REPORT_NO_MARKERS,
      }).warn,
    ).toBe(false)
  })

  it('нет ассистентского текста — предупреждать не о чем (fail-open)', () => {
    expect(
      decideWarn({ stopHookActive: false, writeActionSeen: true, lastAssistantText: null }).warn,
    ).toBe(false)
    expect(
      decideWarn({ stopHookActive: false, writeActionSeen: true, lastAssistantText: '' }).warn,
    ).toBe(false)
  })

  it('не трогает вопрос владельцу, промежуточный статус и предложение следующего шага', () => {
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: 'PR #135 смержен. Закрывать ли issue #134?',
      }).warn,
    ).toBe(false)
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: '⏳ Checkpoint: PR #135 смержен в ветку, жду CI',
      }).warn,
    ).toBe(false)
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: 'PR #135 смержен. Предлагаю запустить /wrap.',
      }).warn,
    ).toBe(false)
  })
})

describe('surface-decision-debt gate: композиция с двумя блокирующими гейтами', () => {
  it('срабатывает ровно на том же множестве сообщений', () => {
    const interim = '⏳ Checkpoint: PR #135 смержен в ветку, жду CI'
    expect(
      decideCompletionBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: interim,
      }).block,
    ).toBe(false)
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: interim,
      }).block,
    ).toBe(false)
    expect(
      decideWarn({ stopHookActive: false, writeActionSeen: true, lastAssistantText: interim }).warn,
    ).toBe(false)

    expect(
      decideCompletionBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: REPORT_NO_MARKERS,
      }).block,
    ).toBe(true)
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: REPORT_NO_MARKERS,
      }).block,
    ).toBe(true)
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: REPORT_NO_MARKERS,
      }).warn,
    ).toBe(true)
  })

  it('отчёт stage 6/7 проходит блокирующие гейты и остаётся только с WARN', () => {
    expect(
      decideCompletionBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: REPORT_STAGE67,
      }).block,
    ).toBe(false)
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: REPORT_STAGE67,
      }).block,
    ).toBe(false)
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: REPORT_STAGE67,
      }).warn,
    ).toBe(true)
  })

  it('текст предупреждения называет обе строки и не выдаёт себя за блок', () => {
    const m = warnMessage()
    expect(m).toContain('surface-decision-debt:')
    expect(m).toContain('Отклонения от конвенций')
    expect(m).toContain('WARN')
    expect(m).not.toContain('⛔')
  })
})
