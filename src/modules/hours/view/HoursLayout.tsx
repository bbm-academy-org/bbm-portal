import React from 'react'

import { ThemeToggle } from './ThemeToggle'
import './hours.css'

/**
 * Оболочка поверхности `/p/hours`. Здесь же — граница палитры: токены и фон
 * холста принадлежат `.hours-root`, а не route-группе `(platform)` (спека 081
 * п.29), поэтому соседняя страница OKR остаётся ровно такой, какой была.
 *
 * Пре-скрипт применяет запомненный выбор темы до отрисовки — иначе на первом
 * кадре мигала бы системная тема поверх выбранной.
 */

const THEME_PRESCRIPT = `try{var t=localStorage.getItem('bbm-hours-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`

export function HoursLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="hours-root">
      <script dangerouslySetInnerHTML={{ __html: THEME_PRESCRIPT }} />
      <ThemeToggle />
      {children}
    </div>
  )
}
