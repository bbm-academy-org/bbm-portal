/**
 * F3 «Расход по месяцам» and F4 «Ватерлиния» (spec 584) — ported from the
 * owner-picked `design-source/finance/BudgetDashboard.html` (variant B): the
 * mockup's own SVG geometry, rendered on the server. Every colour is a
 * `--chart-*` theme token. The values arrive computed by the module; these
 * components only place them.
 */
import { compactNumber, niceTicks } from './budget-view'

export type MonthlyColumn = {
  key: string
  label: string
  gross: number | null
  net: number | null
  partial: boolean
  provisional: boolean
}

export type AverageLevels = {
  gross: number
  net: number
  grossText: string
  netText: string
  /** Index of the first and last averaged column. */
  from: number
  to: number
  caption: string
} | null

const W = 510
const H = 270
const PAD_L = 64
const PAD_R = 96
const tickClass = 'fill-muted-foreground text-[11px] tabular-nums'
const labelClass = 'fill-muted-foreground text-[11px]'
const strongClass = 'fill-foreground text-[12px] font-semibold'

function column(x: number, v: number, y: (v: number) => number, bw: number, r: number): string {
  const top = y(Math.max(v, 0))
  const bot = y(Math.min(v, 0))
  if (bot - top < r * 2) return `M${x},${top} h${bw} V${Math.max(bot, top + 1)} h${-bw} Z`
  if (v >= 0)
    return `M${x},${bot} V${top + r} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} V${bot} Z`
  return `M${x},${top} V${bot - r} q0,${r} ${r},${r} h${bw - 2 * r} q${r},0 ${r},-${r} V${top} Z`
}

export function MonthlyBurnChart({
  columns,
  averages,
}: {
  columns: MonthlyColumn[]
  averages: AverageLevels
}) {
  const padT = 14
  const padB = 34
  const iw = W - PAD_L - PAD_R
  const ih = H - padT - padB
  const values = columns.flatMap((c) => [c.gross ?? 0, c.net ?? 0])
  const maxV = Math.max(1, ...values)
  const minV = Math.min(0, ...values)
  const ticks = niceTicks(minV, maxV * 1.05, 4)
  const y0 = ticks[0]!
  const y1 = ticks[ticks.length - 1]!
  const y = (v: number) => padT + ih - ((v - y0) / (y1 - y0)) * ih
  const band = iw / Math.max(columns.length, 1)
  const bw = Math.min(12, band / 3)
  const r = 3
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="Расход по месяцам: валовый и чистый, со средним за полные месяцы"
    >
      <defs>
        <pattern
          id="budget-hatch"
          width="6"
          height="6"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-1)" strokeWidth="2.5" />
        </pattern>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            x2={PAD_L + iw}
            y1={y(t)}
            y2={y(t)}
            stroke={t === 0 ? 'var(--muted-foreground)' : 'var(--border)'}
          />
          <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" className={tickClass}>
            {compactNumber(t)}
          </text>
        </g>
      ))}
      {columns.map((c, i) => {
        const cx = PAD_L + band * i + band / 2
        return (
          <g key={c.key} data-month={c.key}>
            {c.gross !== null && (
              <path
                d={column(cx - bw - 1, c.gross, y, bw, r)}
                fill={c.partial ? 'url(#budget-hatch)' : 'var(--chart-1)'}
              />
            )}
            {c.net !== null && (
              <path
                d={column(cx + 1, c.net, y, bw, r)}
                fill={c.partial ? 'var(--chart-6)' : 'var(--chart-2)'}
              />
            )}
            <text x={cx} y={padT + ih + 16} textAnchor="middle" className={tickClass}>
              {c.label}
              {c.provisional ? '*' : ''}
            </text>
            {c.partial && (
              <text
                x={cx}
                y={padT + ih + 29}
                textAnchor="middle"
                className={`${tickClass} text-[10px]`}
              >
                неполный
              </text>
            )}
          </g>
        )
      })}
      {averages !== null && (
        <g>
          <line
            x1={PAD_L + band * averages.from + 4}
            x2={PAD_L + band * (averages.to + 1) - 4}
            y1={y(averages.gross)}
            y2={y(averages.gross)}
            stroke="var(--chart-4)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <line
            x1={PAD_L + band * averages.from + 4}
            x2={PAD_L + band * (averages.to + 1) - 4}
            y1={y(averages.net)}
            y2={y(averages.net)}
            stroke="var(--chart-5)"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinecap="round"
          />
          <text x={PAD_L + iw + 12} y={y(averages.gross) - 2} className={labelClass}>
            ср. валовый
          </text>
          <text x={PAD_L + iw + 12} y={y(averages.gross) + 12} className={strongClass}>
            {averages.grossText}
          </text>
          <text x={PAD_L + iw + 12} y={y(averages.net) + 14} className={labelClass}>
            ср. чистый
          </text>
          <text x={PAD_L + iw + 12} y={y(averages.net) + 28} className={strongClass}>
            {averages.netText}
          </text>
          <text
            x={PAD_L + iw + 12}
            y={y(averages.net) + 44}
            className={`${labelClass} text-[10px]`}
          >
            {averages.caption}
          </text>
        </g>
      )}
    </svg>
  )
}

