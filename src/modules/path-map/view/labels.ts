/**
 * Small presentation helpers shared by the map (`PathMapScreen.tsx`) and the
 * «Что внутри» panel (`PathMapInside.tsx`, #536). Moved out of the screen so
 * the panel does not import from it.
 */

const OWNER_COLORS = ['#8FD3C1', '#B9A6F5', '#F4A3A3', '#F2B544', '#9EC5FF']

/** A stable colour per owner label, so «ДС» reads the same on the card and in the panel. */
export function ownerColor(owner: string): string {
  let hash = 0
  for (const ch of owner) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return OWNER_COLORS[hash % OWNER_COLORS.length]
}

/** What an obstacle opens, in words: «открывает «X»», «открывает маяк», or why it does not. */
export function opensText(opensTitle: string | null, opens: string | undefined): string {
  if (opensTitle) return opensTitle === 'маяк' ? 'открывает маяк' : `открывает «${opensTitle}»`
  return opens ? `открывает «${opens}» — такого блока нет` : 'ничего не открывает'
}
