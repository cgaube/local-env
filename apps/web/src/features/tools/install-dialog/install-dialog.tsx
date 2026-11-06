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

// What the next `local-env install` changes, opened by the Install button
// when something waits. With the dashboard agent running, Install runs it
// here, in the terminal sheet; without it, the dialog gives the command to
// run. A profile is a set of tools, not one: its tools are listed under its
// name.
export function InstallDialog({
  open,
  onOpenChange,
  pending,
  unpicked,
  sudo,
  profile,
  onInstall,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The tools, without the profiles
  pending: CatalogRow[]
  // Installed, then unpicked: the install forgets them, they stay installed
  unpicked: CatalogRow[]
  // The labels of what runs with sudo, the profile's own tasks included
  sudo: string[]
  // Only its name is shown
  profile: { label: string } | null
  // Runs `local-env install` through the agent: null when it isn't running
  onInstall: (() => void) | null
}) {
  const inProfile = pending.filter((tool) => tool.inProfile !== null)
  const picked = pending.filter((tool) => tool.inProfile === null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {pending.length > 0
              ? `Install ${plural(pending.length, 'tool')}`
              : 'Apply your changes'}
          </DialogTitle>
          <DialogDescription>
            {pending.length > 0
              ? 'Picked in the catalog or in your profile, not installed on this Mac yet, or changed since. '
              : null}
            {onInstall
              ? 'Install from here, or run this in your terminal.'
              : 'Run this in your terminal.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {profile ? (
            <ToolList title={`${profile.label} profile`} tools={inProfile} />
          ) : null}
          <ToolList title="Picked" tools={picked} />
          <ToolList title="Unpicked, stay on this Mac" tools={unpicked} />
        </div>
        <CodeSnippet code="local-env install" />
        {onInstall ? null : (
          <p className="text-muted-foreground text-sm">
            To install from here, run{' '}
            <code className="font-mono">local-env start</code>: it starts the
            agent that runs the install on this Mac.
          </p>
        )}
        {sudo.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            It asks for your password: {sudo.join(', ')}{' '}
            {sudo.length === 1 ? 'needs' : 'need'} sudo.
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          {onInstall ? <Button onClick={onInstall}>Install</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