export type WaterPoint = {
  key: string
  label: string
  net: number | null
  contributed: number | null
  partial: boolean
}

export function WaterlineChart({
  points,
  limit,
  labels,
}: {
  points: WaterPoint[]
  limit: number
  labels: { net: string; contributed: string; limit: string }
}) {
  const padT = 16
  const padB = 26
  const iw = W - PAD_L - PAD_R
  const ih = H - padT - padB
  const nets = points.map((p) => p.net ?? 0)
  const contribs = points.map((p) => p.contributed ?? 0)
  const lo = Math.min(-limit * 1.08, ...nets)
  const hi = Math.max(1, ...contribs) * 1.1
  const ticks = niceTicks(lo, hi, 6)
  const y0 = ticks[0]!
  const y1 = ticks[ticks.length - 1]!
  const y = (v: number) => padT + ih - ((v - y0) / (y1 - y0)) * ih
  const n = Math.max(points.length, 1)
  const x = (i: number) => PAD_L + (iw * (i + 0.5)) / n

  // A withheld point breaks the line: the net series stops where it is unknown.
  const known = points.findIndex((p) => p.net === null)
  const netPoints = (known === -1 ? points : points.slice(0, known)).map(
    (p, i) => [x(i), y(p.net!)] as const,
  )
  const contribKnown = points.findIndex((p) => p.contributed === null)
  const contribPoints = contribKnown === -1 ? points : points.slice(0, contribKnown)
  let step = ''
  contribPoints.forEach((p, i) => {
    step += i === 0 ? `M${x(0)},${y(p.contributed!)}` : ` H${x(i)} V${y(p.contributed!)}`
  })
  const lastNet = netPoints.at(-1)
  const area =
    netPoints.length > 0
      ? `M${x(0)},${y(0)} ` +
        netPoints.map(([px, py]) => `L${px},${py}`).join(' ') +
        ` L${lastNet![0]},${y(0)} Z`
      : ''
  const last = points.at(-1)
  const tags = [
    last?.contributed != null
      ? { y: y(last.contributed), k: 'взносы', v: labels.contributed }
      : null,
    last?.net != null ? { y: y(last.net), k: 'доход − расход', v: labels.net } : null,
    { y: y(-limit), k: '−лимит', v: labels.limit },
  ]
    .filter((tag): tag is { y: number; k: string; v: string } => tag !== null)
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < tags.length; i++) {
    if (tags[i]!.y - tags[i - 1]!.y < 32) tags[i]!.y = tags[i - 1]!.y + 32
  }
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="Ватерлиния: накопленный чистый результат, накопленные взносы и уровень минус лимит"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            x2={PAD_L + iw}
            y1={y(t)}
            y2={y(t)}
            stroke={t === 0 ? 'var(--muted-foreground)' : 'var(--border)'}
            strokeWidth={t === 0 ? 1.5 : 1}
          />
          <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" className={tickClass}>
            {compactNumber(t)}
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <text key={p.key} x={x(i)} y={padT + ih + 18} textAnchor="middle" className={tickClass}>
          {p.label}
          {p.partial ? '*' : ''}
        </text>
      ))}
      <line
        x1={PAD_L}
        x2={PAD_L + iw}
        y1={y(-limit)}
        y2={y(-limit)}
        stroke="var(--destructive)"
        strokeWidth="1.5"
        strokeDasharray="6 4"
      />
      {area !== '' && <path d={area} fill="var(--chart-1)" opacity={0.1} />}
      {netPoints.length > 0 && (
        <path
          d={netPoints.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' ')}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {step !== '' && (
        <path d={step} fill="none" stroke="var(--chart-3)" strokeWidth="2" strokeLinejoin="round" />
      )}
      {last?.net != null && (
        <circle
          cx={x(n - 1)}
          cy={y(last.net)}
          r="4.5"
          fill="var(--chart-1)"
          stroke="var(--card)"
          strokeWidth="2"
        />
      )}
      {last?.contributed != null && (
        <circle
          cx={x(n - 1)}
          cy={y(last.contributed)}
          r="4.5"
          fill="var(--chart-3)"
          stroke="var(--card)"
          strokeWidth="2"
        />
      )}
      {tags.map((tag) => (
        <g key={tag.k}>
          <text x={PAD_L + iw + 12} y={tag.y - 2} className={labelClass}>
            {tag.k}
          </text>
          <text x={PAD_L + iw + 12} y={tag.y + 12} className={strongClass}>
            {tag.v}
          </text>
        </g>
      ))}
    </svg>
  )
}
