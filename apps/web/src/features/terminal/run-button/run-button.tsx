import { DownloadIcon, RefreshCwIcon } from 'lucide-react'
import type { AgentCommand } from '#services/dashboard/agent-protocol.ts'
import { Button } from '#ui/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#ui/components/ui/tooltip'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { useTerminal } from '#ui/features/terminal/terminal-provider'

const BUTTONS = {
  install: { icon: DownloadIcon, label: 'Install', running: 'Installing…' },
  update: { icon: RefreshCwIcon, label: 'Update', running: 'Updating…' },
} as const

// Runs `local-env install` or `update` in the terminal sheet, through the
// dashboard agent, whenever the user wants: with nothing waiting too. During
// its run, it opens the terminal.
export function RunButton({
  command,
  blocked = null,
}: {
  command: Exclude<AgentCommand, 'deploy'>
  // Why it can't run yet (a value missing): disabled, with this as its tip
  blocked?: string | null
}) {
  const { agent } = useLiveData()
  const terminal = useTerminal()
  const { icon: Icon, label, running } = BUTTONS[command]
  const runs = agent?.run?.command === command && agent.run.status === 'running'
  const reason = !agent?.available
    ? `Run local-env start to ${command} from here, or local-env ${command} in your terminal`
    : runs
      ? null
      : blocked

  if (reason) {
    return (
      <Tooltip>
        {/* A disabled button gets no pointer events: the span shows the tip */}
        <TooltipTrigger render={<span tabIndex={0} />}>
          <Button variant="outline" disabled>
            <Icon data-icon="inline-start" />
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Button
      variant="outline"
      onClick={() => (runs ? terminal.show() : terminal.run(command))}
    >
      <Icon data-icon="inline-start" />
      {runs ? running : label}
    </Button>
  )
}
