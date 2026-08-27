import { describe, expect, it } from 'vitest'

import {
  BUDGET_KEY as COMPLETION_REPORT_BUDGET_KEY,
  decideBlock as decideCompletionBlock,
  extractLastAssistantText,
  hasEyesOrNoVisualChange,
  hasWriteAction,
  isCompletionReport,
  isEnforceableTerminalReport,
  hasExplicitInterimMarker,
  hasOwnerQuestionMarker,
  isInterimStatus,
  isOwnerQuestionForm,
  isTerminalReport,
} from '../../tools/hooks/completion-report-gate.mjs'
import {
  BUDGET_KEY as DEVIATIONS_BUDGET_KEY,
  decideBlock as decideDeviationsBlock,
  detectHaltSignal,
  hasDeviationsLine,
  hasNoDeviationsValue,
} from '../../tools/hooks/deviations-gate.mjs'
import {
  applyBlockBudget,
  blockBudgetStatePath,
  budgetDemotedMessage,
  hasSpentBlockBudget,
  recordBlockBudgetSpend,
} from '../../tools/hooks/shared.mjs'
import { decideWarn } from '../../tools/hooks/surface-decision-debt-gate.mjs'

/**
 * Два Stop-гейта (#91) делят один распознаватель терминального отчёта, поэтому
 * ложное срабатывание распознавателя блокировало бы остановку дважды — набор
 * кейсов ниже держит границу «отчёт о завершении» против статусов и вопросов.
 *
 * С #158 распознаватель двусоставный: ТЕКСТ читается как отчёт И сессия
 * действительно совершила write-действие. Поэтому кейсы решения ниже передают
 * `writeActionSeen: true` явно — они описывают сессию, которая работала.
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

  // Ретро 2026-08-19: «Статус промежуточный» — тот же промежуточный статус, что и
  // «промежуточный статус», только с инверсным порядком слов. Распознаватель ловил
  // лишь прямой порядок, и инверсный чекпойнт уходил под Stop-гейты как терминальный
  // отчёт.
  it('видит промежуточный статус в обоих порядках слов', () => {
    expect(isInterimStatus('Промежуточный статус: подшаг смержен, задача — нет.')).toBe(true)
    expect(isInterimStatus('Статус промежуточный: подшаг смержен, задача — нет.')).toBe(true)
    expect(isTerminalReport('Статус промежуточный: PR #92 смержен, задача — нет.')).toBe(false)
  })

  // Ревью PR #290: инверсный порядок почти всегда пишется с разделителем —
  // «Статус: промежуточный», «статус — промежуточный». Требовать голый пробел
  // значило бы починить распознаватель ровно для той формы, которая встречается реже всего.
  it('видит инверсный порядок через пунктуацию', () => {
    expect(isInterimStatus('Статус: промежуточный, подшаг смержен.')).toBe(true)
    expect(isInterimStatus('статус — промежуточный, задача не закрыта.')).toBe(true)
    expect(isInterimStatus('Статус - промежуточный.')).toBe(true)
    expect(isTerminalReport('Статус: промежуточный — PR #92 смержен, задача — нет.')).toBe(false)
  })

  // Ретро 2026-08-20 (#299), тема `interim-status-ceremony-noise`. Фикс #284
  // недотянул: девять чекпойнтов подряд несли полный хвост stage-6/7, потому что
  // у сессии не было ОБЪЯВЛЕННОГО способа сказать «это не финальный отчёт». Явный
  // маркер отдельной строкой — этот способ, и он бьёт все эвристики ниже.
  it('явный маркер отдельной строкой освобождает чекпойнт от хвоста stage-6/7', () => {
    const checkpoint = [
      '**Статус промежуточный.**',
      '',
      'PR #294 смержен, задача #201 не закрыта — жду прогон приёмки.',
    ].join('\n')
    expect(hasExplicitInterimMarker(checkpoint)).toBe(true)
    expect(isTerminalReport(checkpoint)).toBe(false)
    expect(
      decideCompletionBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: checkpoint,
      }),
    ).toEqual({ block: false })
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: checkpoint,
      }),
    ).toEqual({ block: false })
    expect(
      decideWarn({ stopHookActive: false, writeActionSeen: true, lastAssistantText: checkpoint }),
    ).toEqual({ warn: false })
  })

  it('маркер внутри предложения финального отчёта его не освобождает', () => {
    expect(
      hasExplicitInterimMarker('Задача #91 закрыта, промежуточный статус больше не нужен.'),
    ).toBe(false)
    expect(isTerminalReport(REPORT_NO_MARKERS)).toBe(true)
  })

  it('английская форма маркера распознаётся так же', () => {
    expect(hasExplicitInterimMarker('Interim status\n\nPR #294 merged, issue #201 open.')).toBe(
      true,
    )
  })
})

/**
 * #374, incident 2026-08-26: nearly every owner-facing question was blocked once
 * and re-sent, so the owner saw each question twice. The message was in the
 * canonical four-beat owner-question form mandated by
 * `.claude/skills/report-task-outcome/SKILL.md` («Owner-question form»), but the
 * recognizer read it as a completion report: `COMPLETION_VERB_RE` matched
 * «закрыты» in domain speech, `REF_RE` matched the spec reference `#338`, and the
 * `isDecisionRequest` exemption needs <= 4 lines so the canonical form never fits.
 *
 * The fix is the same philosophy as the declared interim marker (#299): the
 * recognizer learns the DECLARED form instead of widening the heuristics.
 */
