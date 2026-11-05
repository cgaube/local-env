import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { plural } from '#ui/lib/plural.ts'
import { InstallDialog } from '#ui/features/tools/install-dialog'
import { currentProfile, waitingTools } from '#ui/features/tools/tools.ts'

const TOAST_ID = 'install-tools'

// On every page while tools wait for `local-env install`, until they are
// installed: the dashboard can't run anything on the Mac. Its Details open
// what waits and the command. Closed, it comes back when what waits changes.
export function InstallToast() {
  const { tools } = useLiveData()
  const [open, setOpen] = useState(false)
  const waiting = tools ? waitingTools(tools) : []
  // The tools, without the profiles: what the user counts
  const pending = waiting.filter((tool) => !tool.isProfile)
  // Everything that runs, the profile's own tasks included
  const sudo = waiting
    .filter((tool) => tool.needsSudo)
    .map(({ label }) => label)
  const sudoNote =
    sudo.length > 0
      ? `${sudo.join(', ')} ${sudo.length === 1 ? 'uses' : 'use'} sudo`
      : ''
  // What waits: a tool picked, or changed again, is news
  const key = pending
    .map(({ id, revision }) => `${id}@${revision}`)
    .sort()
    .join(' ')
  const count = pending.length
  // The key the user closed the toast on
  const closed = useRef<string | null>(null)

  useEffect(() => {
    if (!key) {
      closed.current = null
      toast.dismiss(TOAST_ID)
      return
    }
    if (closed.current === key) return
    // The same id: a new count updates the toast in place
    toast.info(`${plural(count, 'tool')} to install`, {
      id: TOAST_ID,
      position: 'top-center',
      duration: Infinity,
      closeButton: true,
      description: (
        <>
          Run <code className="font-mono">local-env install</code> in your
          terminal.
          {sudoNote ? ` It asks for your password: ${sudoNote}.` : null}
        </>
      ),
      action: {
        label: 'Details',
        onClick: (event) => {
          // Stays: the tools still wait until the command ran
          event.preventDefault()
          setOpen(true)
        },
      },
      onDismiss: () => {
        closed.current = key
      },
    })
  }, [key, count, sudoNote])

  return (
    <InstallDialog
      // Nothing left to install: nothing to show
      open={open && count > 0}
      onOpenChange={setOpen}
      pending={pending}
      sudo={sudo}
      profile={tools ? currentProfile(tools) : null}
    />
  )
}
