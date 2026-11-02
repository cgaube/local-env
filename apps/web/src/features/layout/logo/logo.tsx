// The local-env cube, like .github/logo.svg: Dracula purple to pink
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <defs>
        <linearGradient
          id="local-env-cube"
          x1="6"
          y1="4"
          x2="42"
          y2="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#bd93f9" />
          <stop offset="1" stopColor="#ff79c6" />
        </linearGradient>
      </defs>
      <path d="M24 4 42 14 24 24 6 14Z" fill="url(#local-env-cube)" />
      <path d="M24 4 42 14 24 24 6 14Z" fill="#fff" opacity=".35" />
      <path d="M6 14 24 24V44L6 34Z" fill="url(#local-env-cube)" />
      <path d="M42 14 24 24V44L42 34Z" fill="url(#local-env-cube)" />
      <path d="M42 14 24 24V44L42 34Z" fill="#000" opacity=".25" />
      <path
        d="m10.5 22.5 7 5.5-7 2"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