describe('#374: the declared owner-question form is not a terminal report', () => {
  /** The exact shape from the owner's 2026-08-26 screenshot. */
  const OWNER_QUESTION = [
    'Вопрос 2 из 8 — доступ к записям справочника',
    'Что случилось: записи в справочнике временно закрыты на роль администратора.',
    'Почему спрашиваю: спека #338 не называет, кто видит их после запуска.',
    'Что изменит ответ: от него зависит, показывать ли колонку всем сотрудникам.',
    'Где посмотреть: https://portal.bbm.academy/p/finance',
  ].join('\n')

  it('the incident message is not terminal and passes both blocking gates', () => {
    // Preconditions of the incident: longer than the short-question exemption,
    // no interim marker, and the completion heuristics genuinely fire on it.
    expect(OWNER_QUESTION.split('\n').filter((l) => l.trim()).length).toBeGreaterThan(4)
    expect(hasExplicitInterimMarker(OWNER_QUESTION)).toBe(false)
    expect(isCompletionReport(OWNER_QUESTION)).toBe(true)

    expect(isOwnerQuestionForm(OWNER_QUESTION)).toBe(true)
    expect(isTerminalReport(OWNER_QUESTION)).toBe(false)
    expect(
      decideCompletionBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: OWNER_QUESTION,
      }),
    ).toEqual({ block: false })
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: OWNER_QUESTION,
      }),
    ).toEqual({ block: false })
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: OWNER_QUESTION,
      }),
    ).toEqual({ warn: false })
  })

  // Review of PR #375 (BLOCKER): a «Вопрос N из M» / «Вопрос владельцу» HEADER
  // is not part of the declared form at all. `report-task-outcome` defines point
  // 5 of the mandatory stage-6 shape as literally «Вопросы владельцу» on its own
  // line, so any header-based branch would exempt the CORRECTLY formed final
  // report from all three gates — re-opening through a different door the very
  // hole the `isDecisionRequest` length condition closed in PR #99. The header
  // buys nothing either: the incident message qualifies on its beats alone.
  it('the point-5 section title «Вопросы владельцу» does NOT exempt a report', () => {
    const heading = 'PR #92 смержен, issue #91 закрыт. 100% от заявленного объёма.'
    for (const title of ['## Вопросы владельцу', '**Вопросы владельцу**', 'Вопросы владельцу:']) {
      const report = `${title}\n${heading}`
      expect(isOwnerQuestionForm(report)).toBe(false)
      expect(isTerminalReport(report)).toBe(true)
      expect(
        decideCompletionBlock({
          stopHookActive: false,
          writeActionSeen: true,
          lastAssistantText: report,
        }),
      ).toEqual({ block: true })
    }
  })

  // REVERSED by #392, deliberately. PR #375 pinned the NUMBERED header as a
  // non-form because round 1 had recognized «Вопрос N из M» and «Вопрос
  // владельцу» through one branch, and the PLURAL «Вопросы владельцу» — point 5
  // of the mandatory stage-6 shape — collided with it. Only the plural was the
  // hole: «Вопрос 3 из 8» has no collision with any heading a real report
  // carries, so #392 restores it as a declared marker (see the #392 describe
  // block below). The plural stays pinned as a non-marker in both directions.
  it('a standalone numbered question header is a declared marker (#392)', () => {
    const headerOnly = [
      'Вопрос 3 из 8 — кто платит за внешний сервис',
      'PR #352 смержен, issue #338 закрыт, ledger лежит в базе.',
      'Дальше нужен твой выбор по оплате.',
      'Работа ждёт ответа.',
      'Ничего больше не начинаю.',
    ].join('\n')
    expect(isOwnerQuestionForm(headerOnly)).toBe(true)
    expect(isTerminalReport(headerOnly)).toBe(false)
  })

  it('one lone beat label does NOT exempt a real completion report', () => {
    const report = [
      'Готово: PR #92 смержен, issue #91 закрыт.',
      'Что случилось: гейт перестал блокировать чекпойнты.',
      'Статус: смержено, задеплоя не требует.',
      '100% от заявленного объёма.',
    ].join('\n')
    expect(isOwnerQuestionForm(report)).toBe(false)
    expect(isTerminalReport(report)).toBe(true)
  })

  it('two distinct beat labels are already the declared form', () => {
    const twoBeats = [
      'Что случилось: записи закрыты на роль администратора (#338).',
      'Почему спрашиваю: спека не называет, кто их видит.',
      'Нужен твой выбор, дальше не двигаюсь.',
      'Работа стоит.',
      'Жду.',
    ].join('\n')
    expect(isOwnerQuestionForm(twoBeats)).toBe(true)
    expect(isTerminalReport(twoBeats)).toBe(false)
  })

  it('markdown emphasis and heading hashes around the labels are tolerated', () => {
    expect(
      isOwnerQuestionForm('**Что случилось:** записи закрыты.\n**Где посмотреть:** /p/finance'),
    ).toBe(true)
    expect(
      isOwnerQuestionForm('## Что случилось: записи закрыты\n### Почему спрашиваю: спека молчит'),
    ).toBe(true)
  })

  it('a beat label is pinned to its own line and to the exact wording', () => {
    // Quoted inside a sentence, a beat label is not a beat — the own-line
    // discipline is the same one `EXPLICIT_INTERIM_MARKER_RE` already carries.
    expect(
      isOwnerQuestionForm(
        'Ниже написано, что случилось: PR #92 смержен.\nИ отдельно, где посмотреть: /p/hours',
      ),
    ).toBe(false)
    // «почему спрашива[а-яё\w]*» tolerates the inflection, nothing else does:
    // the tails are written `[а-яё\w]*` because JS `\w` is ASCII-only.
    expect(isOwnerQuestionForm('Почему спрашивал: спека молчит.\nГде посмотреть: /p/finance')).toBe(
      true,
    )
    expect(isOwnerQuestionForm('Что изменилось: ничего.\nГде посмотреть: /p/finance')).toBe(false)
  })

  // DELIBERATE TRADE-OFF, pinned here so it cannot be "fixed" by accident: a
  // would-be FINAL report that embeds the four-beat question form escapes all
  // three gates. This is fail-open by design, exactly like the declared interim
  // marker (#299) — the recognizer trusts declared forms, and the price of a
  // missed gate is lower than the price of blocking every owner question.
  it('trade-off: a stage-6-shaped report carrying all four beats is exempt', () => {
    const reportWithQuestion = [
      'Готово: PR #92 смержен, issue #91 закрыт.',
      'Статус: смержено, задеплоя не требует.',
      '100% от заявленного объёма.',
      'Что случилось: гейт перестал блокировать вопросы.',
      'Почему спрашиваю: остался открытым порог dispatch-гарда.',
      'Что изменит ответ: порог станет 3 или 5.',
      'Где посмотреть: https://portal.bbm.academy/p/hours',
    ].join('\n')
    expect(isOwnerQuestionForm(reportWithQuestion)).toBe(true)
    expect(isTerminalReport(reportWithQuestion)).toBe(false)
  })

  it('regression: the canonical terminal reports are still recognized', () => {
    expect(isTerminalReport(REPORT_NO_MARKERS)).toBe(true)
    expect(isOwnerQuestionForm(REPORT_NO_MARKERS)).toBe(false)
    expect(
      decideCompletionBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: REPORT_NO_MARKERS,
      }),
    ).toEqual({ block: true })
    expect(isOwnerQuestionForm('')).toBe(false)
    expect(isOwnerQuestionForm(null)).toBe(false)
  })
})

