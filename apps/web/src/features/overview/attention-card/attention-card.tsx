import type { LucideIcon } from 'lucide-react'
import {
  CircleCheckIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Card, CardContent } from '#ui/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty'
import { cn } from '#ui/lib/utils'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import { ButtonLink } from '#ui/features/links/button-link'
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
    <ButtonLink to={action.to} variant="outline" size="sm">
      {action.label}
    </ButtonLink>
  )
}

// The tinted circle at the top of each state
const TONES = {
  good: 'bg-success/10 text-success',
  attention: 'bg-warning/10 text-warning',
  checking: 'bg-muted text-muted-foreground',
} as const

function StateHeader({
  tone,
  icon: Icon,
  title,
  description,
}: {
  tone: keyof typeof TONES
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <EmptyHeader>
      <EmptyMedia
        variant="icon"
        className={cn('size-14 rounded-full', TONES[tone])}
      >
        <Icon
          aria-hidden="true"
          className={cn('size-7', tone === 'checking' && 'animate-spin')}
        />
      </EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
  )
}

// "1 thing needs you", "2 things need you"
const countTitle = (count: number) =>
  count === 1 ? '1 thing needs you' : `${count} things need you`

// At the top of the overview, as tall as Health beside it: what needs you,
// each with what to do, or that all is well. One layout for each state: a
// tinted icon in the middle, then the list when there is one. From what the
// page knows: the core services, the agent, the logins it checked and the
// tools of the next install.
export function AttentionCard() {
  const { services, agent } = useLiveData()
  const logins = useLogins()
  const tools = useToolChanges()
  const items = attentionItems({ services, agent, logins: logins.data, tools })
  const checking = !services || !agent

  return (
    <Card className="flex-1">
      <CardContent className="flex flex-1">
        <Empty className="p-4">
          {items.length > 0 ? (
            <>
              <StateHeader
                tone="attention"
                icon={TriangleAlertIcon}
                title={countTitle(items.length)}
                description="Here's what to do"
              />
              <EmptyContent className="max-w-2xl">
                <ul className="border-border divide-border flex w-full flex-col divide-y rounded-lg border text-left">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      // A command takes the width of the row, under the text;
                      // a button stays beside it
                      className={cn(
                        'flex flex-col gap-2 px-4 py-3',
                        item.action?.kind !== 'command' &&
                          'sm:flex-row sm:items-center sm:justify-between sm:gap-4',
                      )}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium">{item.title}</span>
                        {item.detail ? (
                          <span className="text-muted-foreground text-sm">
                            {item.detail}
                          </span>
                        ) : null}
                      </div>
                      <div
                        className={
                          item.action?.kind === 'command'
                            ? 'min-w-0'
                            : 'shrink-0'
                        }
                      >
                        <ItemAction action={item.action} />
                      </div>
                    </li>
                  ))}
                </ul>
              </EmptyContent>
            </>
          ) : checking ? (
            <StateHeader
              tone="checking"
              icon={LoaderCircleIcon}
              title="Checking…"
              description="Your services, your logins and your tools"
            />
          ) : (
            <StateHeader
              tone="good"
              icon={CircleCheckIcon}
              title="All good"
              description="Your services run, your logins work and your tools are up to date"
            />
          )}
        </Empty>
      </CardContent>
    </Card>
  )
}
