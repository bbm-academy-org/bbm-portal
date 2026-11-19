import Link from 'next/link'
import React from 'react'

import { auth } from '@/auth'
import { CONSENT_ANSWER_LABELS, POLL_KIND_LABELS, pollResults } from '@/lib/vote'
import type { ConsentTally, LeadersResult, RatingTally } from '@/lib/vote'
import { PollActionButton } from '@/modules/vote/view/PollActionButton'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card'

/**
 * `/p/admin/vote/polls/show/[id]` — one poll's results, sized for a Zoom
 * screen-share (#575): large counts, who voted for what, consent comments with
 * their authors. Shown only once the poll is closed — while it is open the
 * room sees only how many have voted.
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Результаты голосования · Админка BBM',
}

function RatingResults({ tally, leaders }: { tally: RatingTally; leaders: LeadersResult | null }) {
  const ranked = [...tally.options].sort((a, b) => b.count - a.count || a.index - b.index)
  const finalists =
    leaders?.status === 'ok' ? new Set(leaders.leaders.map((l) => l.index)) : new Set<number>()
  return (
    <div className="space-y-4">
      {leaders && leaders.status !== 'ok' ? (
        <Alert>
          <AlertTitle>{leaders.message}</AlertTitle>
        </Alert>
      ) : null}
      {ranked.map((option) => (
        <Card key={option.index} className={finalists.has(option.index) ? 'border-primary' : ''}>
          <CardContent className="flex items-start gap-6">
            <span className="w-16 shrink-0 text-right text-5xl font-semibold tabular-nums">
              {option.count}
            </span>
            <div className="space-y-2">
              <p className="text-2xl leading-snug font-medium">
                {option.text}
                {finalists.has(option.index) ? (
                  <Badge className="ml-3 align-middle">финалист</Badge>
                ) : null}
              </p>
              <p className="text-lg text-muted-foreground">
                {option.voters.length > 0 ? option.voters.join(', ') : 'никто'}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ConsentResults({ tally }: { tally: ConsentTally }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {tally.answers.map((row) => (
          <Card key={row.answer}>
            <CardHeader>
              <CardTitle className="text-xl">{row.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-5xl font-semibold tabular-nums">{row.count}</p>
              <p className="text-lg text-muted-foreground">
                {row.voters.length > 0 ? row.voters.join(', ') : 'никто'}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {tally.comments.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold">Комментарии</h2>
          {tally.comments.map((c, i) => (
            <Card key={`${i}:${c.voter}`}>
              <CardContent className="space-y-1">
                <p className="text-base text-muted-foreground">
                  {c.voter} · {CONSENT_ANSWER_LABELS[c.answer]}
                </p>
                <p className="text-2xl leading-snug">{c.comment}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}
    </div>
  )
}

export default async function VotePollResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await pollResults(await auth(), id)

  return (
    <div className="space-y-6">
      <Button asChild variant="outline">
        <Link href="/p/admin/vote/polls">← Все голосования</Link>
      </Button>

      {!result.ok ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="space-y-2">
            <Badge variant="secondary">{POLL_KIND_LABELS[result.value.poll.kind]}</Badge>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
              {result.value.poll.title}
            </h1>
            <p className="text-xl">Проголосовали: {result.value.tally.total}</p>
          </div>
          {result.value.poll.status !== 'closed' ? (
            <Alert>
              <AlertDescription>Результаты появятся после закрытия голосования.</AlertDescription>
            </Alert>
          ) : result.value.tally.kind === 'rating' ? (
            <>
              <RatingResults tally={result.value.tally} leaders={result.value.leaders} />
              <PollActionButton act="consent" pollId={result.value.poll.id} />
            </>
          ) : (
            <ConsentResults tally={result.value.tally} />
          )}
        </>
      )}
    </div>
  )
}