/**
 * #392, incident 2026-08-27 — the owner's SECOND complaint, one day after the
 * #374 fix shipped. A free-form binary decision request about PR #354 was
 * blocked by both BLOCK gates and re-sent: it was written as free sections
 * («Что происходит», «Почему мерж не происходит сам», «Что нужно от тебя»),
 * carried zero beat labels, and tripped `COMPLETION_VERB_RE` on «Осталось
 * только смержить» plus `REF_RE` on `PR #354` while being far longer than the
 * `isDecisionRequest` four-line cap.
 *
 * The message DID already carry the literal line «Вопрос владельцу: …». So the
 * fix is the same philosophy once more: read the DECLARED marker.
 */
describe('#392: the declared owner-question MARKER line', () => {
  /** The shape from the owner's 2026-08-27 screenshot. */
  const FREE_FORM_QUESTION = [
    'Что происходит',
    '',
    'Пункт 2 итогового чеклиста (порядок TDD) по PR #354 не сходится: тесты',
    'легли одним коммитом вместе с реализацией, а не до неё.',
    '',
    'Почему мерж не происходит сам',
    '',
    'Осталось только смержить, но чеклист не пускает — пункт помечен как',
    'нарушенный, и снять его может только твоё решение.',
    '',
    'Что нужно от тебя',
    '',
    'Вопрос владельцу: списываешь пункт 2 (TDD-порядок) по PR #354?',
    '',
    'Решение одно, бинарное: списываем и мержим — или переделываем историю',
    'коммитов.',
  ].join('\n')

  it('the 2026-08-27 incident message is not terminal and passes all three gates', () => {
    // Preconditions of the incident: the heuristics genuinely fire, the short-
    // question exemption cannot apply, and there are no beat labels at all.
    expect(FREE_FORM_QUESTION.split('\n').filter((l) => l.trim()).length).toBeGreaterThan(4)
    expect(isCompletionReport(FREE_FORM_QUESTION)).toBe(true)
    expect(hasExplicitInterimMarker(FREE_FORM_QUESTION)).toBe(false)

    expect(hasOwnerQuestionMarker(FREE_FORM_QUESTION)).toBe(true)
    expect(isOwnerQuestionForm(FREE_FORM_QUESTION)).toBe(true)
    expect(isTerminalReport(FREE_FORM_QUESTION)).toBe(false)
    expect(
      decideCompletionBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: FREE_FORM_QUESTION,
      }),
    ).toEqual({ block: false })
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: FREE_FORM_QUESTION,
      }),
    ).toEqual({ block: false })
    expect(
      decideWarn({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: FREE_FORM_QUESTION,
      }),
    ).toEqual({ warn: false })
  })

  it('the singular «Вопрос владельцу:» marker is recognized with emphasis and hashes', () => {
    expect(hasOwnerQuestionMarker('Вопрос владельцу: списываем пункт 2?')).toBe(true)
    expect(hasOwnerQuestionMarker('**Вопрос владельцу:** списываем пункт 2?')).toBe(true)
    expect(hasOwnerQuestionMarker('**Вопрос владельцу**: списываем пункт 2?')).toBe(true)
    expect(hasOwnerQuestionMarker('## Вопрос владельцу: списываем пункт 2?')).toBe(true)
  })

  it('the numbered «Вопрос N из M» header is recognized with or without a tail', () => {
    // The em-dash tail is the shape the 2026-08-26 incident message itself used.
    expect(hasOwnerQuestionMarker('Вопрос 2 из 8 — доступ к записям')).toBe(true)
    expect(hasOwnerQuestionMarker('Вопрос 2 из 8 - доступ к записям')).toBe(true)
    expect(hasOwnerQuestionMarker('Вопрос 2 из 8: доступ к записям')).toBe(true)
    expect(hasOwnerQuestionMarker('Вопрос 2 из 8')).toBe(true)
    expect(hasOwnerQuestionMarker('**Вопрос 2 из 8**')).toBe(true)
    expect(hasOwnerQuestionMarker('Отчёт готов.\n### Вопрос 12 из 12')).toBe(true)
  })

  // Review of PR #393: a free-prose owner question written inside a bulleted
  // «Что нужно от тебя» section is exactly the incident genre, and a bullet or a
  // blockquote prefix defeated the marker. Both are stripped now, on the same
  // «the prefix carries no meaning here» principle as the heading hashes.
  it('a list bullet or a blockquote before the marker is tolerated', () => {
    expect(hasOwnerQuestionMarker('- Вопрос владельцу: списываем пункт 2?')).toBe(true)
    expect(hasOwnerQuestionMarker('* Вопрос владельцу: списываем пункт 2?')).toBe(true)
    expect(hasOwnerQuestionMarker('+ Вопрос владельцу: списываем пункт 2?')).toBe(true)
    expect(hasOwnerQuestionMarker('  - **Вопрос владельцу:** списываем пункт 2?')).toBe(true)
    expect(hasOwnerQuestionMarker('> Вопрос владельцу: списываем пункт 2?')).toBe(true)
    expect(hasOwnerQuestionMarker('> - Вопрос 4 из 9 — оплата')).toBe(true)
    // …and the plural still leaks through none of the new prefixes.
    for (const prefix of ['- ', '* ', '> ', '  - ']) {
      expect(hasOwnerQuestionMarker(`${prefix}Вопросы владельцу:`)).toBe(false)
      expect(hasOwnerQuestionMarker(`${prefix}**Вопросы владельцу**`)).toBe(false)
    }
  })

  // The asymmetry is deliberate and documented in
  // `.claude/skills/report-task-outcome/SKILL.md`: the colon is what the skill
  // prescribes for the singular line, and a bare «Вопрос владельцу» without it
  // is one inflection away from the plural report heading.
  it('the singular marker requires its colon', () => {
    expect(hasOwnerQuestionMarker('Вопрос владельцу — списываем пункт 2?')).toBe(false)
    expect(hasOwnerQuestionMarker('Вопрос владельцу')).toBe(false)
    expect(hasOwnerQuestionMarker('Вопрос к владельцу: списываем?')).toBe(false)
    expect(hasOwnerQuestionMarker('Вопрос-владельцу: списываем?')).toBe(false)
  })

  // THE BLOCKER OF THE PR #375 ROUND-1 REVIEW, pinned in both directions: the
  // PLURAL «Вопросы владельцу» is point 5 of the canonical stage-6 report, so
  // recognizing it would exempt the CORRECTLY formed final report from all
  // three gates. Only the singular + colon and the numbered header are markers.
  it('the PLURAL «Вопросы владельцу» heading is NOT a marker, in any form', () => {
    const heading = 'PR #92 смержен, issue #91 закрыт. 100% от заявленного объёма.'
    for (const title of ['## Вопросы владельцу', '**Вопросы владельцу**', 'Вопросы владельцу:']) {
      expect(hasOwnerQuestionMarker(title)).toBe(false)
      const report = `${title}\n${heading}`
      expect(hasOwnerQuestionMarker(report)).toBe(false)
      expect(isOwnerQuestionForm(report)).toBe(false)
      expect(isTerminalReport(report)).toBe(true)
      expect(
        decideCompletionBlock({
          stopHookActive: false,
          writeActionSeen: true,
          lastAssistantText: report,
        }),
      ).toEqual({ block: true })
    }
  })

  it('a mid-sentence «вопрос владельцу» does not exempt a report', () => {
    const report = [
      'Готово: PR #92 смержен, issue #91 закрыт.',
      'Остался один вопрос владельцу про порог dispatch-гарда, задам отдельно.',
      '100% от заявленного объёма.',
    ].join('\n')
    expect(hasOwnerQuestionMarker(report)).toBe(false)
    expect(isTerminalReport(report)).toBe(true)
  })

  it('the marker branch does not disturb the beats branch', () => {
    expect(hasOwnerQuestionMarker('Что случилось: X.\nПочему спрашиваю: Y.')).toBe(false)
    expect(isOwnerQuestionForm('Что случилось: X.\nПочему спрашиваю: Y.')).toBe(true)
    expect(hasOwnerQuestionMarker('')).toBe(false)
    expect(hasOwnerQuestionMarker(null)).toBe(false)
  })
})

