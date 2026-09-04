'use client'

import { Refine } from '@refinedev/core'
import routerProvider from '@refinedev/nextjs-router'
import React from 'react'

import { useNotificationProvider } from '@/ui/refine-ui/notification/use-notification-provider'
import { Toaster } from '@/ui/sonner'

import { createRequestBoardDataProvider } from './request-board-provider'
import { RequestsBoardScreen } from './RequestsBoardScreen'

/**
 * The Refine context the requests board runs in.
 *
 * WHY ITS OWN AND NOT `CabinetShell`. That shell is the `/p/admin` cabinet: it
 * derives a resource TREE from the workspace registry, renders the cabinet's
 * sidebar and breadcrumb, and speaks the module API contract. `/p/finance` is a
 * workspace app, not a cabinet section — it has its own layout and its own API
 * — so what it borrows from the cabinet is the two things that must be the same
 * everywhere: the query plumbing, and ONE feedback channel (#434). Both arrive
 * here through the same kit pieces the cabinet uses.
 *
 * `Toaster` sits outside the screen's own subtree and carries `data-bbm-ui` of
 * its own — sonner renders in place instead of portalling, and inside a grid it
 * takes a cell (the defect the #434 acceptance stand showed).
 */
export function RequestsShell() {
  const dataProvider = React.useMemo(() => createRequestBoardDataProvider(), [])
  const notificationProvider = useNotificationProvider()

  return (
    <>
      <Refine
        dataProvider={dataProvider}
        notificationProvider={notificationProvider}
        routerProvider={routerProvider}
        options={{ disableTelemetry: true, warnWhenUnsavedChanges: true }}
      >
        <RequestsBoardScreen />
      </Refine>
      <div data-bbm-ui>
        <Toaster position="bottom-right" richColors closeButton />
      </div>
    </>
  )
}
