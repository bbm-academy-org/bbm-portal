/**
 * The token REGISTRY — the names `src/ui/tokens.css` declares, grouped for the
 * showcase (`/p/ui-kit`).
 *
 * Names only. The values live in `tokens.css` and nowhere else: this file is a
 * table of contents, not a second copy of the palette. Keeping the two in step
 * is mechanical, not conventional — `pnpm lint:ui-tokens` fails on drift in
 * either direction (a token declared but unlisted, or listed but undeclared),
 * and `tests/unit/ui-tokens.spec.ts` asserts the same set from the test tier.
 */

export type TokenKind = 'color' | 'length' | 'text'

export interface TokenGroup {
  /** Heading the showcase prints above the group. */
  title: string
  /**
   * How the showcase demonstrates the group: `color` as a swatch, `length` as
   * a bar of that width, `text` as a line of type set with it. The showcase
   * shows each token's EFFECT rather than printing its value — the value is in
   * `tokens.css`, and a page that reprinted it would be a third copy to drift.
   */
  kind: TokenKind
  tokens: string[]
}

export const TOKEN_GROUPS: TokenGroup[] = [
  {
    title: 'Surfaces',
    kind: 'color',
    tokens: [
      '--bbm-color-canvas',
      '--bbm-color-surface',
      '--bbm-color-surface-raised',
      '--bbm-color-surface-sunken',
      '--bbm-color-surface-head',
      '--bbm-color-surface-group',
      '--bbm-color-surface-selected',
      '--bbm-color-surface-placeholder',
    ],
  },
  {
    title: 'Text',
    kind: 'color',
    tokens: [
      '--bbm-color-text',
      '--bbm-color-text-strong',
      '--bbm-color-text-control',
      '--bbm-color-text-secondary',
      '--bbm-color-text-tertiary',
      '--bbm-color-text-muted',
      '--bbm-color-text-disabled',
      '--bbm-color-text-ghost',
      '--bbm-color-text-faint',
    ],
  },
  {
    title: 'Borders',
    kind: 'color',
    tokens: [
      '--bbm-color-border-strong',
      '--bbm-color-border',
      '--bbm-color-border-muted',
      '--bbm-color-border-subtle',
      '--bbm-color-border-faint',
    ],
  },
  {
    title: 'Typography',
    kind: 'text',
    tokens: [
      '--bbm-font-family-base',
      '--bbm-font-size-2xs',
      '--bbm-font-size-xs',
      '--bbm-font-size-sm',
      '--bbm-font-size-md',
      '--bbm-font-size-base',
      '--bbm-font-size-lg',
      '--bbm-font-size-xl',
      '--bbm-font-size-2xl',
      '--bbm-font-weight-regular',
      '--bbm-font-weight-medium',
      '--bbm-font-weight-semibold',
      '--bbm-line-height-base',
      '--bbm-tracking-tight',
      '--bbm-tracking-wide',
      '--bbm-tracking-wider',
      '--bbm-tracking-widest',
      '--bbm-tracking-ultra',
    ],
  },
  {
    title: 'Spacing',
    kind: 'length',
    tokens: [
      '--bbm-space-1',
      '--bbm-space-2',
      '--bbm-space-4',
      '--bbm-space-5',
      '--bbm-space-6',
      '--bbm-space-7',
      '--bbm-space-8',
      '--bbm-space-10',
      '--bbm-space-11',
      '--bbm-space-12',
      '--bbm-space-14',
      '--bbm-space-16',
      '--bbm-space-18',
      '--bbm-space-20',
      '--bbm-space-24',
      '--bbm-space-28',
      '--bbm-space-30',
      '--bbm-space-32',
      '--bbm-space-64',
    ],
  },
  {
    title: 'Sizes',
    kind: 'length',
    tokens: [
      '--bbm-size-bar-height',
      '--bbm-size-content-max',
      '--bbm-size-sidebar',
      '--bbm-size-avatar',
      '--bbm-size-tile-icon',
      '--bbm-size-tile-icon-compact',
      '--bbm-size-tile-min',
      '--bbm-size-tile-min-compact',
      '--bbm-size-search-min',
      '--bbm-size-tile-min-width',
    ],
  },
  {
    title: 'Lines and corners',
    kind: 'length',
    tokens: ['--bbm-border-width', '--bbm-border-width-accent', '--bbm-radius-round'],
  },
]

/** Every token name, flat — the set `tokens.css` must declare exactly. */
export const TOKEN_NAMES: string[] = TOKEN_GROUPS.flatMap((group) => group.tokens)