/**
 * #392, mechanism 2 — the block budget. Heuristic recognition of free prose is
 * whack-a-mole (#158 → #299 → #374 → #392); the budget bounds the cost of being
 * wrong without demoting the gates to WARN outright. Each BLOCK gate blocks at
 * most ONCE per session; a further recognized violation is demoted to a warning.
 */
describe('#392: per-session block budget', () => {
  it('the first recognized violation still blocks', () => {
    expect(applyBlockBudget({ decision: { block: true }, alreadyBlocked: false })).toEqual({
      block: true,
      demoted: false,
    })
  })

  it('the second one in the same session is demoted to a warning', () => {
    expect(applyBlockBudget({ decision: { block: true }, alreadyBlocked: true })).toEqual({
      block: false,
      demoted: true,
    })
  })

  it('a non-blocking decision is never demoted and never spends the budget', () => {
    expect(applyBlockBudget({ decision: { block: false }, alreadyBlocked: false })).toEqual({
      block: false,
      demoted: false,
    })
    expect(applyBlockBudget({ decision: { block: false }, alreadyBlocked: true })).toEqual({
      block: false,
      demoted: false,
    })
  })

  it('carries the decision reason through, so the self-cert branch keeps its message', () => {
    expect(
      applyBlockBudget({ decision: { block: true, reason: 'self-cert' }, alreadyBlocked: false }),
    ).toEqual({ block: true, demoted: false, reason: 'self-cert' })
    expect(
      applyBlockBudget({ decision: { block: true, reason: 'self-cert' }, alreadyBlocked: true }),
    ).toEqual({ block: false, demoted: true, reason: 'self-cert' })
  })

  it('the demoted text is the gate message plus the budget suffix', () => {
    const demoted = budgetDemotedMessage('⛔ deviations gate (#91): …')
    expect(demoted.startsWith('⚠ ⛔ deviations gate (#91): …')).toBe(true)
    expect(demoted).toContain('#392')
    expect(demoted).toContain('1 блок/сессию')
  })

  it('the budget is per gate: a spent completion-report budget leaves deviations intact', () => {
    // The PRODUCTION predicate decides here, not a re-implementation of it in
    // the test: the state SHAPE agreed between writer and reader and the per-gate
    // KEY are the two things that can actually break the mechanism, so they are
    // what gets asserted (review of PR #393).
    const state = { blocked: { [COMPLETION_REPORT_BUDGET_KEY]: true } }
    expect(
      applyBlockBudget({
        decision: { block: true },
        alreadyBlocked: hasSpentBlockBudget(state, COMPLETION_REPORT_BUDGET_KEY),
      }),
    ).toEqual({ block: false, demoted: true })
    expect(
      applyBlockBudget({
        decision: { block: true },
        alreadyBlocked: hasSpentBlockBudget(state, DEVIATIONS_BUDGET_KEY),
      }),
    ).toEqual({ block: true, demoted: false })
  })

  // The state I/O half, exercised through the injectable `deps` seam the writer
  // was given precisely so it needs no filesystem. Writer and reader are pinned
  // together: whatever `recordBlockBudgetSpend` serializes is what
  // `hasSpentBlockBudget` must read back.
  it('round-trips a spend through the injectable writer and back through the reader', () => {
    const writes: Record<string, string> = {}
    const dirs: string[] = []
    const deps = {
      mkdir: (d: string) => {
        dirs.push(d)
      },
      writeFile: (p: string, c: string) => {
        writes[p] = c
      },
    }
    const path = '/tmp/bbm-budget/session-abc.json'

    expect(hasSpentBlockBudget({}, DEVIATIONS_BUDGET_KEY)).toBe(false)

    recordBlockBudgetSpend(path, {}, DEVIATIONS_BUDGET_KEY, deps)
    expect(dirs).toEqual(['/tmp/bbm-budget'])
    const afterFirst = JSON.parse(writes[path])
    expect(afterFirst).toEqual({ blocked: { deviations: true } })
    expect(hasSpentBlockBudget(afterFirst, DEVIATIONS_BUDGET_KEY)).toBe(true)
    expect(hasSpentBlockBudget(afterFirst, COMPLETION_REPORT_BUDGET_KEY)).toBe(false)

    // A second gate's spend merges into the same object instead of replacing it.
    recordBlockBudgetSpend(path, afterFirst, COMPLETION_REPORT_BUDGET_KEY, deps)
    const afterBoth = JSON.parse(writes[path])
    expect(afterBoth).toEqual({ blocked: { deviations: true, 'completion-report': true } })
    expect(hasSpentBlockBudget(afterBoth, DEVIATIONS_BUDGET_KEY)).toBe(true)
    expect(hasSpentBlockBudget(afterBoth, COMPLETION_REPORT_BUDGET_KEY)).toBe(true)
  })

  it('the reader is fail-open on every shape a lost or corrupt state can take', () => {
    for (const state of [undefined, null, {}, { blocked: null }, { blocked: 'nope' }]) {
      expect(hasSpentBlockBudget(state, DEVIATIONS_BUDGET_KEY)).toBe(false)
    }
  })

  it('the state path is per session, under the budget state dir', () => {
    const path = blockBudgetStatePath('/repo', 'sess/01:ABC')
    expect(path.replace(/\\/g, '/')).toContain('/.claude/stop-gate-budget-state/')
    // `stateFilePath` sanitises the id — no separator from it may reach the path.
    expect(path.replace(/\\/g, '/')).toMatch(/\/sess_01_ABC\.json$/)
    expect(blockBudgetStatePath('/repo', 'a')).not.toEqual(blockBudgetStatePath('/repo', 'b'))
  })

  it('fail-open: unusable state defaults to "not yet blocked"', () => {
    expect(applyBlockBudget({ decision: { block: true } })).toEqual({
      block: true,
      demoted: false,
    })
    expect(applyBlockBudget({ decision: { block: true }, alreadyBlocked: undefined })).toEqual({
      block: true,
      demoted: false,
    })
  })
})

