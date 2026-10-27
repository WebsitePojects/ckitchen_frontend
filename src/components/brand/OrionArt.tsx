import { memo } from 'react'

/**
 * ORION's own artwork, drawn in SVG (no stock or hotlinked images):
 *  - dark: a star field with the Orion constellation in thin lines,
 *  - light: irregular geometric shapes on paper.
 * Both are rendered and the wrong one is hidden by CSS (.orion-art-dark / .orion-art-light in
 * index.css), so nothing swaps or flashes after a theme change.
 */

/** Deterministic PRNG so the star field is identical on every render and every machine. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STARS = (() => {
  const rand = mulberry32(1987)
  return Array.from({ length: 140 }, () => ({
    x: rand() * 1600,
    y: rand() * 1000,
    r: rand() < 0.08 ? 1.6 : rand() * 0.9 + 0.3,
    o: rand() * 0.55 + 0.2,
  }))
})()

/** Orion's principal stars, proportions after the real sky (x right, y down). */
const ORION = {
  meissa: [500, 150],
  betelgeuse: [395, 255],
  bellatrix: [640, 290],
  alnitak: [470, 520],
  alnilam: [522, 505],
  mintaka: [575, 488],
  saiph: [420, 800],
  rigel: [690, 770],
} as const
type StarName = keyof typeof ORION
const ORION_LINES: Array<[StarName, StarName]> = [
  ['meissa', 'betelgeuse'],
  ['meissa', 'bellatrix'],
  ['betelgeuse', 'alnitak'],
  ['bellatrix', 'mintaka'],
  ['alnitak', 'alnilam'],
  ['alnilam', 'mintaka'],
  ['alnitak', 'saiph'],
  ['mintaka', 'rigel'],
]
const STAR_TINT: Partial<Record<StarName, string>> = { betelgeuse: '#FFB27A', rigel: '#BFD8FF' }

interface ArtProps {
  className?: string
  /** Where the constellation sits: 'side' for hero panels, 'corner' for the app backdrop. */
  placement?: 'side' | 'corner'
}

export const NightSky = memo(function NightSky({ className, placement = 'side' }: ArtProps) {
  const transform = placement === 'side' ? 'translate(380 60) scale(0.95)' : 'translate(980 40) scale(0.62)'
  return (
    <svg className={className} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <defs>
        <radialGradient id="orion-nebula" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5EEAB0" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#5EEAB0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="orion-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      {STARS.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#E8EFEA" opacity={s.o} />
      ))}
      <g transform={transform}>
        {/* Orion Nebula under the belt */}
        <ellipse cx="520" cy="630" rx="70" ry="48" fill="url(#orion-nebula)" />
        {ORION_LINES.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={ORION[a][0]}
            y1={ORION[a][1]}
            x2={ORION[b][0]}
            y2={ORION[b][1]}
            stroke="#5EEAB0"
            strokeOpacity="0.45"
            strokeWidth="1.4"
          />
        ))}
        {(Object.keys(ORION) as StarName[]).map((name) => (
          <g key={name}>
            <circle cx={ORION[name][0]} cy={ORION[name][1]} r="16" fill="url(#orion-glow)" opacity="0.35" />
            <circle cx={ORION[name][0]} cy={ORION[name][1]} r={name === 'betelgeuse' || name === 'rigel' ? 4.2 : 3.2} fill={STAR_TINT[name] ?? '#F4F7F5'} />
          </g>
        ))}
      </g>
    </svg>
  )
})

export const PaperGeometry = memo(function PaperGeometry({ className, placement = 'corner' }: ArtProps) {
  // 'side' pulls the edge composition into the middle of a narrow hero panel.
  const transform = placement === 'side' ? 'translate(-560 40) scale(1.05)' : undefined
  return (
    <svg className={className} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <g transform={transform}>
      <defs>
        <pattern id="orion-dots" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.3" fill="#15201B" fillOpacity="0.16" />
        </pattern>
      </defs>
      {/* Irregular shapes: offset triangles, arcs, a dotted patch, an outline ring, a stepped bar. */}
      <path d="M1180 -40 L1520 120 L1290 330 Z" fill="#0A5C41" fillOpacity="0.07" />
      <path d="M1240 40 L1460 150 L1310 280 Z" fill="none" stroke="#0A5C41" strokeOpacity="0.22" strokeWidth="1.5" />
      <rect x="1330" y="420" width="230" height="170" fill="url(#orion-dots)" transform="rotate(-8 1445 505)" />
      <circle cx="1490" cy="820" r="120" fill="none" stroke="#8A5A00" strokeOpacity="0.2" strokeWidth="1.5" />
      <path d="M1380 940 A170 170 0 0 1 1600 760" fill="none" stroke="#15201B" strokeOpacity="0.12" strokeWidth="18" strokeLinecap="round" />
      <path d="M-60 760 L220 700 L140 1040 Z" fill="#E9C46A" fillOpacity="0.16" />
      <path d="M60 820 L250 780" stroke="#15201B" strokeOpacity="0.14" strokeWidth="1.5" />
      <rect x="40" y="90" width="150" height="110" fill="url(#orion-dots)" transform="rotate(12 115 145)" />
      <path d="M-40 360 C 80 300, 160 430, 260 380" fill="none" stroke="#0A5C41" strokeOpacity="0.18" strokeWidth="1.5" />
      <g fill="#15201B" fillOpacity="0.08">
        <rect x="1100" y="880" width="36" height="36" transform="rotate(18 1118 898)" />
        <rect x="1150" y="900" width="22" height="22" transform="rotate(32 1161 911)" />
      </g>
      </g>
    </svg>
  )
})

/** The app-wide backdrop: theme art pinned behind the shell, faded out of the reading area. */
export function OrionBackdrop() {
  return (
    <div className="orion-backdrop" aria-hidden>
      <NightSky className="orion-art-dark absolute inset-0 h-full w-full opacity-70" placement="corner" />
      <PaperGeometry className="orion-art-light absolute inset-0 h-full w-full" />
    </div>
  )
}
