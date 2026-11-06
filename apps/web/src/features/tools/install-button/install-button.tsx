import { DownloadIcon } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { RunButton } from '#ui/features/terminal/run-button'
import { useTerminal } from '#ui/features/terminal/terminal-provider'
import { InstallDialog } from '#ui/features/tools/install-dialog'
import { useToolChanges } from '#ui/features/tools/use-tool-changes.ts'

// `local-env install`, on the Tools and Profiles pages. When a pick, an
// unpick or the profile left something to do, it stands out with the count,
// and opens what the install changes first. Otherwise it runs it at once.
export function InstallButton() {
  const { agent } = useLiveData()
  const terminal = useTerminal()
  const changes = useToolChanges()
  const [open, setOpen] = useState(false)
  const installing =
    agent?.run?.command === 'install' && agent.run.status === 'running'

  // The run's terminal, or a plain run: nothing waits
  if (installing || changes.count === 0) return <RunButton command="install" />

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        aria-label={`Install, ${changes.count} ${changes.count === 1 ? 'change' : 'changes'}`}
      >
        <DownloadIcon data-icon="inline-start" />
        Install
        <Badge variant="secondary">{changes.count}</Badge>
      </Button>
      <InstallDialog
        open={open}
        onOpenChange={setOpen}
        pending={changes.pending}
        unpicked={changes.unpicked}
        sudo={changes.sudo}
        profile={changes.profile}
        onInstall={
          agent?.available
            ? () => {
                setOpen(false)
                terminal.run('install')
              }
            : null
        }
      />
    </>
  )
}
