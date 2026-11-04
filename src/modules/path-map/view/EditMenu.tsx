'use client'

import React, { useRef } from 'react'

import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'

import { PM_KIT } from './kit'

/**
 * The small «⋯» / «+» menu of the editor (#539; #541 v2: the kit DropdownMenu,
 * not a hand-rolled list). Used on a track label, a task row, a road slot (the
 * станция / шлагбаум / туман picker) and the Обочина panel, so edit
 * affordances stay one small control instead of a row of buttons.
 *
 * Keyboard and dismissal are Radix's (↑/↓/Home/End, typeahead, Esc closes and
 * returns focus to the trigger, a click outside closes). One addition: when the
 * chosen action moved focus on (a form's first field, a dialog), focus is NOT
 * pulled back to the trigger afterwards.
 *
 * Two trigger looks: `canvas` — the road's own small round «+» / «⋯» (its look
 * belongs to the map canvas and stays as drawn), `quiet` — the kit ghost button
 * used in the panel and the forms.
 */

export interface EditMenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

export function EditMenu({
  label,
  menuLabel,
  items,
  trigger = '⋯',
  className,
  disabled,
  pressed,
  look = 'canvas',
}: {
  /** The trigger's accessible name. */
  label: string
  /** The menu's accessible name; defaults to `label`. */
  menuLabel?: string
  items: EditMenuItem[]
  trigger?: React.ReactNode
  className?: string
  disabled?: boolean
  /** The trigger stands for something open in the panel (a slot whose form is open). */
  pressed?: boolean
  look?: 'canvas' | 'quiet'
}) {
  const picked = useRef(false)
  return (
    <span className={`pm-ed-menuwrap${className ? ` ${className}` : ''}`}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          {look === 'canvas' ? (
            // primitives-first-ok: the road canvas's own «+» / «⋯» marker (design-source/path-map/AddStation.dc.html); the kit DropdownMenu drives it
            <button
              type="button"
              className="pm-ed-menubtn"
              aria-label={label}
              aria-pressed={pressed || undefined}
            >
              <span aria-hidden="true">{trigger}</span>
            </button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size={trigger === '⋯' ? 'icon-sm' : 'sm'}
              className="pm-ed-quietbtn"
              aria-label={label}
              aria-pressed={pressed || undefined}
            >
              <span aria-hidden="true">{trigger}</span>
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className={`${PM_KIT} min-w-44`}
          align={look === 'canvas' && trigger === '+' ? 'center' : 'end'}
          aria-label={menuLabel ?? label}
          aria-labelledby={undefined}
          onCloseAutoFocus={(e) => {
            const moved =
              document.activeElement instanceof HTMLElement &&
              document.activeElement !== document.body
            if (picked.current && moved) e.preventDefault()
            picked.current = false
          }}
        >
          {items.map((item) => (
            <DropdownMenuItem
              key={item.label}
              disabled={item.disabled}
              variant={item.danger ? 'destructive' : 'default'}
              onSelect={() => {
                picked.current = true
                item.onSelect()
              }}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
