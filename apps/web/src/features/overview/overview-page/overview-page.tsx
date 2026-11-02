import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import { Skeleton } from '#ui/components/ui/skeleton'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { PageHeader } from '#ui/features/page-header/page-header'
import { AppCards } from '../app-cards'
import { CoreServicesTable } from '../core-services-table'
import { servicesSummary } from '../overview.ts'

export function OverviewPage() {
  const { services, sources } = useLiveData()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Your local environment: the apps and the services behind them"
      />

      {services ? (
        <AppCards services={services} sources={sources ?? []} />
      ) : (
        <Skeleton className="h-32" />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Core services</CardTitle>
          <CardDescription>
            {services ? servicesSummary(services) : 'Loading…'}
          </CardDescription>
        </CardHeader>
        {services?.length ? (
          <CardContent>
            <CoreServicesTable services={services} />
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}
