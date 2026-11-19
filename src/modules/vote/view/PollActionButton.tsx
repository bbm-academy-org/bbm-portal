'use client'

import { useNotification } from '@refinedev/core'
import React, { useTransition } from 'react'

import {
  closePollAction,
  createConsentFromLeadersAction,
  openPollAction,
} from '@/modules/vote/actions'
import { Button } from '@/ui/button'

/**
 * A cabinet act on one poll (#575): open, close, or create the two consent
 * drafts. The action re-checks `platform-admin` and the state machine on the
 * server; the outcome is a Refine notification (the cabinet's one feedback
 * channel), and a success revalidates the page.
 */

const ACTS = {
  open: { action: openPollAction, label: 'Открыть', done: 'Голосование открыто' },
  close: { action: closePollAction, label: 'Закрыть', done: 'Голосование закрыто' },
  consent: {
    action: createConsentFromLeadersAction,
    label: 'Создать согласие по двум лидерам',
    done: 'Созданы два черновика согласия',
  },
} as const

export function PollActionButton({
  act,
  pollId,
  variant = 'default',
}: {
  act: keyof typeof ACTS
  pollId: number
  variant?: 'default' | 'outline' | 'secondary'
}) {
  const [pending, startTransition] = useTransition()
  const { open } = useNotification()
  const { action, label, done } = ACTS[act]

  return (
    <Button
      type="button"
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await action(pollId)
          open?.(
            result.ok
              ? { type: 'success', message: done }
              : { type: 'error', message: result.error },
          )
        })
      }
    >
      {pending ? '…' : label}
    </Button>
  )
}
