import { ArrowUpCircleIcon, RefreshCwIcon, TagIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { useTerminal } from '#ui/features/terminal/terminal-provider'
import { useLatestVersion } from '#ui/features/version/use-latest-version.ts'

// Where the update check answers
const AT = 'bottom-center'

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
// A new release: what `local-env update` does, run here by the dashboard
// agent, or in a terminal without it
function UpdateDialog({
  version,
  open,
  onOpenChange,
  onUpdate,
}: {
  version: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // Runs it in the terminal sheet: null when the agent isn't running
  onUpdate: (() => void) | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update local-env</DialogTitle>
          <DialogDescription>
            local-env {version} is out.{' '}
            {onUpdate
              ? 'Update from here, or run this in your terminal.'
              : 'Run this in your terminal.'}
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
          {onUpdate ? <Button onClick={onUpdate}>Update</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NavVersion({ build = __LOCAL_ENV_BUILD__ }) {
  const latest = useLatestVersion()
  const { agent } = useLiveData()
  const terminal = useTerminal()
  const [helpOpen, setHelpOpen] = useState(false)
  // `local-env update` through the dashboard agent, in the terminal sheet
  const runUpdate = agent?.available
    ? () => {
        setHelpOpen(false)
        terminal.run('update')
      }
    : null
  const updating =
    agent?.run?.command === 'update' && agent.run.status === 'running'
  const release = build.kind === 'release'
  const update =
    release && latest.data && isNewer(latest.data, build.version)
      ? latest.data
      : null
  const dev = build.kind === 'release' ? null : DEV_LABELS[build.kind]
  const checking = latest.isFetching

  // The answer comes as a toast: the menu closes on the click
  const checkForUpdates = async () => {
    // Bottom center, near the version line it answers. The answers replace
    // the loading toast (same id) in the same place.
    const id = toast.loading('Checking for updates…', { position: AT })
    const result = await latest.refetch()
    const found = result.data
    if (result.isError) {
      toast.error("Couldn't reach GitHub", {
        id,
        position: AT,
        description: 'Try again later.',
      })
    } else if (!release) {
      toast.info('A dev build updates with git', {
        id,
        position: AT,
        description: found ? `The latest release is v${found}.` : undefined,
      })
    } else if (found && isNewer(found, build.version)) {
      toast.info(`local-env ${found} is out`, {
        id,
        position: AT,
        description: `You run v${build.version}.`,
        action: { label: 'How to update', onClick: () => setHelpOpen(true) },
      })
    } else {
      toast.success("You're up to date", {
        id,
        position: AT,
        description: `v${build.version} is the latest.`,
      })
    }
  }

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
            {/* All that shows while the sidebar shows only icons */}
            <TagIcon />
            {dev ? <Badge variant="warning">{dev.label}</Badge> : 'local-env'}
            <span className="truncate">
              {/* The commit of a dev build is in the menu: too long here */}v
              {build.version}
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
              {dev && build.commit ? (
                <DropdownMenuLabel className="flex justify-between gap-6">
                  <span>Commit</span>
                  <span className="text-foreground font-mono">
                    {build.commit}
                  </span>
                </DropdownMenuLabel>
              ) : null}
              <DropdownMenuLabel className="flex justify-between gap-6">
                <span>Latest</span>
                <span className="text-foreground font-mono">
                  {checking
                    ? 'Checking…'
                    : latest.data
                      ? `v${latest.data}`
                      : 'Unknown'}
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {/* Its terminal while it runs; a new release first says what
                  it brings; otherwise it refreshes the services, sources and
                  stacks */}
              {updating ? (
                <DropdownMenuItem onClick={terminal.show}>
                  <ArrowUpCircleIcon />
                  Updating…
                </DropdownMenuItem>
              ) : update ? (
                <DropdownMenuItem onClick={() => setHelpOpen(true)}>
                  <ArrowUpCircleIcon />
                  Update to v{update}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={!runUpdate}
                  onClick={runUpdate ?? undefined}
                  title={
                    runUpdate
                      ? undefined
                      : 'Run local-env start to update from here'
                  }
                >
                  <ArrowUpCircleIcon />
                  Update
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={checking} onClick={checkForUpdates}>
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
            onUpdate={runUpdate}
          />
        ) : null}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
