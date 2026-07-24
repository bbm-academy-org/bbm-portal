import type { Metadata } from 'next'
import { Golos_Text, IBM_Plex_Mono, Unbounded } from 'next/font/google'
import React from 'react'
import './okr.css'

const unbounded = Unbounded({
  subsets: ['latin', 'cyrillic'],
  weight: ['500', '700', '800', '900'],
  variable: '--font-unbounded',
})
const golos = Golos_Text({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-golos',
})
const plexMono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['500'],
  variable: '--font-plex-mono',
})

export const metadata: Metadata = {
  title: 'OKR-дашборд · Doctor.School',
  description: 'Живое дерево OKR из Plane — цель «Academy Doctor.School»',
  // Internal team surface — never indexed (auth gate lands in #59).
  robots: { index: false, follow: false },
}

export default function OkrLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`okr-root ${unbounded.variable} ${golos.variable} ${plexMono.variable}`}>
      {children}
    </div>
  )
}
