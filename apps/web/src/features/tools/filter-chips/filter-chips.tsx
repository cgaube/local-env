import { XIcon } from 'lucide-react'
import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'

export type FilterChip = { label: string; value: string; remove: () => void }

// The active filters, each removable on its own
export function FilterChips({
  chips,
  onClear,
}: {
  chips: FilterChip[]
  onClear: () => void
}) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map(({ label, value, remove }) => (
        <Badge key={`${label}:${value}`} variant="secondary" className="pr-0.5">
          <span className="text-muted-foreground">{label}:</span> {value}
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-4"
            aria-label={`Remove ${label}: ${value}`}
            onClick={remove}
          >
            <XIcon />
          </Button>
        </Badge>
      ))}
      <Button variant="ghost" size="xs" onClick={onClear}>
        Clear all
      </Button>
    </div>
  )
}
