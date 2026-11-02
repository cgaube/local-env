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
import { ToolStatusBadge } from '../tool-status-badge'
import { catalogRows } from '../tools.ts'

// In the header while tools wait for `local-env install`. The dashboard can't
// run anything on the Mac: the dialog gives the command to run.
export function InstallButton() {
  const { tools } = useLiveData()
  const pending = tools
    ? catalogRows(tools).filter(
        ({ status }) => status === 'to-install' || status === 'update',
      )
    : []
  if (pending.length === 0) return null
  const sudo = pending.filter((tool) => tool.needsSudo)

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install {plural(pending.length, 'tool')}</DialogTitle>
          <DialogDescription>
            Picked in the catalog, not installed on this Mac yet, or changed
            since. Run this in your terminal to install them.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {pending.map((tool) => (
            <li key={tool.id} className="flex items-center gap-2 text-sm">
              <span className="font-medium">{tool.name}</span>
              <span className="text-muted-foreground">{tool.source}</span>
              <span className="ml-auto">
                {tool.status ? <ToolStatusBadge status={tool.status} /> : null}
              </span>
            </li>
          ))}
        </ul>
        <CodeSnippet code="local-env install" />
        {sudo.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            It asks for your password: {sudo.map(({ name }) => name).join(', ')}{' '}
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
