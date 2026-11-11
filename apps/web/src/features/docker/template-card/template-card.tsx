import {
  ContainerIcon,
  ExternalLinkIcon,
  GlobeIcon,
  KeyRoundIcon,
  LockIcon,
  TextCursorInputIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '#ui/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import {
  STATUS_LABELS,
  type TemplateState,
} from '#ui/features/docker/docker.ts'
import { DeployButton } from '#ui/features/docker/deploy-button'
import { ButtonLink } from '#ui/features/links/button-link'
import { cn } from '#ui/lib/utils'
import type { CatalogTemplate } from '#ui/features/live-data/live-data.ts'

// What a deploy needs from the user: each with its icon
type Need = { icon: LucideIcon; text: string; warning?: boolean }

const needsOf = ({
  variables,
  secrets,
  unmasked,
  registries,
}: CatalogTemplate) =>
  [
    variables.length > 0
      ? {
          icon: TextCursorInputIcon,
          text: `Asks for ${variables.map(({ key }) => key).join(', ')}`,
        }
      : null,
    secrets.length > 0
      ? {
          icon: KeyRoundIcon,
          text: `From your vault: ${secrets.join(', ')}`,
        }
      : null,
    // The template's fix: a container variable named like the secret
    unmasked.length > 0
      ? {
          icon: TriangleAlertIcon,
          text: `Shown in clear in Dockhand: ${unmasked.join(', ')}`,
          warning: true,
        }
      : null,
    registries.length > 0
      ? {
          icon: LockIcon,
          text: `Private images: your ${registries.join(', ')} login`,
        }
      : null,
  ].filter((need): need is Need => need !== null)

// A template of the sources: what it is and what a deploy needs, then
// Deploy, or once deployed, whether it runs, its address while it does and a
// link to its stack in Dockhand (state: null while Dockhand or the routes are
// loading, or when Dockhand doesn't answer)
export function TemplateCard({
  template,
  state,
  domain,
}: {
  template: CatalogTemplate
  state: TemplateState | null
  domain: string | null
}) {
  const needs = needsOf(template)
  const deployed = state !== null && state.status !== 'not-deployed'
  const url = state?.url
  const dockhandUrl = domain ? `https://docker.${domain}` : null
  return (
    <Card className="w-full gap-4">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          {template.logo ? (
            <img
              src={template.logo}
              alt=""
              className="size-8 shrink-0 rounded-md object-contain"
            />
          ) : (
            <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
              <ContainerIcon className="size-4" />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <CardTitle className="truncate">{template.title}</CardTitle>
            <span className="text-muted-foreground truncate font-mono text-xs">
              {template.id}
            </span>
          </div>
        </div>
        {deployed ? (
          <CardAction>
            <Badge
              variant={state.status === 'running' ? 'success' : 'secondary'}
            >
              {STATUS_LABELS[state.status]}
            </Badge>
          </CardAction>
        ) : null}
        {template.description ? (
          <CardDescription className="mt-2 line-clamp-3">
            {template.description}
          </CardDescription>
        ) : null}
      </CardHeader>
      {needs.length > 0 ? (
        <CardContent>
          <ul className="text-muted-foreground flex flex-col gap-1.5 text-xs">
            {needs.map(({ icon: Icon, text, warning }) => (
              <li
                key={text}
                className={cn(
                  'flex items-start gap-2',
                  warning && 'text-warning',
                )}
              >
                <Icon className="mt-0.5 size-3.5 shrink-0" />
                <span className="break-all">{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}
      <CardFooter className="mt-auto flex-wrap justify-end gap-2">
        {url ? (
          <ButtonLink
            href={url}
            variant="outline"
            size="sm"
            className="min-w-0"
          >
            <GlobeIcon data-icon="inline-start" />
            <span className="truncate">{new URL(url).host}</span>
          </ButtonLink>
        ) : null}
        {deployed ? (
          dockhandUrl ? (
            <ButtonLink
              href={`${dockhandUrl}/stacks`}
              variant="outline"
              size="sm"
            >
              <ExternalLinkIcon data-icon="inline-start" />
              Open in Dockhand
            </ButtonLink>
          ) : null
        ) : (
          <DeployButton template={template.id} />
        )}
      </CardFooter>
    </Card>
  )
}
