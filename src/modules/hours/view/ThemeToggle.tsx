'use client'

import React from 'react'

/**
 * Переключатель темы поверх системной — перенесён из прототипа владельца.
 * Пишет выбор в `data-theme` на <html> и запоминает его в localStorage; парный
 * пре-скрипт в HoursLayout применяет сохранённый выбор ДО отрисовки, поэтому
 * вспышки чужой темы нет.
 */

const STORAGE_KEY = 'bbm-hours-theme'

export function ThemeToggle() {
  return (
    <button
      type="button"
      className="hours-theme-btn"
      aria-label="Переключить тему"
      onClick={() => {
        const root = document.documentElement
        const current =
          root.dataset.theme ??
          (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        const next = current === 'dark' ? 'light' : 'dark'
        root.dataset.theme = next
        try {
          window.localStorage.setItem(STORAGE_KEY, next)
        } catch {
          // приватный режим / отключённое хранилище — тема просто не запомнится
        }
      }}
    >
      ◐
    </button>
  )
}
