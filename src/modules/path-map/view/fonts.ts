import localFont from 'next/font/local'

/**
 * The «Карта пути» faces (#530): self-hosted from `./fonts/` (provenance and
 * licences: `./fonts/README.md`), `next/font/local`, never the network-bound
 * Google loader. Server-side only (`PathMapLayout.tsx`): the classes are put on
 * `.pm-root` AND on `<body>` (`BodyFontVars.tsx`), so the editor's portaled kit
 * overlays (#541 v2 — a Sheet, dialogs and menus render into `document.body`,
 * outside `.pm-root`) resolve the same font variables.
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

/** The classes that define `--font-cormorant` / `--font-manrope` on an element. */
export const PM_FONT_VARS = `${cormorant.variable} ${manrope.variable}`
