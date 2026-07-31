'use client'

import React, { useActionState, useState } from 'react'

import { formatSavedAt, plural } from '@/lib/hours/format'
import type { PublicationPreview } from '@/lib/hours/publication'
import type { Publication } from '@/lib/hours/types'
import { publishHoursToMattermostAction } from '@/modules/hours/actions'
import { IDLE_STATE } from '@/modules/hours/actionState'

function assessmentCount(count: number): string {
  return `${count} ${plural(
    count,
    'сохранённая оценка',
    'сохранённые оценки',
    'сохранённых оценок',
  )}`
}

function postCount(count: number): string {
  return `${count} ${plural(count, 'пост', 'поста', 'постов')}`
}

function PublicationStatus({ publication }: { publication: Publication }): React.ReactElement {
  const sent = publication.messages.filter((message) => message.delivery === 'sent').length
  const total = publication.messages.length
  if (publication.status === 'published') {
    return (
      <p className="hours-notice hours-verification__status" aria-live="polite">
        Опубликовано {formatSavedAt(publication.published_at)} · {postCount(total)}.
      </p>
    )
  }
  if (publication.status === 'sending') {
    return (
      <p
        className="hours-notice hours-notice--error hours-verification__status"
        aria-live="assertive"
      >
        Публикация не завершена. Отправлено {sent} из {total}. Автоматический повтор заблокирован —
        нужна ручная сверка Mattermost.
      </p>
    )
  }

  const unknown = publication.messages.some((message) => message.delivery === 'unknown')
  return (
    <p
      className="hours-notice hours-notice--error hours-verification__status"
      aria-live="assertive"
    >
      Отправлено {sent} из {total}.{' '}
      {unknown ? 'Результат доставки неизвестен.' : 'Mattermost не подтвердил следующее сообщение.'}{' '}
      Автоматический повтор заблокирован.
    </p>
  )
}

export function MattermostVerificationPanel({
  preview,
  publication,
}: {
  preview: PublicationPreview
  publication: Publication | null
}) {
  const [expanded, setExpanded] = useState(publication?.status === 'sending')
  const [state, formAction, pending] = useActionState(publishHoursToMattermostAction, IDLE_STATE)
  const messages = publication?.messages ?? preview.messages
  const previewId = `hours-mattermost-preview-${preview.period_id}`
  const panelState = publication?.status ?? preview.eligibility.status

  return (
    <section
      className="hours-verification"
      data-state={panelState}
      data-verification-period={preview.period_id}
      aria-labelledby={`hours-verification-title-${preview.period_id}`}
    >
      <div className="hours-verification__head">
        <div>
          <h3 id={`hours-verification-title-${preview.period_id}`}>Верификация в Mattermost</h3>
          <p className="hours-note">{assessmentCount(messages.length)}</p>
        </div>
        <button
          type="button"
          className="hours-btn hours-btn--ghost"
          aria-expanded={expanded}
          aria-controls={previewId}
          disabled={messages.length === 0}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Скрыть предпросмотр сообщений' : 'Предпросмотр сообщений'}
        </button>
      </div>

      {publication ? <PublicationStatus publication={publication} /> : null}
      {!publication && preview.eligibility.reason ? (
        <p
          className={
            preview.eligibility.status === 'empty'
              ? 'hours-notice hours-verification__status'
              : 'hours-notice hours-notice--warn hours-verification__status'
          }
        >
          {preview.eligibility.reason}
        </p>
      ) : null}

      {expanded ? (
        <div id={previewId} className="hours-verification__preview">
          <div className="hours-verification__messages">
            {messages.map((message) => (
              <article className="hours-verification__message" key={message.email}>
                <pre data-mattermost-message>{message.text}</pre>
              </article>
            ))}
          </div>

          {!publication && messages.length > 0 ? (
            <form action={formAction} className="hours-actions">
              <input type="hidden" name="periodId" value={preview.period_id} />
              <input type="hidden" name="previewFingerprint" value={preview.preview_fingerprint} />
              <button
                type="submit"
                className="hours-btn"
                disabled={!preview.eligibility.can_publish || pending}
                aria-busy={pending}
              >
                {pending
                  ? 'Отправляю…'
                  : `Отправить ${messages.length} ${plural(
                      messages.length,
                      'сообщение',
                      'сообщения',
                      'сообщений',
                    )} в „BBM Финансы“`}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {state.status !== 'idle' && state.message ? (
        <p
          className={state.status === 'error' ? 'hours-notice hours-notice--error' : 'hours-notice'}
          aria-live={state.status === 'error' ? 'assertive' : 'polite'}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  )
}
