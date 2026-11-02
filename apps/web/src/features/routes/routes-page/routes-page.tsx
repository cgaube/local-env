import { SearchIcon } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { Card } from '#ui/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#ui/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#ui/components/ui/input-group'
import { Skeleton } from '#ui/components/ui/skeleton'
import { useDomain } from '#ui/features/config/use-domain.ts'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { PageHeader } from '#ui/features/page-header/page-header'
import { plural } from '#ui/lib/plural.ts'
import { AddRouteHelp } from '../add-route-help'
import { filterRoutes, userRoutes } from '../routes.ts'
import { RoutesTable } from '../routes-table'

export function RoutesPage() {
  const { routes: all, connected, updatedAt } = useLiveData()
  const domain = useDomain()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const routes = all ? userRoutes(all) : null
  const visible = routes ? filterRoutes(routes, deferredQuery) : []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Routes"
        description={
          !connected && routes
            ? 'Reconnecting…'
            : routes
              ? `${plural(routes.length, 'route')} · updated ${updatedAt?.toLocaleTimeString()}`
              : 'Loading…'
        }
      >
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Filter by host, container, stack…"
            aria-label="Filter routes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
      </PageHeader>

      {routes ? (
        <AddRouteHelp domain={domain} defaultOpen={routes.length === 0} />
      ) : null}

      <Card className="py-0">
        {!routes ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
          </div>
        ) : visible.length > 0 ? (
          <RoutesTable routes={visible} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {routes.length ? 'No routes match the filter' : 'No routes yet'}
              </EmptyTitle>
              <EmptyDescription>
                {routes.length
                  ? 'Try another host, container or stack.'
                  : 'Start a container with VIRTUAL_HOST to serve it here.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </Card>
    </div>
  )
}
