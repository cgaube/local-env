import { RocketIcon } from 'lucide-react'
import { Button } from '#ui/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#ui/components/ui/tooltip'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { useTerminal } from '#ui/features/terminal/terminal-provider'

// Runs `local-env deploy <template>` in the terminal sheet, through the
// dashboard agent: the variables it asks for are typed there. During its run,
// it opens the terminal.
export function DeployButton({ template }: { template: string }) {
  const { agent } = useLiveData()
  const terminal = useTerminal()
  const run = agent?.run?.status === 'running' ? agent.run : null
  const deploying = run?.command === 'deploy' && run.template === template
  const reason = !agent?.available
    ? `Run local-env start to deploy from here, or local-env deploy ${template} in your terminal`
    : run && !deploying
      ? `Wait for local-env ${run.command} to finish`
      : null

  if (reason) {
    return (
      <Tooltip>
        {/* A disabled button gets no pointer events: the span shows the tip */}
        <TooltipTrigger render={<span tabIndex={0} />}>
          <Button size="sm" disabled>
            <RocketIcon data-icon="inline-start" />
            Deploy
          </Button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Button
      size="sm"
      onClick={() =>
        deploying ? terminal.show() : terminal.run('deploy', template)
      }
    >
      <RocketIcon data-icon="inline-start" />
      {deploying ? 'Deploying…' : 'Deploy'}
    </Button>
  )
}
