'use client'

import React, { useEffect, useId, useRef, useState } from 'react'

/**
 * The small «⋯» / «+» menu of the editor (#539, #541 rework): a disclosure
 * button (`aria-haspopup="menu"`) and a `role="menu"` list of actions. Used on
 * a track label, a task row, a road slot (the станция / шлагбаум / туман
 * picker) and the Обочина panel, so edit affordances stay one small control
 * instead of a row of buttons.
 *
 * Keyboard: opening focuses the first item; ↑/↓/Home/End move; Esc closes and
 * returns focus to the trigger (the key is consumed, so the editor's Esc does
 * not also close the open form); Tab closes. A click outside closes. Choosing
 * an item closes the menu, puts focus back on the trigger and then runs the
 * action — an action that opens a form or a dialog moves focus on from there,
 * and a dialog returns it to the trigger.
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
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0)

  useEffect(() => {
    if (!open) return
    itemRefs.current[enabled[0] ?? 0]?.focus()
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // `enabled` is derived from `items`; focusing once per opening is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const onMenuKey = (e: React.KeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement)
    const at = enabled.indexOf(current)
    const go = (i: number) => itemRefs.current[enabled[(i + enabled.length) % enabled.length]]
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      go(at + 1)?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      go(at - 1)?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      go(0)?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      go(enabled.length - 1)?.focus()
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  return (
    <span ref={wrapRef} className={`pm-ed-menuwrap${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="pm-ed-menubtn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-pressed={pressed || undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">{trigger}</span>
      </button>
      {open ? (
        <span
          id={id}
          role="menu"
          aria-label={menuLabel ?? label}
          className="pm-ed-menu"
          onKeyDown={onMenuKey}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[i] = node
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="pm-ed-menuitem"
              data-danger={item.danger || undefined}
              disabled={item.disabled}
              onClick={() => {
                close(true)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  )
}
