'use client'

import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react'
import * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * DIVERGENCE FROM UPSTREAM, deliberate (#434, review of PR #452).
 *
 * The shadcn source reads `useTheme()` from `next-themes`. This repo runs no
 * `ThemeProvider` and deliberately does not want one — it is the same reason
 * `refine-ui/notification/toaster.tsx` was not vendored (`src/ui/README.md`).
 * Unprovided, that hook answers `'system'`, sonner then asks the OS, and a
 * light toast lands on a dark screen: `docs/evidence/434/06-save-toast-desktop-dark.png`.
 *
 * This repo's dark theme is the `.dark` class of `src/ui/theme.css` (the
 * `@custom-variant dark (&:is(.dark *))` there), carried by the root element.
 * So that is what the Toaster reads — the app's own mechanism, not a second
 * one. `next-themes` is dropped from the dependencies with this change.
 *
 * `useSyncExternalStore` rather than a state-plus-effect: the read stays live
 * (a class that goes on after mount re-themes the toast — the clause a future
 * theme switch will rely on) and it has a server snapshot, so the component
 * renders `light` on the server instead of reaching for `document`.
 */
const THEME_CARRIER_CLASS = 'dark'

function subscribeToRootClass(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const readRootTheme = (): 'light' | 'dark' =>
  document.documentElement.classList.contains(THEME_CARRIER_CLASS) ? 'dark' : 'light'

/** The server has no DOM to read, and the theme is not part of the payload. */
const serverTheme = (): 'light' | 'dark' => 'light'

function useWorkspaceTheme(): 'light' | 'dark' {
  return React.useSyncExternalStore(subscribeToRootClass, readRootTheme, serverTheme)
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useWorkspaceTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
