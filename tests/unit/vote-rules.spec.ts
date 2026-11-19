import { describe, expect, it } from 'vitest'

import {
  CONSENT_ANSWER_LABELS,
  RATING_MAX_CHOICES,
  ensureVotable,
  parseOptions,
  tallyConsent,
  tallyRating,
  topTwoLeaders,
  transitionPoll,
  validateConsentBallot,
  validatePollDraft,
  validateRatingBallot,
} from '@/lib/vote/rules'
import type { BallotView } from '@/lib/vote/rules'

/**
 * The pure rules of the vote module (#575): ballot validation, the poll state
 * machine, the tally and the top-two leaders of a rating round. Everything the
 * server enforces is decided here, so the server actions stay thin.
 */

function rating(voterName: string, choices: number[]): BallotView {
  return {
    voterEmail: `${voterName}@bbm.academy`,
    voterName,
    choices,
    consentAnswer: null,
    comment: null,
  }
}

function consent(
  voterName: string,
  answer: BallotView['consentAnswer'],
  comment: string | null = null,
): BallotView {
  return {
    voterEmail: `${voterName}@bbm.academy`,
    voterName,
    choices: [],
    consentAnswer: answer,
    comment,
  }
}

describe('parseOptions', () => {
  it('splits by line, trims and drops blank lines', () => {
    expect(parseOptions('  Первый \n\n Второй\r\n   \nТретий')).toEqual([
      'Первый',
      'Второй',
      'Третий',
    ])
  })
})

describe('validatePollDraft', () => {
  it('accepts a rating poll with at least two options', () => {
    const result = validatePollDraft({ title: ' Цель ', kind: 'rating', options: 'А\nБ' })
    expect(result).toEqual({
      ok: true,
      value: { title: 'Цель', kind: 'rating', options: ['А', 'Б'] },
    })
  })

  it('refuses a rating poll with fewer than two options', () => {
    const result = validatePollDraft({ title: 'Цель', kind: 'rating', options: 'А\n\n' })
    expect(result.ok).toBe(false)
  })

  it('refuses a blank title and an unknown kind', () => {
    expect(validatePollDraft({ title: '   ', kind: 'rating', options: 'А\nБ' }).ok).toBe(false)
    expect(validatePollDraft({ title: 'Цель', kind: 'values', options: 'А\nБ' }).ok).toBe(false)
  })

  it('refuses duplicate rating options', () => {
    expect(validatePollDraft({ title: 'Цель', kind: 'rating', options: 'А\nА' }).ok).toBe(false)
  })

  it('stores no options for a consent poll', () => {
    const result = validatePollDraft({ title: 'Согласие: А', kind: 'consent', options: 'ignored' })
    expect(result).toEqual({
      ok: true,
      value: { title: 'Согласие: А', kind: 'consent', options: [] },
    })
  })
})

describe('validateRatingBallot', () => {
  it('caps the choices at two', () => {
    expect(RATING_MAX_CHOICES).toBe(2)
  })

  it('accepts one or two distinct valid indices, sorted', () => {
    expect(validateRatingBallot([2], 4)).toEqual({ ok: true, value: [2] })
    expect(validateRatingBallot([3, 0], 4)).toEqual({ ok: true, value: [0, 3] })
  })

  it('refuses a third choice', () => {
    expect(validateRatingBallot([0, 1, 2], 4).ok).toBe(false)
  })

  it('refuses no choice, duplicates, out-of-range and non-integer indices', () => {
    expect(validateRatingBallot([], 4).ok).toBe(false)
    expect(validateRatingBallot([1, 1], 4).ok).toBe(false)
    expect(validateRatingBallot([4], 4).ok).toBe(false)
    expect(validateRatingBallot([-1], 4).ok).toBe(false)
    expect(validateRatingBallot([1.5], 4).ok).toBe(false)
    expect(validateRatingBallot('0', 4).ok).toBe(false)
  })
})

