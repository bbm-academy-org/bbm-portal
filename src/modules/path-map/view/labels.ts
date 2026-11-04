/**
 * Small presentation helpers shared by the map (`PathMapScreen.tsx`) and the
 * «Что внутри» panel (`PathMapInside.tsx`, #536). Moved out of the screen so
 * the panel does not import from it.
 */

/** The chip's disc colours; the initials on them are always {@link OWNER_INK} (≥4.5:1, #538). */
export const OWNER_COLORS = ['#8FD3C1', '#B9A6F5', '#F4A3A3', '#F2B544', '#9EC5FF']

/** The initials' colour on every chip — the map's `--pm-ink`. */
export const OWNER_INK = '#111317'

/** A stable colour per owner, so «Эдуард» reads the same on the card and in the panel. */
export function ownerColor(owner: string): string {
  let hash = 0
  for (const ch of owner) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return OWNER_COLORS[hash % OWNER_COLORS.length]
}

const LETTER = /\p{L}/u

/** Whole graphemes, so an emoji (incl. ZWJ sequences) is never cut in half. */
function graphemes(text: string): string[] {
  return Array.from(
    new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(text),
    (s) => s.segment,
  )
}

/**
 * What fits the owner chip's circle (#538): 1–2 letters. The map writes owners
 * as full names («Эдуард» → «Э», «Антон Сидоров» → «АС») or as initials already
 * («ДС», «Д. С.» → «ДС»). Words are whitespace-separated; a word's first LETTER
 * counts, so emoji and punctuation are skipped — and an owner with no letters at
 * all shows its first whole grapheme rather than half a surrogate pair.
 */
export function ownerInitials(owner: string): string {
  const trimmed = owner.trim()
  if (!trimmed) return ''
  const words = trimmed
    .split(/\s+/)
    .map((w) => graphemes(w).filter((g) => LETTER.test(g)))
    .filter((letters) => letters.length > 0)
  if (words.length === 0) return graphemes(trimmed)[0]
  if (words.length === 1) {
    const [letters] = words
    // Already initials: «ДС», «ЕВ», «ИТМО» — an all-capitals word keeps its first two.
    const caps =
      letters.length > 1 && letters.every((g) => g === g.toUpperCase() && g !== g.toLowerCase())
    return (caps ? letters.slice(0, 2) : letters.slice(0, 1)).join('').toUpperCase()
  }
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** What an obstacle opens, in words: «открывает «X»», «открывает маяк», or why it does not. */
export function opensText(opensTitle: string | null, opens: string | undefined): string {
  if (opensTitle) return opensTitle === 'маяк' ? 'открывает маяк' : `открывает «${opensTitle}»`
  return opens ? `открывает «${opens}» — такого блока нет` : 'ничего не открывает'
}
