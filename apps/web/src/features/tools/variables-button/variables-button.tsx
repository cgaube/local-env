import { SlidersHorizontalIcon } from 'lucide-react'
import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'

// Opens the Variables sheet, beside Install: the values of every tool the
// next install runs. A required value without one shows on it.
export function VariablesButton({
  missing,
  onClick,
}: {
  // Required values without one, secrets included
  missing: number
  onClick: () => void
}) {
  return (
    <Button
      variant="outline"
      aria-label={missing > 0 ? `Variables, ${missing} missing` : 'Variables'}
      onClick={onClick}
    >
      <SlidersHorizontalIcon data-icon="inline-start" />
      Variables
      {missing > 0 ? <Badge variant="warning">{missing} missing</Badge> : null}
    </Button>
  )
}
