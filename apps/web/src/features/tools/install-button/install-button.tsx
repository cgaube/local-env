import { DownloadIcon } from 'lucide-react'
import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#ui/components/ui/dialog'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { plural } from '#ui/lib/plural.ts'
import { ToolStatusBadge } from '#ui/features/tools/tool-status-badge'
import {
  type CatalogRow,
  catalogRows,
  currentProfile,
} from '#ui/features/tools/tools.ts'

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

// In the header while tools wait for `local-env install`. The dashboard can't
// run anything on the Mac: the dialog gives the command to run. A profile is
// a set of tools, not one: its tools are listed under its name.
export function InstallButton() {
  const { tools } = useLiveData()
  const waiting = tools
    ? catalogRows(tools).filter(
        ({ status }) => status === 'to-install' || status === 'update',
      )
    : []
  const pending = waiting.filter((tool) => !tool.isProfile)
  if (pending.length === 0) return null
  // Everything that runs, the profile's own tasks included
  const sudo = waiting.filter((tool) => tool.needsSudo)
  const profile = tools ? currentProfile(tools) : null
  const inProfile = pending.filter((tool) => tool.inProfile !== null)
  const picked = pending.filter((tool) => tool.inProfile === null)

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="sm"
            aria-label={`Install ${plural(pending.length, 'tool')}`}
          />
        }
      >
        <DownloadIcon data-icon="inline-start" />
        Install
        <Badge variant="secondary">{pending.length}</Badge>
      </DialogTrigger>
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
            It asks for your password:{' '}
            {sudo.map(({ label }) => label).join(', ')}{' '}
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
