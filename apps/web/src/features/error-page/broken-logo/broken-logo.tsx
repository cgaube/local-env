import { useId } from 'react'
import type { ReactNode } from 'react'

// The logo (features/layout/logo), broken in one of a few ways. The shapes
// are the logo's own; the motion is in index.css (--animate-broken-*), and
// each moved piece holds its broken pose without it (reduced motion).
export const BREAKS = [
  'cracked',
  'flatline',
  'unplugged',
  'glitch',
  'melted',
] as const

export type Break = (typeof BREAKS)[number]

const WAVE = 'M9 31C11.8 23.6 16.6 23.1 20 28S28.2 32.4 31 25'
// Dracula: cyan, pink, yellow
const CYAN = '#8be9fd'
const PINK = '#ff79c6'
const SPARK = '#f1fa8c'

// The front card, along the crack: the left half, then the right
const CRACK_LEFT = '0,0 23,0 19,18 25,26 17,36 21,56 0,56'
const CRACK_RIGHT = '23,0 56,0 56,56 21,56 17,36 25,26 19,18'

// Moving pieces turn around a point of the logo's own 48×48 box
const pivot = (x: number, y: number) => ({
  transformBox: 'view-box' as const,
  transformOrigin: `${x}px ${y}px`,
})

export function BrokenLogo({
  variant,
  className,
}: {
  variant: Break
  className?: string
}) {
  const id = useId()
  const fill = `url(#${id}-deck)`
  const parts: Record<Break, () => ReactNode> = {
    cracked: () => <Cracked id={id} fill={fill} />,
    flatline: () => <Flatline fill={fill} />,
    unplugged: () => <Unplugged fill={fill} />,
    glitch: () => <Glitch id={id} fill={fill} />,
    melted: () => <Melted fill={fill} />,
  }

  return (
    <svg
      viewBox="-10 -6 68 68"
      aria-hidden="true"
      data-variant={variant}
      className={className}
    >
      <defs>
        <linearGradient
          id={`${id}-deck`}
          x1="1"
          y1="1"
          x2="47"
          y2="47"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#bd93f9" />
          <stop offset="1" stopColor="#ff79c6" />
        </linearGradient>
        <mask id={`${id}-gap`} maskUnits="userSpaceOnUse">
          <rect x="-10" y="-6" width="68" height="68" fill="#fff" />
          <rect x="-2" y="6" width="44" height="44" rx="12" fill="#000" />
        </mask>
      </defs>
      <rect
        x="9"
        y="1"
        width="38"
        height="38"
        rx="9"
        fill={fill}
        opacity=".55"
        mask={`url(#${id}-gap)`}
        className={variant === 'flatline' ? 'grayscale' : undefined}
      />
      {parts[variant]()}
    </svg>
  )
}

const FrontCard = ({ fill }: { fill: string }) => (
  <rect x="1" y="9" width="38" height="38" rx="9" fill={fill} />
)

const Wave = ({ d = WAVE }: { d?: string }) => (
  <path
    d={d}
    fill="none"
    stroke="#fff"
    strokeWidth="5.4"
    strokeLinecap="round"
  />
)

// Split down the middle, the halves leaning apart
function Cracked({ id, fill }: { id: string; fill: string }) {
  const half = (side: 'left' | 'right', points: string, pose: string) => (
    <g
      clipPath={`url(#${id}-${side})`}
      style={{ ...pivot(20, 47), transform: pose }}
      className={`animate-broken-crack motion-reduce:animate-none`}
    >
      <FrontCard fill={fill} />
      <Wave />
      <clipPath id={`${id}-${side}`}>
        <polygon points={points} transform="translate(-2 4)" />
      </clipPath>
    </g>
  )

  return (
    <>
      {half('left', CRACK_LEFT, 'translate(-3px, 1px) rotate(-9deg)')}
      {half('right', CRACK_RIGHT, 'translate(3px, 2px) rotate(8deg)')}
    </>
  )
}

// The deck gone grey, a heart monitor where the wave was
function Flatline({ fill }: { fill: string }) {
  return (
    <>
      <g className="grayscale">
        <FrontCard fill={fill} />
      </g>
      <path
        d="M6 29H14L16.5 22L19.5 35L22 29H34"
        fill="none"
        stroke="#fff"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={100}
        strokeDasharray="100 100"
        className="animate-broken-pulse motion-reduce:animate-none"
      />
    </>
  )
}

// The wave cut in two, both ends dangling, a spark between them
function Unplugged({ fill }: { fill: string }) {
  return (
    <>
      <FrontCard fill={fill} />
      <g
        style={{ ...pivot(9, 31), transform: 'rotate(14deg)' }}
        className="animate-broken-dangle motion-reduce:animate-none"
      >
        <Wave d="M9 31C11.8 23.6 15.6 23.1 17.2 24.6" />
      </g>
      <g
        style={{ ...pivot(31, 25), transform: 'rotate(-16deg)' }}
        className="animate-broken-dangle motion-reduce:animate-none"
      >
        <Wave d="M24 31.4C26.6 32.2 29 30.4 31 25" />
      </g>
      <g
        style={pivot(21, 29.4)}
        className="animate-broken-spark motion-reduce:animate-none"
      >
        <path
          d="M21 26.2V27.4M21 31.4V32.6M17.8 29.4H19M23 29.4H24.2M18.7 27.1L19.6 28M22.4 30.8L23.3 31.7M23.3 27.1L22.4 28M19.6 30.8L18.7 31.7"
          stroke={SPARK}
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </g>
    </>
  )
}

// Cyan and pink ghosts beside the card, jumping out now and then, and a
// slice of the card sliding off
function Glitch({ id, fill }: { id: string; fill: string }) {
  const ghost = (color: string, animation: string, offset: string) => (
    <g
      opacity=".7"
      style={{ mixBlendMode: 'screen', transform: `translateX(${offset})` }}
      className={`${animation} motion-reduce:animate-none`}
    >
      <rect x="1" y="9" width="38" height="38" rx="9" fill={color} />
    </g>
  )

  return (
    <>
      {ghost(CYAN, 'animate-broken-glitch-a', '-1.5px')}
      {ghost(PINK, 'animate-broken-glitch-b', '1.5px')}
      <FrontCard fill={fill} />
      <Wave />
      <g
        clipPath={`url(#${id}-slice)`}
        style={{ transform: 'translateX(4px)' }}
        className="animate-broken-slice motion-reduce:animate-none"
      >
        <FrontCard fill={fill} />
        <Wave />
      </g>
      <clipPath id={`${id}-slice`}>
        <rect x="-10" y="24" width="68" height="5" />
      </clipPath>
    </>
  )
}

// The front card dripping off the bottom, the wave sagging
function Melted({ fill }: { fill: string }) {
  // A trail from the card's bottom edge, a drop at its end
  const drip = (x: number, width: number, length: number, delay: string) => (
    <g
      style={{
        transformBox: 'fill-box',
        transformOrigin: 'top',
        animationDelay: delay,
      }}
      className="animate-broken-drip motion-reduce:animate-none"
    >
      <rect x={x} y="40" width={width} height={7 + length} fill={fill} />
      <circle cx={x + width / 2} cy={47 + length} r={width * 0.8} fill={fill} />
    </g>
  )

  return (
    <>
      {drip(11, 3, 8, '0s')}
      {drip(19.5, 4, 10, '-1.2s')}
      {drip(28, 2.5, 5, '-2.1s')}
      <FrontCard fill={fill} />
      <Wave d="M9 32C11.8 28 16.6 31 20 34S28.2 37 31 32" />
    </>
  )
}
