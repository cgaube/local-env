import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import { useDomain } from '#ui/features/config/use-domain.ts'
import { otherRoutes } from '#ui/features/docker/docker.ts'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { AddRouteHelp } from '#ui/features/routes/add-route-help'
import { RoutesTable } from '#ui/features/routes/routes-table'

// Under the templates: what runs behind the proxy that no template deployed
// (a stack made in Dockhand, a container with a VIRTUAL_HOST), with how to
// add one. Only when there is some.
export function OtherApps() {
  const { routes, templates } = useLiveData()
  const domain = useDomain()
  if (!routes || !templates) return null
  const others = otherRoutes(routes, templates)
  if (others.length === 0) return null

  return (
    <section aria-label="Other apps" className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Other apps</CardTitle>
          <CardDescription>
            Containers with a VIRTUAL_HOST that no template deployed
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <RoutesTable routes={others} />
        </CardContent>
      </Card>
      <AddRouteHelp domain={domain} defaultOpen={false} />
    </section>
  )
}
