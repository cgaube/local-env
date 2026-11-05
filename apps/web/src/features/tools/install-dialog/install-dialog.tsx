import { Button } from '#ui/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#ui/components/ui/dialog'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import { plural } from '#ui/lib/plural.ts'
import { ToolStatusBadge } from '#ui/features/tools/tool-status-badge'
import type { CatalogRow } from '#ui/features/tools/tools.ts'

function ToolList({ title, tools }: { title: string; tools: CatalogRow[] }) {
  if (tools.length === 0) return null
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      <ul className="flex flex-col gap-2">
        {tools.map((tool) => (
          <li key={tool.id} className="flex items-center gap-2 text-sm">
            <span className="font-medium">{tool.label}</span>
            <span className="text-muted-foreground">{tool.source}</span>
            <span className="ml-auto">
              {tool.status ? <ToolStatusBadge status={tool.status} /> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// What waits for `local-env install`, opened from the install toast. The
// dashboard can't run anything on the Mac: it gives the command to run. A
// profile is a set of tools, not one: its tools are listed under its name.
export function InstallDialog({
  open,
  onOpenChange,
  pending,
  sudo,
  profile,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The tools, without the profiles
  pending: CatalogRow[]
  // The labels of what runs with sudo, the profile's own tasks included
  sudo: string[]
  // Only its name is shown
  profile: { label: string } | null
}) {
  const inProfile = pending.filter((tool) => tool.inProfile !== null)
  const picked = pending.filter((tool) => tool.inProfile === null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Install {plural(pending.length, 'tool')}</DialogTitle>
          <DialogDescription>
            Picked in the catalog or in your profile, not installed on this Mac
            yet, or changed since. Run this in your terminal to install them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {profile ? (
            <ToolList title={`${profile.label} profile`} tools={inProfile} />
          ) : null}
          <ToolList title="Picked" tools={picked} />
        </div>
        <CodeSnippet code="local-env install" />
        {sudo.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            It asks for your password: {sudo.join(', ')}{' '}
            {sudo.length === 1 ? 'needs' : 'need'} sudo.
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
