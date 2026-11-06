import { createContext, use, useState } from 'react'
import type { ReactNode } from 'react'
import type { AgentCommand } from '#services/dashboard/agent-protocol.ts'
import { RunToast } from '#ui/features/terminal/run-toast'
import { TerminalSheet } from '#ui/features/terminal/terminal-sheet'
import { createTerminalSession } from '#ui/features/terminal/terminal-session.ts'

type TerminalControls = {
  // Opens the sheet and runs the command, or shows the one that runs
  run: (command: AgentCommand) => void
  // Opens the sheet on the current or last run
  show: () => void
}

const TerminalContext = createContext<TerminalControls | null>(null)

// One terminal sheet for the whole app, above every page: it stays open
// while the user moves around
export function TerminalProvider({ children }: { children: ReactNode }) {
  const [session] = useState(createTerminalSession)
  const [open, setOpen] = useState(false)
  const [controls] = useState<TerminalControls>(() => ({
    run: (command) => {
      setOpen(true)
      session.start(command)
    },
    show: () => {
      setOpen(true)
      session.open()
    },
  }))

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) session.close()
  }

  return (
    <TerminalContext value={controls}>
      {children}
      <TerminalSheet
        open={open}
        onOpenChange={onOpenChange}
        session={session}
      />
      {/* The end of a run, on any page, with the sheet closed too */}
      <RunToast session={session} onShow={controls.show} shown={open} />
    </TerminalContext>
  )
}

export function useTerminal() {
  const controls = use(TerminalContext)
  if (!controls) {
    throw new Error('useTerminal must be used within TerminalProvider')
  }
  return controls
}