describe('completion-report-gate (stage 6)', () => {
  it('блокирует отчёт без «Проверить глазами» и без честной формулы', () => {
    expect(
      decideCompletionBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: REPORT_NO_MARKERS,
      }),
    ).toEqual({ block: true })
  })

  it('пропускает отчёт с «Проверить глазами: <URL>»', () => {
    expect(
      decideCompletionBlock({
        stopHookActive: false,
        writeActionSeen: true,
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
      decideCompletionBlock({
        stopHookActive: true,
        writeActionSeen: true,
        lastAssistantText: REPORT_NO_MARKERS,
      }).block,
    ).toBe(false)
  })

  it('нет ассистентского текста — блокировать нечего (fail-open)', () => {
    expect(
      decideCompletionBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: null,
      }).block,
    ).toBe(false)
  })
})

describe('deviations-gate (stage 7)', () => {
  const withEyes = `${REPORT_NO_MARKERS}\nПроверить глазами: https://portal.bbm.academy/p/okr`

  it('блокирует отчёт без строки «Отклонения от конвенций»', () => {
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: withEyes,
      }),
    ).toEqual({
      block: true,
    })
  })

  it('пропускает и «нет», и список — гейт судит присутствие строки, не содержание', () => {
    expect(hasDeviationsLine('Отклонения от конвенций: нет')).toBe(true)
    expect(hasDeviationsLine('**Отклонения от конвенций:** порог гарда 3, а не 5')).toBe(true)
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: `${withEyes}\nОтклонения от конвенций: нет`,
      }).block,
    ).toBe(false)
  })

  it('оба гейта срабатывают на одном множестве сообщений', () => {
    const interim = '⏳ Checkpoint: PR #92 смержен в ветку, жду CI'
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
  })

  it('loop-guard общий для обоих гейтов', () => {
    expect(
      decideDeviationsBlock({
        stopHookActive: true,
        writeActionSeen: true,
        lastAssistantText: withEyes,
      }).block,
    ).toBe(false)
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

  // Ревью PR #148 (refs #149): судится ТОЛЬКО значение после маркера. Фраза
  // «значимых отклонений нет» про что-то другое в тексте выше не отменяет список.
  it('«значимых отклонений нет» вне строки stage 7 значением не считается', () => {
    expect(
      hasNoDeviationsValue(
        'В CI значимых отклонений нет.\nОтклонения от конвенций: staging вместо прямого применения.',
      ),
    ).toBe(false)
  })

  it('«нет» + стоп владельца в сессии → блок', () => {
    const d = decideDeviationsBlock({
      stopHookActive: false,
      writeActionSeen: true,
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
        writeActionSeen: true,
        lastAssistantText: noDeviations,
        haltSignal: false,
      }).block,
    ).toBe(false)
  })

  it('список отклонений после стопа проходит — loop-guard исправленного отчёта', () => {
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        writeActionSeen: true,
        lastAssistantText: listed,
        haltSignal: true,
      }).block,
    ).toBe(false)
  })

  it('отсутствие строки блокирует как раньше, независимо от сигнала стопа', () => {
    expect(
      decideDeviationsBlock({
        stopHookActive: false,
        writeActionSeen: true,
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

  it('видит обычное человеческое сообщение и «Тормози всё!»', () => {
    expect(
      detectHaltSignal(
        JSON.stringify({ type: 'user', message: { content: 'стоп, что ты делаешь' } }),
      ),
    ).toBe(true)
    expect(
      detectHaltSignal(JSON.stringify({ type: 'user', message: { content: 'Тормози всё!' } })),
    ).toBe(true)
  })

  // Ревью PR #148 (refs #149): рабочая просьба «останови стенд» — не стоп сессии.
  it('рутинная просьба про стенд сигналом не считается', () => {
    expect(
      detectHaltSignal(
        JSON.stringify({ type: 'user', message: { content: 'останови стенд на 3001' } }),
      ),
    ).toBe(false)
  })

  // Ревью PR #148: чтение исходников самого хука не должно взводить сигнал —
  // текст сообщения гейта попадает в tool_result обычным чтением файла.
  it('блок Stop-хука распознаётся только в рамке «Stop hook feedback»', () => {
    const realFeedback = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'text',
            text: 'Stop hook feedback:\n- [node deviations-gate.mjs]: ⛔ deviations gate (#91): нет строки',
          },
        ],
      },
    })
    expect(detectHaltSignal(realFeedback)).toBe(true)

    const sourceRead = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            content:
              "export function blockMessage() {\n  return '⛔ deviations gate (#91): финальное сообщение …'\n}",
          },
        ],
      },
    })
    expect(detectHaltSignal(sourceRead)).toBe(false)
  })

  it('тихая сессия и битые строки сигнала не дают', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: 'давай дальше' } }),
      '{ битая строка',
      JSON.stringify({
        type: 'assistant',
        message: { id: 'a1', content: 'останови всё немедленно' },
      }),
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

