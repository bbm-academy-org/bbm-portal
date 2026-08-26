import type { ButtonHTMLAttributes } from 'react'

import { cx } from './classNames'
import './button.css'

export type ButtonVariant = 'default' | 'work' | 'plain'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  /**
   * `default` — the chrome control (`.bar-switch` of both wireframes).
   * `work`    — the cabinet toolbar action (`.btn` of `p-admin-shell.html`).
   * `plain`   — the sign-out control on paper (`.bar-out`).
   */
  variant?: ButtonVariant
  className?: string
}

/**
 * A button, and only a button. It never becomes a link when given an `href`:
 * a control that navigates is an `<a>`, and swapping the element under the
 * caller is how a kit ends up owning routing decisions it cannot see.
 *
 * `type="button"` is the default rather than the HTML default `submit` — every
 * control the two wireframes draw sits outside a form, and a control that
 * submits a form nobody wrote submitted is the failure this default removes.
 */
export function Button({ variant = 'default', className, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cx('bbm-button', variant !== 'default' && `bbm-button--${variant}`, className)}
      {...rest}
    />
  )
}
