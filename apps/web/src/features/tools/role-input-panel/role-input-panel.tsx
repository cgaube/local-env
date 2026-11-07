import { ChevronRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#ui/components/ui/collapsible'
import { FieldSet } from '#ui/components/ui/field'
import { plural } from '#ui/lib/plural.ts'

// The inputs of one role in a sheet that has several, folded under its
// name: a profile can bring many tools. Its header counts them, and the
// values the next install needs.
export function RoleInputPanel({
  label,
  count,
  missing,
  open,
  onOpenChange,
  children,
}: {
  label: string
  // Its fields
  count: number
  // Its required values without one, for a tool the install runs
  missing: number
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      // Clips the header to its corners
      className="group/panel overflow-hidden rounded-lg border"
    >
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            // Flush with the box: square, and no band when open
            className="aria-expanded:text-foreground hover:bg-muted/50 dark:hover:bg-muted/50 h-auto w-full justify-start gap-2 rounded-none px-3 py-2.5 aria-expanded:bg-transparent"
          />
        }
      >
        <ChevronRightIcon
          data-icon="inline-start"
          className="transition-transform group-data-[open]/panel:rotate-90"
        />
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground ml-auto text-xs font-normal">
          {plural(count, 'input')}
        </span>
        {missing > 0 ? (
          <Badge variant="warning">{missing} missing</Badge>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <FieldSet aria-label={label} className="border-t px-3 py-4">
          {children}
        </FieldSet>
      </CollapsibleContent>
    </Collapsible>
  )
}