/**
 * #158 — вторая половина распознавателя: сессия, которая ничего не писала, не
 * может отчитываться о завершении. Живой инцидент 2026-08-05: владелец спросил
 * «про что issue #157», ответ-ориентировка неизбежно нёс слова «закрыт»,
 * «смержен» и номера PR — оба BLOCK-гейта сработали на чистом чтении.
 */

const toolUse = (name: string, input: Record<string, unknown> = {}, id = 'a1') =>
  JSON.stringify({
    type: 'assistant',
    message: { id, content: [{ type: 'tool_use', name, input }] },
  })

const assistantSays = (text: string, id = 'zz') =>
  JSON.stringify({ type: 'assistant', message: { id, content: [{ type: 'text', text }] } })

const bash = (command: string) => toolUse('Bash', { command })

describe('#158: write-действие в транскрипте', () => {
  it('инструменты записи', () => {
    for (const name of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      expect(hasWriteAction(toolUse(name, { file_path: 'src/a.ts' }))).toBe(true)
    }
  })

  // Лид, раздавший работу субагентам, сам не писал ни строки, но отчитывается
  // именно он — диспетчеризация обязана считаться write-действием, иначе
  // оркестрирующая сессия выпадает из-под всех трёх гейтов.
  it('диспетчеризация субагента считается: писали субагенты, отчитывается лид', () => {
    expect(hasWriteAction(toolUse('Agent', { subagent_type: 'general-purpose' }))).toBe(true)
    expect(hasWriteAction(toolUse('Task', { prompt: 'сделай' }))).toBe(true)
  })

  it('read-only инструменты не считаются', () => {
    for (const name of [
      'Read',
      'Grep',
      'Glob',
      'WebFetch',
      'WebSearch',
      'Skill',
      'AskUserQuestion',
    ]) {
      expect(hasWriteAction(toolUse(name, { file_path: 'src/a.ts', pattern: 'x' }))).toBe(false)
    }
  })

  it('мутирующие shell-команды из белого списка', () => {
    expect(hasWriteAction(bash('git -C "C:/Users/x/repo" commit -m "fix: x"'))).toBe(true)
    expect(hasWriteAction(bash('git push -u origin fix/158-x'))).toBe(true)
    expect(hasWriteAction(bash('git merge --ff-only origin/main'))).toBe(true)
    expect(hasWriteAction(bash('gh pr create --fill'))).toBe(true)
    expect(hasWriteAction(bash('gh pr merge 159 --squash'))).toBe(true)
    expect(hasWriteAction(bash('gh issue close 158 --repo o/r'))).toBe(true)
    expect(hasWriteAction(bash('gh issue comment 158 --body-file x.md'))).toBe(true)
    expect(hasWriteAction(bash('gh api --method PATCH /repos/o/r/issues/1 -f state=closed'))).toBe(
      true,
    )
    expect(hasWriteAction(bash('gh api -X POST /repos/o/r/issues/1/comments'))).toBe(true)
    expect(hasWriteAction(bash('pnpm pr:land 159'))).toBe(true)
    expect(hasWriteAction(bash('pnpm issue:create --title x'))).toBe(true)
    expect(hasWriteAction(bash('pnpm deploy:prod'))).toBe(true)
    expect(hasWriteAction(toolUse('PowerShell', { command: 'git -C C:/repo push' }))).toBe(true)
  })

  it('видит мутацию во второй команде цепочки', () => {
    expect(hasWriteAction(bash('export PATH=$X:$PATH && git -C "C:/repo" commit -m y'))).toBe(true)
    expect(hasWriteAction(bash('git -C "C:/repo" add . ; git -C "C:/repo" push'))).toBe(true)
  })

  // Белый список консервативен намеренно: пропустить мутацию дешевле, чем
  // записать чтение в записи и вернуть ровно тот ложный блок, который чинится.
  it('читающие shell-команды не считаются', () => {
    expect(hasWriteAction(bash('git -C "C:/repo" status --short'))).toBe(false)
    expect(hasWriteAction(bash('git -C "C:/repo" log --oneline -5'))).toBe(false)
    expect(hasWriteAction(bash('git -C "C:/repo" diff origin/main'))).toBe(false)
    expect(hasWriteAction(bash('gh pr view 158 --json body'))).toBe(false)
    expect(hasWriteAction(bash('gh issue list --repo o/r'))).toBe(false)
    expect(hasWriteAction(bash('gh api /repos/o/r/pulls/158'))).toBe(false)
    expect(hasWriteAction(bash('pnpm test:unit'))).toBe(false)
    expect(hasWriteAction(bash('pnpm dev:ports'))).toBe(false)
  })

  // MCP-инструменты — такой же способ мутировать состояние, как Edit и `gh`:
  // в этом окружении включены GitHub и Plane MCP. Решает хвостовой сегмент
  // имени `mcp__<сервер>__<инструмент>`, не сервер.
  it('MCP-инструменты с мутирующим хвостом имени считаются', () => {
    for (const name of [
      'mcp__plugin_github_github__issue_write',
      'mcp__plugin_github_github__sub_issue_write',
      'mcp__plugin_github_github__pull_request_review_write',
      'mcp__plugin_github_github__add_issue_comment',
      'mcp__plugin_github_github__add_reply_to_pull_request_comment',
      'mcp__plugin_github_github__merge_pull_request',
      'mcp__plugin_github_github__create_pull_request',
      'mcp__plugin_github_github__update_pull_request',
      'mcp__plugin_github_github__create_or_update_file',
      'mcp__plugin_github_github__create_branch',
      'mcp__plugin_github_github__delete_file',
      'mcp__plugin_github_github__push_files',
      'mcp__plane-pp-mcp__workspaces_add',
      'mcp__plane-pp-mcp__relations_set',
      'mcp__plane-pp-mcp__attach_file',
      'mcp__plane-pp-mcp__import',
    ]) {
      expect(hasWriteAction(toolUse(name, {}))).toBe(true)
    }
  })

  // Ревью PR #159 (BLOCKER): `plane_execute` — ДИСПЕТЧЕР. Глагол «execute» в
  // имени не говорит ничего: через него идут и `states.list`, и
  // `work-items.create`. Слово в имени ловило все обращения к Plane, включая
  // чистое чтение, — ровно тот ложный BLOCK, который чинит #158. Судится
  // операция: хвост `endpoint_id` после последней точки.
  it('диспетчер plane_execute судится по endpoint_id, не по имени', () => {
    const exec = (endpoint_id?: string) =>
      hasWriteAction(toolUse('mcp__plane-pp-mcp__plane_execute', { endpoint_id }))
    expect(exec('work-items.create')).toBe(true)
    expect(exec('work-items.partial-update')).toBe(true)
    expect(exec('issues.destroy')).toBe(true)
    expect(exec('cycles.add-work-item-to-cycle')).toBe(true)
    expect(exec('states.list')).toBe(false)
    expect(exec('users.list')).toBe(false)
    expect(exec('issues.get-workspace-work-item')).toBe(false)
    expect(exec('work-items.search-2')).toBe(false)
    // Ловушка существительного: `attach` сидит в ИМЕНИ РЕСУРСА, а операция —
    // чтение. Поэтому судится только хвост после точки.
    expect(exec('issue-attachments.list')).toBe(false)
    // Нет аргумента — улики нет, консервативно молчим.
    expect(exec(undefined)).toBe(false)
  })

  // Записанный write-off ревью PR #159: глагол `execute` убран из имён целиком,
  // поэтому `mcp__ide__executeCode` больше не считается. Пропущенная мутация
  // стоит одного несработавшего гейта — цена ложного BLOCK выше.
  it('write-off: исполнители без разбираемых аргументов не считаются', () => {
    expect(hasWriteAction(toolUse('mcp__ide__executeCode', { code: 'print(1)' }))).toBe(false)
    expect(hasWriteAction(toolUse('mcp__plane-pp-mcp__sql', { query: 'select 1' }))).toBe(false)
  })

  it('read-shaped MCP-имена не считаются', () => {
    for (const name of [
      'mcp__plugin_github_github__search_issues',
      'mcp__plugin_github_github__search_code',
      'mcp__plugin_github_github__list_issues',
      'mcp__plugin_github_github__list_commits',
      'mcp__plugin_github_github__get_file_contents',
      'mcp__plugin_github_github__issue_read',
      'mcp__plugin_github_github__pull_request_read',
      'mcp__plane-pp-mcp__workspaces_list',
      'mcp__plane-pp-mcp__recall',
      'mcp__plane-pp-mcp__stale',
      'mcp__plugin_playwright_playwright__browser_snapshot',
      // Браузер водит страницу, а не мутирует репо/трекер: `browser_close` не
      // должен ловиться словом «close» и превращать приёмку в write-сессию.
      'mcp__plugin_playwright_playwright__browser_close',
      'mcp__plugin_playwright_playwright__browser_navigate',
    ]) {
      expect(hasWriteAction(toolUse(name, {}))).toBe(false)
    }
  })

  // Ревью PR #159 (MAJOR): белый список бежал по всей строке команды, а `\n`
  // считался началом команды — тело heredoc'а или кавычки, лишь УПОМИНАЮЩИЕ
  // «git commit», делали сессию пишущей. Семантика: цитата не команда, но
  // настоящая мутация в той же строке ловиться обязана.
  it('упоминание команды в кавычках и в heredoc не считается', () => {
    expect(hasWriteAction(bash("cat > /tmp/notes.md <<'EOF'\ngit commit -m x\nEOF"))).toBe(false)
    expect(hasWriteAction(bash('echo "инструкция: git commit -m x"'))).toBe(false)
    expect(hasWriteAction(bash("echo 'см. gh pr merge 159'"))).toBe(false)
    expect(hasWriteAction(bash('gh pr view 159 --json body\n# потом gh pr merge 159'))).toBe(false)
    // Оборванный heredoc (обрезанный транскрипт) — тело всё равно не команда.
    expect(hasWriteAction(bash("cat > f <<'EOF'\ngit commit -m x"))).toBe(false)
    // Читающая команда, чей аргумент цитирует мутацию через перевод строки —
    // ровно случай из ревью PR #159.
    expect(hasWriteAction(bash('gh pr view 1 --json body -q "see:\ngit commit -m x"'))).toBe(false)
  })

  it('настоящая мутация рядом с цитатой ловится', () => {
    expect(hasWriteAction(bash('echo "git commit" && git -C "C:/repo" push'))).toBe(true)
    expect(hasWriteAction(bash('git -C "$W" commit -q -m "$(cat <<\'EOF\'\nfix: x\nEOF\n)"'))).toBe(
      true,
    )
    // Комментарий к PR — сам по себе мутация, даже если его тело цитирует команду.
    expect(
      hasWriteAction(bash('gh pr comment 159 --body "$(cat <<\'EOF\'\nсм. git commit\nEOF\n)"')),
    ).toBe(true)
    // Настоящая команда ПОСЛЕ терминатора heredoc'а: вырезается тело, не хвост.
    expect(
      hasWriteAction(
        bash("cat <<'EOF' > notes\nзаметка про gh pr merge\nEOF\ngit -C x commit -m y"),
      ),
    ).toBe(true)
  })

  it('битые строки не роняют чтение, пустой и отсутствующий транскрипт молчат', () => {
    expect(hasWriteAction(['{ битая строка', toolUse('Read')].join('\n'))).toBe(false)
    expect(hasWriteAction(['{ битая строка', toolUse('Edit', { file_path: 'a' })].join('\n'))).toBe(
      true,
    )
    expect(hasWriteAction('')).toBe(false)
    expect(hasWriteAction(null)).toBe(false)
    expect(hasWriteAction(undefined)).toBe(false)
  })
})

