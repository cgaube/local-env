import { cn } from '#ui/lib/utils'
import { type Tone, tone } from '#ui/features/status/tone.ts'
import { StatusBadge } from '#ui/features/status/status-badge'

const DOT: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
}

// A state where a list has many: a dot when all is well, the state's badge
// when not, so that "running" is not read six times. The state stays for
// screen readers, and on hover.
export function StatusDot({ state }: { state: string }) {
  if (tone(state) !== 'ok') return <StatusBadge state={state} />
  return (
    <span title={state} className="inline-flex items-center">
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full', DOT[tone(state)])}
      />
      <span className="sr-only">{state}</span>
    </span>
  )
}
