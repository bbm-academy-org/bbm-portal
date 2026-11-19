import React from 'react'

import { auth } from '@/auth'
import { memberOverview, POLL_KIND_LABELS } from '@/lib/vote'
import { BallotForm } from '@/modules/vote/view/BallotForm'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card'

/**
 * `/p/vote` — «Голосование» for every signed-in member (#575). The `(platform)`
 * gate already admitted the session; this page lists the OPEN polls with the
 * member's current answer, and the ballot is judged by the server action.
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Голосование · BBM',
}

export default async function VotePage() {
  const overview = await memberOverview(await auth())

  return (
    <main data-bbm-ui className="min-h-[calc(100vh-3.25rem)] bg-background">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Голосование</h1>

        {!overview.ok ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{overview.error}</AlertDescription>
          </Alert>
        ) : overview.value.length === 0 ? (
          <p className="text-muted-foreground">Сейчас нет открытых голосований.</p>
        ) : (
          overview.value.map(({ poll, myBallot }) => (
            <Card key={poll.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{POLL_KIND_LABELS[poll.kind]}</Badge>
                </div>
                <CardTitle className="text-xl leading-snug">{poll.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <BallotForm poll={poll} myBallot={myBallot} />
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </main>
  )
}
