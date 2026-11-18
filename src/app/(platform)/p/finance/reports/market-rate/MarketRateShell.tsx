'use client'

import { Refine, type DataProvider, type HttpError } from '@refinedev/core'
import routerProvider from '@refinedev/nextjs-router'
import React from 'react'

import { MarketRateReport, type MarketRateReportProps } from './MarketRateReport'

/**
 * The Refine context the report's List blocks run in — the same reason the
 * requests board has its own (`../../requests/RequestsShell.tsx`): `/p/finance`
 * is a workspace app, not a cabinet section.
 *
 * The report is computed on the server and handed down whole, so the blocks
 * never read through Refine: every verb of this provider refuses, and the
 * tables run with their own query switched off.
 */
async function readOnly(): Promise<never> {
  const error: HttpError = {
    statusCode: 405,
    message: 'Отчёт «Курс против рынка» только читается: его строки считает сервер.',
  }
  throw error
}

const reportDataProvider: DataProvider = {
  getApiUrl: () => '/p/finance/reports/market-rate',
  getList: readOnly,
  getOne: readOnly,
  create: readOnly,
  update: readOnly,
  deleteOne: readOnly,
}

export function MarketRateShell(props: MarketRateReportProps) {
  return (
    <Refine
      dataProvider={reportDataProvider}
      routerProvider={routerProvider}
      options={{ disableTelemetry: true }}
    >
      <MarketRateReport {...props} />
    </Refine>
  )
}
