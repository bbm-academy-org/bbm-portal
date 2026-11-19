import Link from 'next/link'
import React from 'react'

import { auth } from '@/auth'
import { adminOverview, POLL_KIND_LABELS, POLL_STATUS_LABELS } from '@/lib/vote'
import { PollActionButton } from '@/modules/vote/view/PollActionButton'
import { PollCreateForm } from '@/modules/vote/view/PollCreateForm'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/ui/card'

/**
 * `/p/admin/vote/polls` — the facilitator's screen (#575): every poll with its
 * status, the open / close acts, «Проголосовали: N» while a poll is open, the
 * way to the results, and the draft form. The cabinet layout gates the shell;
 * `adminOverview` and every action re-check `platform-admin` themselves.
 * No live updates — «Обновить» re-reads the page.
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Голосование · Админка BBM',
}

export default async function VotePollsPage() {
  const overview = await adminOverview(await auth())

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
            Голосования
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Черновик → открыто → закрыто. Участники голосуют на странице «Голосование» под своим
            логином; результаты с именами — после закрытия.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/p/admin/vote/polls">Обновить</Link>
        </Button>
      </div>

      {!overview.ok ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{overview.error}</AlertDescription>
        </Alert>
      ) : overview.value.length === 0 ? (
        <p className="text-muted-foreground">Голосований пока нет — создайте первое ниже.</p>
      ) : (
        <div className="space-y-4">
          {overview.value.map((poll) => (
            <Card key={poll.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{POLL_KIND_LABELS[poll.kind]}</Badge>
                  <Badge variant={poll.status === 'open' ? 'default' : 'outline'}>
                    {POLL_STATUS_LABELS[poll.status]}
                  </Badge>
                </div>
                <CardTitle className="text-lg leading-snug">{poll.title}</CardTitle>
                <CardAction className="flex flex-wrap gap-2">
                  {poll.status === 'draft' ? (
                    <PollActionButton act="open" pollId={poll.id} />
                  ) : null}
                  {poll.status === 'open' ? (
                    <PollActionButton act="close" pollId={poll.id} />
                  ) : null}
                  {poll.status === 'closed' ? (
                    <Button asChild variant="outline">
                      <Link href={`/p/admin/vote/polls/show/${poll.id}`}>Результаты</Link>
                    </Button>
                  ) : null}
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3">
                {poll.kind === 'rating' ? (
                  <ol className="list-decimal space-y-1 pl-5 text-sm">
                    {poll.options.map((option) => (
                      <li key={option}>{option}</li>
                    ))}
                  </ol>
                ) : null}
                {poll.status !== 'draft' ? (
                  <p className="text-base font-medium">Проголосовали: {poll.ballotCount}</p>
                ) : null}
                {poll.status === 'closed' && poll.kind === 'rating' ? (
                  <PollActionButton act="consent" pollId={poll.id} variant="secondary" />
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <section aria-labelledby="vote-create-heading" className="space-y-4">
        <h2 id="vote-create-heading" className="font-heading text-lg font-semibold">
          Новое голосование
        </h2>
        <PollCreateForm />
      </section>
    </div>
  )
}
