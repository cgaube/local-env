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
import { SourcesCard } from '#ui/features/sources/sources-card'
import { AppCards } from '#ui/features/overview/app-cards'
import { CoreServicesTable } from '#ui/features/overview/core-services-table'
import { servicesSummary } from '#ui/features/overview/overview.ts'

export function OverviewPage() {
  const { services, sources } = useLiveData()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Your local environment: the apps, the services behind them and your sources"
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

      <SourcesCard />
    </div>
  )
}
