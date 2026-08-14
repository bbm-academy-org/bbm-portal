import localFont from 'next/font/local'
import React from 'react'
import './okr.css'

/**
 * Fonts are self-hosted from `./fonts/` via `next/font/local` — deliberately
 * NOT the Google loader these three faces used to come from (#219). That loader
 * resolves the faces over the network *at build time*: on a cold hosted CI
 * runner a transient `fonts.googleapis.com` failure turns the required `ci`
 * check red with a message that names neither Google nor the network
 * (`Module not found: Can't resolve '@vercel/turbopack-next/internal/font/…'`).
 * Vendoring the binaries makes `next build` reproducible and network-free; the
 * bytes were already self-hosted at *runtime*, so only the build input moved.
 *
 * Provenance, licence (all three OFL) and the TTF→WOFF2 conversion recipe:
 * `./fonts/README.md`.
 *
 * Parity with the previous call is deliberate and exact: same three families,
 * same CSS variable names, same `display: 'swap'` (the loader default both
 * before and after), same weight span per family. The old loader emitted one
 * static face per declared weight; the vendored variable fonts cover those
 * weights as a `wght` range, which resolves to the same instances. IBM Plex
 * Mono has no variable release, so it stays the single static Medium (500) face
 * the old call declared — a `font-weight: 700` on the mono stack (okr.css) is
 * synthesized by the browser exactly as it was before.
 */
const unbounded = localFont({
  src: './fonts/Unbounded-Variable.woff2',
  weight: '500 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-unbounded',
})
const golos = localFont({
  src: './fonts/GolosText-Variable.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  variable: '--font-golos',
})
const plexMono = localFont({
  src: './fonts/IBMPlexMono-Medium.woff2',
  weight: '500',
  style: 'normal',
  display: 'swap',
  variable: '--font-plex-mono',
})

export function OkrLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`okr-root ${unbounded.variable} ${golos.variable} ${plexMono.variable}`}>
      {children}
    </div>
  )
}
