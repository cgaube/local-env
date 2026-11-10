import { Link } from '@tanstack/react-router'
import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { buttonVariants } from '#ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { useLogins } from '#ui/features/logins/logins.ts'
import {
  type AttentionItem,
  attentionItems,
} from '#ui/features/overview/attention.ts'
import { useToolChanges } from '#ui/features/tools/use-tool-changes.ts'

function ItemAction({ action }: Pick<AttentionItem, 'action'>) {
  if (!action) return null
  if (action.kind === 'command') return <CodeSnippet code={action.command} />
  return (
    <Link
      to={action.to}
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      {action.label}
    </Link>
  )
}

// When nothing needs you: a check in the space the list takes otherwise.
// Health, beside it, shows the services; Sources, the logins.
function AllGood() {
  return (
    <Empty className="p-4">
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className="bg-success/10 text-success size-14 rounded-full"
        >
          <CircleCheckIcon className="size-7" />
        </EmptyMedia>
        <EmptyTitle>All good</EmptyTitle>
        <EmptyDescription>
          Your services run, your logins work and your tools are up to date
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

// At the top of the overview: what needs you, each with what to do, or that
// all is well. From what the page knows: the core
// services, the agent, the logins it checked and the tools of the next
// install. It fills its row, as tall as Health beside it.
export function AttentionCard() {
  const { services, agent } = useLiveData()
  const logins = useLogins()
  const tools = useToolChanges()
  const items = attentionItems({ services, agent, logins: logins.data, tools })

  if (services && agent && items.length === 0) {
    return (
      <Card className="flex-1">
        <CardContent className="flex flex-1">
          <AllGood />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="flex-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {items.length > 0 ? (
            <TriangleAlertIcon
              aria-hidden="true"
              className="text-destructive"
            />
          ) : null}
          {items.length > 0 ? `Needs attention (${items.length})` : 'Checking…'}
        </CardTitle>
        <CardDescription>
          {items.length > 0
            ? 'What to do so that everything works'
            : 'Your services, your logins and your tools'}
        </CardDescription>
      </CardHeader>
      {items.length > 0 ? (
        <CardContent>
          <ul className="divide-border flex flex-col divide-y">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{item.title}</span>
                  {item.detail ? (
                    <span className="text-muted-foreground text-sm">
                      {item.detail}
                    </span>
                  ) : null}
                </div>
                <div className="shrink-0 sm:max-w-sm">
                  <ItemAction action={item.action} />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  )
}
