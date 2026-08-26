/**
 * `src/ui` — the BBM workspace UI kit (#312; consolidation spec §10).
 *
 * THE ONLY PUBLIC DOOR. Every consumer imports from `@/ui`; nothing reaches
 * past this barrel into a component file, exactly as a module is reached
 * through its own `index.ts`.
 *
 * The kit imports NOTHING from `src/` other than itself, and that is machine-
 * enforced (spec 311 EARS-458, rule `ui-kit-must-not-import-src` in
 * `.dependency-cruiser.cjs`, `pnpm boundaries`). It therefore holds no data
 * fetching, no auth gating, no registry and no routing — only presentation.
 *
 * See `src/ui/README.md` for what each component came from and what is
 * deliberately not here yet.
 */

// The token layer every component stylesheet resolves its `var(--bbm-…)`
// against. Imported HERE, by the barrel, so a consumer cannot get the kit's
// components without its palette — the failure mode otherwise is silent
// (an unresolved custom property simply drops the declaration).
import './tokens.css'

export { AppTile } from './AppTile'
export type { AppTileProps, AppTileVariant } from './AppTile'

export { Button } from './Button'
export type { ButtonProps, ButtonVariant } from './Button'

export { Container } from './Container'
export type { ContainerProps } from './Container'

export { Eyebrow } from './Eyebrow'
export type { EyebrowProps } from './Eyebrow'

export { PageHeader } from './PageHeader'
export type { PageHeaderProps } from './PageHeader'

export { Tag } from './Tag'
export type { TagProps } from './Tag'

export { TileGrid } from './TileGrid'
export type { TileGridProps } from './TileGrid'

export { TopBar } from './TopBar'
export type { TopBarProps } from './TopBar'

export { cx } from './classNames'

export { TOKEN_GROUPS, TOKEN_NAMES } from './tokens'
export type { TokenGroup, TokenKind } from './tokens'
