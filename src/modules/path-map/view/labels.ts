/**
 * Small presentation helpers shared by the map (`PathMapScreen.tsx`) and the
 * «Что внутри» panel (`PathMapInside.tsx`, #536). Moved out of the screen so
 * the panel does not import from it.
 */

/**
 * The owner chip's one colour pair (#538: the same look for every owner, no
 * per-person colours) — the map's `--pm-ink` initials on a `--pm-text` disc.
 * Mirrors `.pm-owner` in path-map.css; the contrast (≥4.5:1) is tested.
 */
export const OWNER_CHIP = { background: '#e8ecf4', ink: '#111317' } as const

const LETTER = /\p{L}/u

/** Whole graphemes, so an emoji (incl. ZWJ sequences) is never cut in half. */
function graphemes(text: string): string[] {
  return Array.from(
    new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(text),
    (s) => s.segment,
  )
}

/** Upper case that never turns one letter into two («ß» → «SS» keeps «ß»). */
function upper(g: string): string {
  const u = g.toUpperCase()
  return graphemes(u).length === 1 ? u : g
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
    return (caps ? letters.slice(0, 2) : letters.slice(0, 1)).map(upper).join('')
  }
  return upper(words[0][0]) + upper(words[1][0])
}

/** What an obstacle opens, in words: «открывает «X»», «открывает маяк», or why it does not. */
export function opensText(opensTitle: string | null, opens: string | undefined): string {
  if (opensTitle) return opensTitle === 'маяк' ? 'открывает маяк' : `открывает «${opensTitle}»`
  return opens ? `открывает «${opens}» — такого блока нет` : 'ничего не открывает'
}
