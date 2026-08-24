import { compileMDX } from 'next-mdx-remote/rsc'
import React from 'react'

import { getVariables, RULES_MDX } from '@/lib/finmodel'

import { headingText, sectionId } from './toc'
import { V, type VUnit } from './V'

/**
 * Рендер нормативного документа «Смарт-контракт BBM» из снимка мастера.
 *
 * Серверный компонент: MDX компилируется на сервере, в браузер уезжает готовая
 * разметка и ноль клиентского JS — документ читают, с ним не взаимодействуют.
 *
 * Мастер документа НЕ содержит import-деклараций (это записано в самом
 * мастере): всё, что он зовёт, приходит components-map'ом ниже. `<V/>` тут же
 * связывается со снапшотом переменных — в MDX остаётся только ключ.
 */

const variables = getVariables()

const components = {
  V: (props: { k: string; unit?: VUnit }) => <V {...props} variables={variables} />,
  // Якорь считает та же `sectionId`, что и оглавление, — иначе ссылка слева и
  // цель справа расходятся молча (см. комментарий в `toc.ts`).
  h2: ({ children, ...rest }: React.ComponentProps<'h2'>) => (
    <h2 id={sectionId(headingText(children))} {...rest}>
      {children}
    </h2>
  ),
  // Таблицы документа шире колонки на узком экране; горизонтально скроллится
  // САМА таблица, а не страница.
  table: (props: React.ComponentProps<'table'>) => (
    <div className="rules-tablewrap">
      <table {...props} />
    </div>
  ),
}

/**
 * Компиляция кэшируется на ПРОЦЕСС, а не на запрос.
 *
 * Страница `force-dynamic` (гейт кэша группы `(platform)`), то есть рендерится
 * на каждый запрос, — но источник у неё константа: закоммиченный снимок и
 * значения снапшота. Без этого мемо каждый читатель платил бы полной
 * компиляцией MDX за один и тот же результат. Кэшируется промис, а не
 * значение: два одновременных запроса на холодном процессе иначе запустили бы
 * компиляцию дважды. `React.cache` тут не подходит — он живёт ровно один
 * запрос, то есть ничего бы не сэкономил.
 */
let compiled: Promise<React.ReactNode> | null = null

export function compiledDocument(): Promise<React.ReactNode> {
  compiled ??= compileMDX({
    source: RULES_MDX,
    components,
    // Фронтматтер мастера — метаданные, а не первый абзац документа.
    options: { parseFrontmatter: true },
  }).then((result) => result.content)
  return compiled
}

export async function RulesDocument() {
  return <div className="rules-doc">{await compiledDocument()}</div>
}
