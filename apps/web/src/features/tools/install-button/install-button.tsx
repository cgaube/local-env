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
// The dialog names the required variables without a value: the Variables
// button shows their count.
export function InstallButton({
  onOpenVariables,
}: {
  // Opens the Variables sheet, from the dialog's "Variables missing"
  onOpenVariables: (() => void) | null
}) {
  const { agent } = useLiveData()
  const terminal = useTerminal()
  const changes = useToolChanges()
  const [open, setOpen] = useState(false)
  const installing =
    agent?.run?.command === 'install' && agent.run.status === 'running'

  // The run's terminal, or a plain run: nothing waits. A missing value
  // shows on the Variables button, not here.
  if (installing || changes.count === 0) {
    return (
      <RunButton
        command="install"
        blocked={
          changes.missing.length + changes.secrets.length > 0
            ? 'Set the missing variables first'
            : null
        }
      />
    )
  }

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
        missing={changes.missing}
        secrets={changes.secrets}
        onOpenVariables={
          onOpenVariables
            ? () => {
                setOpen(false)
                onOpenVariables()
              }
            : null
        }
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
