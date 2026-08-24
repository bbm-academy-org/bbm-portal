import React from 'react'

/**
 * Оглавление документа и якоря его разделов.
 *
 * Один и тот же `sectionId` зовут обе стороны — сборка списка слева и
 * компонент `h2` в components-map рендерера. Это не «договорённость об одном
 * алгоритме», а буквально одна функция: якорь, посчитанный вторым способом,
 * рано или поздно разъезжается с первым, и оглавление ведёт в пустоту.
 */

export interface TocEntry {
  id: string
  title: string
}

/**
 * Якорь раздела: заголовок в нижнем регистре, всё не-буквенно-цифровое —
 * дефис. Кириллица не транслитерируется: браузеры и `getElementById`
 * работают с юникодными id, а транслитерация была бы ещё одной таблицей,
 * которую пришлось бы держать в синхроне.
 */
export function sectionId(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}

/**
 * Разделы документа — заголовки второго уровня его MDX-исходника.
 *
 * Читается ИСХОДНИК, а не отрендеренное дерево: рендер `next-mdx-remote`
 * возвращает готовые React-элементы, обходить их ради текста заголовка значило
 * бы разбирать документ дважды.
 */
export function documentToc(mdx: string): TocEntry[] {
  return [...mdx.matchAll(/^## +(.+?)\s*$/gm)].map((match) => ({
    id: sectionId(match[1]),
    title: match[1],
  }))
}

/**
 * Текст заголовка из детей MDX. Заголовки документа плоские, без разметки, —
 * но собирать якорь из чего-то, что не строка, всё равно нельзя молча: тогда
 * `sectionId` получил бы пустую строку и все разделы схлопнулись бы в один id.
 */
export function headingText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('')
}
