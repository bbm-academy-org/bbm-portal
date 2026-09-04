'use client'

import React from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'

import type { RequestBoardReferences, RequestsSnapshot } from './request-board-contract'
import { currencyPrecision, formatRequestMoney } from './request-board-model'

/**
 * «Обязательства» (EARS-527) — what BBM currently owes its members.
 *
 * IT IS A VIEW BESIDE THE BOARD, NOT A FIFTH COLUMN, and the wireframe says why
 * in one line: this is a state of the accounts, not a stage of a request. A
 * member is owed money because of requests that are already `posted` — putting
 * the debt on the board would mix a balance into a queue.
 *
 * A table rather than cards: the reader compares numbers down a column here,
 * which is the one thing a card grid is bad at.
 */
export function LiabilityPanel({
  liabilities,
  references,
}: {
  liabilities: RequestsSnapshot['liabilities']
  references: RequestBoardReferences
}) {
  return (
    <section aria-label="Обязательства" className="space-y-3">
      <div>
        <h2 className="font-heading text-lg font-semibold tracking-tight">Кому BBM должен</h2>
        <p className="text-sm text-muted-foreground">
          Непогашенные траты участников со своих средств, по валютам.
        </p>
      </div>
      {liabilities.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Долгов перед участниками нет: все траты со своих средств уже возмещены.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Участник</TableHead>
              <TableHead className="text-right">Долг</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {liabilities.map((liability) => (
              <TableRow key={`${liability.memberId}-${liability.currency}`}>
                <TableCell className="font-medium">{liability.memberName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRequestMoney(
                    liability.balance,
                    liability.currency,
                    currencyPrecision(references.currencies, liability.currency),
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
