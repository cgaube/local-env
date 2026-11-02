import { ArrowUpRightIcon } from 'lucide-react'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import type { Service, Source } from '#ui/features/live-data/live-data.ts'
import { StatusBadge } from '#ui/features/status/status-badge'
import { appContent } from '../overview.ts'
import { ExternalLink } from '#ui/features/links/external-link'

// One card per core service with a local-env.app label: the apps you use
export function AppCards({
  services,
  sources,
}: {
  services: Service[]
  sources: Source[]
}) {
  const apps = services.filter((service) => service.app)
  if (!apps.length) return null

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {apps.map((service) => {
        const content = appContent(service.app?.content ?? null, sources)
        return (
          <Card key={service.service}>
            <CardHeader>
              <CardTitle>{service.app?.name}</CardTitle>
              <CardDescription>{service.description}</CardDescription>
              <CardAction>
                <StatusBadge state={service.state} />
              </CardAction>
            </CardHeader>
            {content || service.url ? (
              <CardFooter className="text-muted-foreground flex justify-between gap-2 text-sm">
                <span>{content}</span>
                {service.url ? (
                  <ExternalLink
                    href={service.url}
                    className="inline-flex items-center gap-1 font-medium"
                  >
                    Open {service.app?.name}
                    <ArrowUpRightIcon className="size-4" />
                  </ExternalLink>
                ) : null}
              </CardFooter>
            ) : null}
          </Card>
        )
      })}
    </div>
  )
}
