import { ListIcon } from 'lucide-react'
import { Button } from '#ui/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#ui/components/ui/sheet'
import { Skeleton } from '#ui/components/ui/skeleton'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { CoreServicesTable } from '#ui/features/overview/core-services-table'
import { servicesSummary } from '#ui/features/overview/overview.ts'
import { StatusDot } from '#ui/features/status/status-dot'

// Beside the apps: is each core service up, and the dashboard agent. The
// table of the services, with their containers and URLs, opens in a sheet:
// it is for when something breaks.
export function HealthCard() {
  const { services, agent } = useLiveData()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health</CardTitle>
        <CardDescription>
          {services ? servicesSummary(services) : 'Loading…'}
        </CardDescription>
        {services?.length ? (
          <CardAction>
            <Sheet>
              <SheetTrigger render={<Button variant="outline" size="sm" />}>
                <ListIcon data-icon="inline-start" />
                Details
              </SheetTrigger>
              <SheetContent className="w-full data-[side=right]:sm:max-w-5xl">
                <SheetHeader>
                  <SheetTitle>Core services</SheetTitle>
                  <SheetDescription>
                    {servicesSummary(services)}
                  </SheetDescription>
                </SheetHeader>
                <div className="overflow-x-auto px-4">
                  <CoreServicesTable services={services} />
                </div>
              </SheetContent>
            </Sheet>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {services ? (
          <ul className="flex flex-col gap-2 text-sm">
            {services.map(({ service, state }) => (
              <li
                key={service}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{service}</span>
                <StatusDot state={state} />
              </li>
            ))}
            {agent ? (
              <li className="flex items-center justify-between gap-2">
                <span className="truncate">
                  dashboard agent
                  {agent.available ? (
                    <span className="text-muted-foreground">
                      {' '}
                      {agent.version}
                    </span>
                  ) : null}
                </span>
                <StatusDot state={agent.available ? 'running' : 'stopped'} />
              </li>
            ) : null}
          </ul>
        ) : (
          <Skeleton className="h-24" />
        )}
      </CardContent>
    </Card>
  )
}
