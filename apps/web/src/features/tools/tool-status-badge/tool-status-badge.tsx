import { Badge } from '#ui/components/ui/badge'
import { STATUS_LABELS, type ToolStatus } from '../tools.ts'

const VARIANTS = {
  'to-install': 'warning',
  update: 'warning',
  installed: 'success',
  unpicked: 'secondary',
  removed: 'secondary',
} as const

export function ToolStatusBadge({ status }: { status: ToolStatus }) {
  return <Badge variant={VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
}
