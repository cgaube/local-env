import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RunState } from '#services/dashboard/agent-protocol.ts'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import type { TerminalSession } from '#ui/features/terminal/terminal-session.ts'

// Tells the end of each run once, if it was seen running here: not the last
// run, ended before the page loaded
const createRunNotifier = (onShow: () => void, isShown: () => boolean) => {
  // By startedAt
  const running = new Set<string>()
  const told = new Set<string>()
  return (run: RunState | null) => {
    if (!run) return
    if (run.status === 'running') {
      running.add(run.startedAt)
      return
    }
    if (!running.has(run.startedAt) || told.has(run.startedAt)) return
    told.add(run.startedAt)
    const title = `local-env ${run.command}`
    // No Show while the terminal is on screen already
    const action = isShown() ? undefined : { label: 'Show', onClick: onShow }
    if (run.exitCode === 0) {
      toast.success(`${title} finished`, { action })
    } else {
      toast.error(`${title} failed`, {
        description: `It exited with code ${run.exitCode}.`,
        action,
        duration: Infinity,
        closeButton: true,
      })
    }
  }
}

// Says when a run of the agent ends, whether its terminal is open or not. The
// session sees each state of the run, before React merges them; the agent
// topic of /api/events sees the end while the sheet is closed.
export function RunToast({
  session,
  onShow,
  shown,
}: {
  session: TerminalSession
  onShow: () => void
  // Whether the terminal sheet is open
  shown: boolean
}) {
  const { agent } = useLiveData()
  // Read when a run ends, not when the notifier is made
  const isShown = useRef(shown)
  useEffect(() => {
    isShown.current = shown
  }, [shown])
  const [notify] = useState(() =>
    createRunNotifier(onShow, () => isShown.current),
  )

  useEffect(
    () => session.subscribe(() => notify(session.getSnapshot().run)),
    [session, notify],
  )
  useEffect(() => notify(agent?.run ?? null), [agent?.run, notify])

  return null
}
