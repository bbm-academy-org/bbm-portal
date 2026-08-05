import { describe, expect, it } from 'vitest'

import { decideAskUserQuestion } from '../../tools/hooks/askuserquestion-context-guard.mjs'

/**
 * Гард самодостаточности вопроса к владельцу (#91). Владелец видит ТОЛЬКО текст
 * вопроса и вариантов — проза между вызовами инструментов до него не доезжает,
 * поэтому «повтор того же вопроса» и «голая ссылка #N» это детерминированные
 * нарушения, а не вкусовщина.
 */

const SELF_CONTAINED =
  'Продолжаем ли расконсервацию hook-стека прямо сейчас, или сначала закрываем ' +
  'остаток приёмки по калькулятору часов? Первый вариант тратит сессию на ' +
  'инструментарий, второй — на продуктовую задачу владельца.'

function ask(question: string, header = 'Порядок') {
  return { questions: [{ header, question, options: [{ label: 'Да' }, { label: 'Нет' }] }] }
}

describe('askuserquestion-context-guard', () => {
  it('первый вопрос проходит и запоминается по header', () => {
    const d = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(SELF_CONTAINED),
      state: {},
    })
    expect(d.block).toBe(false)
    expect(d.state.headers['Порядок']).toBe(SELF_CONTAINED.length)
  })

  it('дословный повтор того же header блокируется — владелец уже его не понял', () => {
    const first = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(SELF_CONTAINED),
      state: {},
    })
    const second = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(SELF_CONTAINED),
      state: first.state,
    })
    expect(second.block).toBe(true)
    expect(second.reason).toBe('repeat')
    expect(second.message).toContain('askuserquestion guard')
  })

  it('повтор, переписанный вдвое подробнее, проходит', () => {
    const first = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(SELF_CONTAINED),
      state: {},
    })
    const expanded = `${SELF_CONTAINED} ${SELF_CONTAINED} И вот почему это важно именно сейчас.`
    const second = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(expanded),
      state: first.state,
    })
    expect(second.block).toBe(false)
    expect(second.state.headers['Порядок']).toBe(expanded.length)
  })

  it('короткий вопрос с голой ссылкой #N блокируется', () => {
    const d = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask('Берём #107 в работу?'),
      state: {},
    })
    expect(d.block).toBe(true)
    expect(d.reason).toBe('bare-ref')
  })

  it('длинный самодостаточный вопрос с #N проходит', () => {
    const d = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(
        'Задача #107 — это подключение Гермеса к базе знаний bbm-kb, она заблокирована ' +
          'на твоём PAT для приватного репозитория. Берём её сейчас, или сначала ' +
          'закрываем расконсервацию hook-стека?',
      ),
      state: {},
    })
    expect(d.block).toBe(false)
  })

  it('битый payload и чужой инструмент — пропускаем (fail-open)', () => {
    expect(
      decideAskUserQuestion({ toolName: 'AskUserQuestion', toolInput: null, state: {} }).block,
    ).toBe(false)
    expect(
      decideAskUserQuestion({
        toolName: 'AskUserQuestion',
        toolInput: { questions: 'не массив' },
        state: {},
      }).block,
    ).toBe(false)
    expect(
      decideAskUserQuestion({ toolName: 'Edit', toolInput: ask('Берём #107?'), state: {} }).block,
    ).toBe(false)
  })
})
