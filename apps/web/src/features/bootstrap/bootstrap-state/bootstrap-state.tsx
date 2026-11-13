import { Badge } from '#ui/components/ui/badge'
import {
  type BootstrapRow,
  bootstrapStateLabel,
} from '#ui/features/bootstrap/bootstrap.ts'

const VARIANT: Record<
  BootstrapRow['state'],
  'success' | 'warning' | 'destructive'
> = {
  done: 'success',
  never: 'warning',
  changed: 'warning',
  blocked: 'destructive',
}

// The bootstrap of a source, on one line in its panel of the Sources card,
// like a login: its roles and its state. What to run is in Needs attention.
export function BootstrapState({ bootstrap }: { bootstrap: BootstrapRow }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate font-medium">Bootstrap</span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        {bootstrap.labels.join(', ')}
      </span>
      <Badge variant={VARIANT[bootstrap.state]} className="shrink-0">
        {bootstrapStateLabel(bootstrap.state)}
      </Badge>
    </div>
  )
}
