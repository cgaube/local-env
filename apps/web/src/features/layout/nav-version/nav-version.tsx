import { ArrowUpCircleIcon, RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
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
} from '#ui/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#ui/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#ui/components/ui/sidebar'
import { isNewer, UPDATE_COMMAND } from '#cli/core/homebrew.ts'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import { useLatestVersion } from '#ui/features/version/use-latest-version.ts'

const DEV_LABELS = {
  checkout: {
    label: 'Dev build',
    title: 'Built from a checkout (bun run compile), not a Homebrew release',
  },
  'dev-server': {
    label: 'Dev server',
    title: 'Served by bun run dev, with hot reload',
  },
} as const

// The version of local-env, at the bottom of the sidebar, and a menu with the
// latest one. A build that isn't the Homebrew release says so, with its
// commit: its version is only the one it will be released as, and brew
// doesn't update it.
// The dashboard can't run brew on the Mac: the terminal updates
function UpdateDialog({
  version,
  open,
  onOpenChange,
}: {
  version: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update local-env</DialogTitle>
          <DialogDescription>
            local-env {version} is out. Run this in your terminal.
          </DialogDescription>
        </DialogHeader>
        <CodeSnippet code={UPDATE_COMMAND} />
        <p className="text-muted-foreground text-sm">
          It installs the new version with Homebrew, then restarts the core
          services on it, this dashboard included, and updates your sources and
          stacks.
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NavVersion({ build = __LOCAL_ENV_BUILD__ }) {
  const latest = useLatestVersion()
  const [helpOpen, setHelpOpen] = useState(false)
  const release = build.kind === 'release'
  const update =
    release && latest.data && isNewer(latest.data, build.version)
      ? latest.data
      : null
  const dev = build.kind === 'release' ? null : DEV_LABELS[build.kind]

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="sm"
                className="text-muted-foreground text-xs"
                title={dev?.title}
              />
            }
          >
            {dev ? <Badge variant="warning">{dev.label}</Badge> : 'local-env'}
            <span className="truncate">
              v{build.version}
              {dev && build.commit ? ` · ${build.commit}` : null}
            </span>
            {update ? (
              <Badge className="ml-auto">
                <ArrowUpCircleIcon data-icon="inline-start" />
                Update
              </Badge>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-auto min-w-(--anchor-width)"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex justify-between gap-6">
                <span>Running</span>
                <span className="text-foreground font-mono">
                  v{build.version}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuLabel className="flex justify-between gap-6">
                <span>Latest</span>
                <span className="text-foreground font-mono">
                  {latest.data
                    ? `v${latest.data}`
                    : latest.isFetching
                      ? 'Checking…'
                      : 'Unknown'}
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {update ? (
                <DropdownMenuItem onClick={() => setHelpOpen(true)}>
                  <ArrowUpCircleIcon />
                  How to update
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                // Kept open: the Latest line shows the answer
                closeOnClick={false}
                onClick={() => latest.refetch()}
              >
                <RefreshCwIcon />
                Check for updates
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {update ? (
          <UpdateDialog
            version={update}
            open={helpOpen}
            onOpenChange={setHelpOpen}
          />
        ) : null}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
