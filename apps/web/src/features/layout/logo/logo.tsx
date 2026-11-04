import { useId } from 'react'

// The profile deck, like .github/logo.svg: the profile in use (~, your home)
// in front of the others, Dracula purple to pink. useId keeps the gradient
// and mask ids unique when the logo shows more than once.
export function Logo({ className }: { className?: string }) {
  const id = useId()
  const deck = `${id}-deck`
  const gap = `${id}-gap`

  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <defs>
        <linearGradient
          id={deck}
          x1="1"
          y1="1"
          x2="47"
          y2="47"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#bd93f9" />
          <stop offset="1" stopColor="#ff79c6" />
        </linearGradient>
        {/* A gap around the front card, so the two cards stay apart at 16 px */}
        <mask
          id={gap}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="48"
          height="48"
        >
          <rect width="48" height="48" fill="#fff" />
          <rect x="-2" y="6" width="44" height="44" rx="12" fill="#000" />
        </mask>
      </defs>
      <rect
        x="9"
        y="1"
        width="38"
        height="38"
        rx="9"
        fill={`url(#${deck})`}
        opacity=".55"
        mask={`url(#${gap})`}
      />
      <rect x="1" y="9" width="38" height="38" rx="9" fill={`url(#${deck})`} />
      <path
        d="M9 31C11.8 23.6 16.6 23.1 20 28S28.2 32.4 31 25"
        fill="none"
        stroke="#fff"
        strokeWidth="5.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
