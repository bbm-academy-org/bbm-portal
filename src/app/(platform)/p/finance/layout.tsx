import type { ReactNode } from 'react'

/** Opt the complete finance route subtree into the workspace kit and its accepted canvas. */
export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <main data-bbm-ui className="min-h-[calc(100vh-3.25rem)] bg-background">
      <div className="mx-auto w-full max-w-[1160px] px-4 py-10 sm:px-6">{children}</div>
    </main>
  )
}
