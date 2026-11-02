import { Badge } from '#ui/components/ui/badge'
import { tone } from '../tone.ts'

const VARIANTS = {
  ok: 'success',
  warn: 'warning',
  bad: 'destructive',
} as const

export function StatusBadge({ state }: { state: string }) {
  const value = tone(state)
  return (
    <Badge
      variant={VARIANTS[value]}
      // Red can't be read as small text on its own tint, in either theme: the
      // dot carries the color, the text keeps the foreground
      className={value === 'bad' ? 'text-foreground' : undefined}
    >
      {value === 'bad' ? (
        <span
          aria-hidden="true"
          className="bg-destructive size-1.5 rounded-full"
        />
      ) : null}
      {state}
    </Badge>
  )
}