describe('validateConsentBallot', () => {
  it('requires an answer from the closed set', () => {
    expect(validateConsentBallot(undefined, '').ok).toBe(false)
    expect(validateConsentBallot('maybe', '').ok).toBe(false)
  })

  it('accepts a plain «Принимаю» without a comment', () => {
    expect(validateConsentBallot('accept', '  ')).toEqual({
      ok: true,
      value: { answer: 'accept', comment: null },
    })
  })

  it('requires a non-blank comment for a wish and for an objection', () => {
    expect(validateConsentBallot('accept_with_wish', '').ok).toBe(false)
    expect(validateConsentBallot('object', '   ').ok).toBe(false)
    expect(validateConsentBallot('object', undefined).ok).toBe(false)
    expect(validateConsentBallot('object', ' Не про нас ')).toEqual({
      ok: true,
      value: { answer: 'object', comment: 'Не про нас' },
    })
  })

  it('labels the three answers in Russian', () => {
    expect(CONSENT_ANSWER_LABELS).toEqual({
      accept: 'Принимаю',
      accept_with_wish: 'Принимаю, есть пожелание',
      object: 'Возражаю по существу',
    })
  })
})

describe('ensureVotable', () => {
  it('admits a ballot only while the poll is open', () => {
    expect(ensureVotable('open').ok).toBe(true)
    expect(ensureVotable('draft').ok).toBe(false)
    expect(ensureVotable('closed').ok).toBe(false)
  })
})

describe('transitionPoll', () => {
  it('moves draft → open → closed only', () => {
    expect(transitionPoll('draft', 'open')).toEqual({ ok: true, value: 'open' })
    expect(transitionPoll('open', 'closed')).toEqual({ ok: true, value: 'closed' })
    expect(transitionPoll('draft', 'closed').ok).toBe(false)
    expect(transitionPoll('closed', 'open').ok).toBe(false)
    expect(transitionPoll('open', 'draft').ok).toBe(false)
    expect(transitionPoll('open', 'open').ok).toBe(false)
  })
})

describe('tallyRating', () => {
  it('counts per option and lists who chose it', () => {
    const tally = tallyRating(
      ['А', 'Б', 'В'],
      [rating('Юлия', [0, 1]), rating('Антон', [1]), rating('Эдуард', [1, 2])],
    )
    expect(tally.total).toBe(3)
    expect(tally.options).toEqual([
      { index: 0, text: 'А', count: 1, voters: ['Юлия'] },
      { index: 1, text: 'Б', count: 3, voters: ['Юлия', 'Антон', 'Эдуард'] },
      { index: 2, text: 'В', count: 1, voters: ['Эдуард'] },
    ])
  })
})

describe('tallyConsent', () => {
  it('counts per answer and keeps every comment with its author', () => {
    const tally = tallyConsent([
      consent('Юлия', 'accept'),
      consent('Антон', 'accept_with_wish', 'Короче'),
      consent('Эдуард', 'object', 'Не про нас'),
      consent('Мария', 'accept'),
    ])
    expect(tally.total).toBe(4)
    expect(tally.answers.map((a) => [a.answer, a.count, a.voters])).toEqual([
      ['accept', 2, ['Юлия', 'Мария']],
      ['accept_with_wish', 1, ['Антон']],
      ['object', 1, ['Эдуард']],
    ])
    expect(tally.comments).toEqual([
      { answer: 'accept_with_wish', voter: 'Антон', comment: 'Короче' },
      { answer: 'object', voter: 'Эдуард', comment: 'Не про нас' },
    ])
  })
})

describe('topTwoLeaders', () => {
  const options = ['А', 'Б', 'В', 'Г']

  it('returns the two leaders when the second place is clear', () => {
    const tally = tallyRating(options, [
      rating('1', [0, 1]),
      rating('2', [0, 1]),
      rating('3', [0, 2]),
    ])
    const result = topTwoLeaders(tally)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.leaders.map((l) => l.text)).toEqual(['А', 'Б'])
  })

  it('treats a tie between first and second as decided — both are finalists', () => {
    const tally = tallyRating(options, [rating('1', [0, 1]), rating('2', [0, 1]), rating('3', [2])])
    const result = topTwoLeaders(tally)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.leaders.map((l) => l.text)).toEqual(['А', 'Б'])
  })

  it('reports a tie when the second place is shared with the third', () => {
    const tally = tallyRating(options, [rating('1', [0, 1]), rating('2', [0, 2])])
    expect(topTwoLeaders(tally).status).toBe('tie')
  })

  it('reports a tie when three options share the first place', () => {
    const tally = tallyRating(options, [rating('1', [0]), rating('2', [1]), rating('3', [2])])
    expect(topTwoLeaders(tally).status).toBe('tie')
  })

  it('reports no leaders when nobody voted', () => {
    expect(topTwoLeaders(tallyRating(options, [])).status).toBe('empty')
  })
})
