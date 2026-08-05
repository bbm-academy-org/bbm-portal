import { describe, expect, it } from 'vitest'

import { decideAskUserQuestion } from '../../tools/hooks/askuserquestion-context-guard.mjs'

/**
 * Гард самодостаточности вопроса к владельцу (#91). Владелец видит ТОЛЬКО текст
 * вопроса и вариантов — проза между вызовами инструментов до него не доезжает,
 * поэтому «повтор неотвеченного вопроса» и «голая ссылка #N» это
 * детерминированные нарушения, а не вкусовщина.
 *
 * Ревью PR #148 (refs #149) закрыло два провала первой версии: базовая длина
 * храповиком росла на каждом разрешённом повторе (150 → 300 → 600), а «владелец
 * не ответил» утверждалось без проверки. Теперь baseline фиксируется на ПЕРВОМ
 * вопросе, а ответ владельца ищется в транскрипте.
 */

const Q1 =
  'Продолжаем ли расконсервацию hook-стека прямо сейчас, или сначала закрываем ' +
  'остаток приёмки по калькулятору часов? Первый вариант тратит сессию на ' +
  'инструментарий, второй — на продуктовую задачу владельца.'

/** Вдвое длиннее Q1 — разрешённый переписанный повтор. */
const Q2 = `${Q1} ${Q1}`

function ask(question: string, header = 'Порядок') {
  return { questions: [{ header, question, options: [{ label: 'Да' }, { label: 'Нет' }] }] }
}

/** Строка транскрипта с ответом владельца на вопрос под этим header. */
function answerLine(text: string) {
  return JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', content: `The user answered: ${text}` }] },
  })
}

const NOISE = JSON.stringify({ type: 'assistant', message: { id: 'a1', content: 'думаю дальше' } })

describe('askuserquestion-context-guard', () => {
  it('первый вопрос проходит, запоминая baseline и позицию в транскрипте', () => {
    const d = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(Q1),
      state: {},
      transcript: `${NOISE}\n${NOISE}`,
    })
    expect(d.block).toBe(false)
    expect(d.state.headers['Порядок'].baseline).toBe(Q1.length)
    expect(d.state.headers['Порядок'].line).toBe(2)
  })

  it('неотвеченный дословный повтор блокируется', () => {
    const first = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(Q1),
      state: {},
      transcript: '',
    })
    const second = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(Q1),
      state: first.state,
      transcript: `${NOISE}\n${NOISE}`,
    })
    expect(second.block).toBe(true)
    expect(second.reason).toBe('repeat')
    expect(second.message).toContain('did not answer it')
  })

  it('после ответа владельца тот же header спрашивается заново', () => {
    const first = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(Q1),
      state: {},
      transcript: '',
    })
    const nextQuestion = 'Короткий следующий вопрос под тем же заголовком.'
    const second = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(nextQuestion),
      state: first.state,
      transcript: `${NOISE}\n${answerLine('Порядок: сначала hook-стек')}`,
    })
    expect(second.block).toBe(false)
    // Состояние header'а сброшено — новый вопрос стал новым baseline.
    expect(second.state.headers['Порядок'].baseline).toBe(nextQuestion.length)
  })

  it('ответ засчитывается и по 20-символьному префиксу самого вопроса', () => {
    const stale = { headers: { Порядок: { baseline: Q1.length, question: Q1, line: 0 } } }
    const d = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(Q1),
      state: stale,
      transcript: answerLine(Q1.slice(0, 40)),
    })
    expect(d.block).toBe(false)
  })

  it('ответ, случившийся ДО вопроса, повтор не разблокирует', () => {
    const stale = { headers: { Порядок: { baseline: Q1.length, question: Q1, line: 2 } } }
    const d = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(Q1),
      state: stale,
      transcript: `${answerLine('Порядок: да')}\n${NOISE}\n${NOISE}`,
    })
    expect(d.block).toBe(true)
  })

  it('baseline не растёт храповиком: несколько разрешённых повторов подряд', () => {
    const first = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(Q1),
      state: {},
      transcript: '',
    })
    const second = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(Q2),
      state: first.state,
      transcript: '',
    })
    expect(second.block).toBe(false)
    expect(second.state.headers['Порядок'].baseline).toBe(Q1.length)
    // Третий повтор той же длины: при храповике потребовалось бы уже 4× Q1.
    const third = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask(Q2),
      state: second.state,
      transcript: '',
    })
    expect(third.block).toBe(false)
    expect(third.state.headers['Порядок'].baseline).toBe(Q1.length)
  })

  it('короткий вопрос с голой ссылкой #N блокируется', () => {
    const d = decideAskUserQuestion({
      toolName: 'AskUserQuestion',
      toolInput: ask('Берём #107 в работу?'),
      state: {},
      transcript: '',
    })
    expect(d.block).toBe(true)
    expect(d.reason).toBe('bare-ref')
  })

  it('hex-цвет #4a90e2 ссылкой на задачу не считается', () => {
    expect(
      decideAskUserQuestion({
        toolName: 'AskUserQuestion',
        toolInput: ask('Акцент делаем #4a90e2 или теплее?'),
        state: {},
        transcript: '',
      }).block,
    ).toBe(false)
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
      transcript: '',
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
