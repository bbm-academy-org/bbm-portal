import React from 'react'

import { BodyFontVars } from './BodyFontVars'
import { PM_FONT_VARS } from './fonts'

import './path-map.css'

/**
 * The «Карта пути» surface root (#530): the self-hosted faces of `./fonts.ts`
 * and the `.pm-root` element that guards the element-level rules of
 * `./path-map.css`; the rest of that file stays on this page by its `pm-` class
 * prefix. Same pattern as `OkrLayout.tsx` (#219). The same font classes go on
 * `<body>` for the editor's portaled overlays (`BodyFontVars.tsx`).
 */
export function PathMapLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`pm-root ${PM_FONT_VARS}`}>
      <BodyFontVars className={PM_FONT_VARS} />
      {children}
    </div>
  )
}
