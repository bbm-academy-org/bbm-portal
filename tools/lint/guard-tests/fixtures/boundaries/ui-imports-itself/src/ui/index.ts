// LEGAL: the kit is composed of its own files. `src/ui` importing `src/ui` is
// not the boundary this rule draws.
import { cx } from './internal/classNames'

export const AppTile = cx('bbm-app-tile', 'bbm-app-tile--internal')