describe('#158: три Stop-гейта на read-only сессии', () => {
  /** Ответ-ориентировка: только чтение, а текст неизбежно отчётной формы. */
  const ORIENTATION = [
    JSON.stringify({ type: 'user', message: { content: 'про что issue #157?' } }),
    toolUse('Read', { file_path: 'docs/ci-guardrails.md' }),
    toolUse('Grep', { pattern: 'deploy' }),
    toolUse('Bash', { command: 'gh issue view 157 --repo o/r' }),
    assistantSays(
      'Issue #157 — про приёмку deploy:prod. PR #153 смержен, эпик #117 закрыт 2026-08-05.',
    ),
  ].join('\n')

  const WROTE = [toolUse('Edit', { file_path: 'src/a.ts' }), assistantSays(REPORT_NO_MARKERS)].join(
    '\n',
  )

  const DISPATCHED = [
    toolUse('Agent', { subagent_type: 'general-purpose', model: 'opus' }),
    assistantSays(REPORT_NO_MARKERS),
  ].join('\n')

  const gates = (jsonl: string) => {
    const args = {
      stopHookActive: false,
      lastAssistantText: extractLastAssistantText(jsonl),
      writeActionSeen: hasWriteAction(jsonl),
    }
    return {
      completion: decideCompletionBlock(args).block,
      deviations: decideDeviationsBlock(args).block,
      debt: decideWarn(args).warn,
    }
  }

  it('текст ориентировки по-прежнему читается как отчёт — ловушка ровно в этом', () => {
    expect(isTerminalReport(extractLastAssistantText(ORIENTATION))).toBe(true)
  })

  it('read-only сессия проходит все три гейта молча', () => {
    expect(gates(ORIENTATION)).toEqual({ completion: false, deviations: false, debt: false })
  })

  it('сессия с записью и отчётом без маркеров блокируется как раньше', () => {
    expect(gates(WROTE)).toEqual({ completion: true, deviations: true, debt: true })
  })

  it('сессия, только раздавшая субагентов, остаётся под гейтами', () => {
    expect(gates(DISPATCHED)).toEqual({ completion: true, deviations: true, debt: true })
  })

  // Мутация через MCP — единственный write в сессии: без этого сессия, закрывшая
  // issue через GitHub MCP, уходила из-под всех трёх гейтов на одном тексте.
  const MCP_WROTE = [
    toolUse('mcp__plugin_github_github__issue_write', { method: 'update', state: 'closed' }),
    assistantSays(REPORT_NO_MARKERS),
  ].join('\n')

  const MCP_READ_ONLY = [
    toolUse('mcp__plugin_github_github__search_issues', { query: 'repo:o/r is:open' }),
    assistantSays(REPORT_NO_MARKERS),
  ].join('\n')

  it('мутация через MCP гейты взводит', () => {
    expect(gates(MCP_WROTE)).toEqual({ completion: true, deviations: true, debt: true })
  })

  it('чтение через MCP гейты не взводит', () => {
    expect(gates(MCP_READ_ONLY)).toEqual({ completion: false, deviations: false, debt: false })
  })

  // Fail-open: транскрипт не прочитан → проверка НЕ ДАЛА ответа → гейты молчат.
  // Плата — настоящий отчёт при битом транскрипте проходит; это принято.
  it('нечитаемый транскрипт: проверка безрезультатна → гейты молчат', () => {
    expect(gates('')).toEqual({ completion: false, deviations: false, debt: false })
    expect(
      decideCompletionBlock({ stopHookActive: false, lastAssistantText: REPORT_NO_MARKERS }).block,
    ).toBe(false)
    expect(
      decideDeviationsBlock({ stopHookActive: false, lastAssistantText: REPORT_NO_MARKERS }).block,
    ).toBe(false)
    expect(decideWarn({ stopHookActive: false, lastAssistantText: REPORT_NO_MARKERS }).warn).toBe(
      false,
    )
  })

  it('полный распознаватель — один seam на все три гейта', () => {
    expect(
      isEnforceableTerminalReport({
        lastAssistantText: REPORT_NO_MARKERS,
        writeActionSeen: false,
      }),
    ).toBe(false)
    expect(
      isEnforceableTerminalReport({ lastAssistantText: REPORT_NO_MARKERS, writeActionSeen: true }),
    ).toBe(true)
    expect(
      isEnforceableTerminalReport({
        lastAssistantText: '⏳ Checkpoint: PR #92 смержен в ветку, жду CI',
        writeActionSeen: true,
      }),
    ).toBe(false)
  })
})
