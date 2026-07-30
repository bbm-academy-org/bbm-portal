import { describe, expect, it } from 'vitest'

import {
  PORT_MAX,
  PORT_MIN,
  exhaustedMessage,
  firstFreePort,
  formatPort,
  portSequence,
} from '../../tools/dev/dev-ports.mjs'

/**
 * Диапазон 3000–3009 — не удобство, а потолок: redirect URI dev-Zitadel
 * зарегистрированы только на эти десять портов, вне их логин даёт
 * 400 invalid_request (#90, восстановление дефолта — #93).
 */

describe('portSequence', () => {
  it('перечисляет 3000–3009 подряд, шагом 1', () => {
    const ports = portSequence()
    expect(ports[0]).toBe(PORT_MIN)
    expect(ports.at(-1)).toBe(PORT_MAX)
    expect(ports).toHaveLength(10)
    expect(ports).toEqual([3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009])
  })
})

describe('firstFreePort', () => {
  it('берёт первый свободный, пропуская занятые чужими стендами', async () => {
    const busy = new Set([3000, 3001])
    const probed: number[] = []
    const probe = async (p: number) => {
      probed.push(p)
      return !busy.has(p)
    }
    expect(await firstFreePort(portSequence(), probe)).toBe(3002)
    // Проба останавливается на первом свободном — занятые не трогаются дальше.
    expect(probed).toEqual([3000, 3001, 3002])
  })

  it('возвращает null, когда весь диапазон занят', async () => {
    expect(await firstFreePort(portSequence(), async () => false)).toBe(null)
  })
})

describe('formatPort', () => {
  it('печатает PORT=<n> и рабочую строку запуска', () => {
    const lines = formatPort(3003)
    expect(lines[0]).toBe('PORT=3003')
    expect(lines.join('\n')).toContain('PORT=3003 pnpm dev')
    expect(lines.join('\n')).toContain('http://localhost:3003')
  })

  it('явно предупреждает про нерабочую форму `pnpm dev -- -p`', () => {
    // `--` доезжает до Next как позиционный аргумент: «Invalid project directory … \-p».
    expect(formatPort(3005).join('\n')).toContain('pnpm dev -- -p 3005')
  })
})

describe('exhaustedMessage', () => {
  it('не предлагает никого убивать — чужой listener это чужой стенд приёмки', () => {
    const msg = exhaustedMessage()
    expect(msg).toContain('3000-3009')
    expect(msg).toContain('Do NOT kill a listener you did not start')
  })
})
