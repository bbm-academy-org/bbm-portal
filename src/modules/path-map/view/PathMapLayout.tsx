import localFont from 'next/font/local'
import React from 'react'

import './path-map.css'

/**
 * The «Карта пути» surface root (#530): self-hosted faces from `./fonts/`
 * (provenance and licences: `./fonts/README.md`) and the `.pm-root` element
 * that guards the element-level rules of `./path-map.css`; the rest of that
 * file stays on this page by its `pm-` class prefix. Same pattern as `OkrLayout.tsx`
 * (#219): `next/font/local`, never the network-bound Google loader.
 */
const cormorant = localFont({
  src: './fonts/CormorantGaramond-Variable.woff2',
  weight: '300 700',
  style: 'normal',
  display: 'swap',
  variable: '--font-cormorant',
})
const manrope = localFont({
  src: './fonts/Manrope-Variable.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-manrope',
})

export function PathMapLayout({ children }: { children: React.ReactNode }) {
  return <div className={`pm-root ${cormorant.variable} ${manrope.variable}`}>{children}</div>
}
