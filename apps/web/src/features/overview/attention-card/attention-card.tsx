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

// At the top of the overview: what needs you, each with what to do, or that
// all is well. From what the page knows: the core services, the agent, the
// logins it checked and the tools of the next install.
export function AttentionCard() {
  const { services, agent } = useLiveData()
  const logins = useLogins()
  const tools = useToolChanges()
  const items = attentionItems({ services, agent, logins: logins.data, tools })
  const loading = !services || !agent

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {items.length > 0 ? (
            <TriangleAlertIcon
              aria-hidden="true"
              className="text-destructive"
            />
          ) : loading ? null : (
            <CircleCheckIcon aria-hidden="true" className="text-success" />
          )}
          {items.length > 0 ? `Needs attention (${items.length})` : 'All good'}
        </CardTitle>
        <CardDescription>
          {items.length > 0
            ? 'What to do so that everything works'
            : loading
              ? 'Checking…'
              : 'Your services run, and nothing waits for you'}
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
