import React from 'react'

/** Glyphs copied from the «Карта пути» canvas (`design-source/path-map/`). Decorative: aria-hidden. */

export function LighthouseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#F2B544"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 9 8.5 21h7L14 9z" />
      <rect x="9.5" y="5" width="5" height="4" rx=".5" />
      <path d="M12 2 9.5 5h5zM15 7l6-2M15 7l6 2M9 7 3 5M9 7 3 9M6 21h12" />
    </svg>
  )
}

export function LighthouseMark() {
  return (
    <svg
      className="pm-beacon-mark"
      width="120"
      height="96"
      viewBox="0 0 120 96"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M68 26 118 8M68 26l50 18M52 26 2 8M52 26 2 44"
        stroke="#F2B544"
        strokeOpacity="0.5"
        strokeWidth="2"
      />
      <path d="M54 34 50 90h20l-4-56z" fill="#0A1222" stroke="#F2B544" strokeWidth="2" />
      <path d="M52 34h16" stroke="#F2B544" strokeWidth="2" />
      <rect
        x="54"
        y="20"
        width="12"
        height="14"
        rx="1"
        fill="#F2B544"
        fillOpacity="0.25"
        stroke="#F2B544"
        strokeWidth="2"
      />
      <path d="M60 10l-7 10h14z" stroke="#F2B544" strokeWidth="2" />
      <path d="M51.6 52h16.8M50.8 68h18.4" stroke="#F2B544" strokeWidth="2" />
      <path d="M36 90h48" stroke="#F2B544" strokeWidth="2" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M6 17v-3a4 4 0 0 1 4-4h4a4 4 0 0 0 4-4" />
    </svg>
  )
}

export function FogIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6.5 15h10a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 6.5 15z" />
      <path d="M4 19h9M15.5 19H20" />
    </svg>
  )
}

export function UpArrowIcon() {
  return (
    <svg
      className="pm-because-icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  )
}

export function PinIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  )
}

export function LiftedBarrierIcon() {
  return (
    <svg width="24" height="18" viewBox="0 0 24 18" fill="none" aria-hidden="true">
      <path d="M3 17V6" stroke="#A9B3C6" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M3 7 21 1"
        stroke="#FFC93C"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
    </svg>
  )
}

export function BrokenLinkIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 17H7a5 5 0 0 1 0-10h2M15 7h2a5 5 0 0 1 4 8M8 12h3M3 3l18 18" />
    </svg>
  )
}
