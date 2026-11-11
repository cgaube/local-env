import {
  ContainerIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LockIcon,
  TextCursorInputIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '#ui/components/ui/badge'
import { buttonVariants } from '#ui/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import { appUrls } from '#services/dashboard/catalog.ts'
import { DeployButton } from '#ui/features/docker/deploy-button'
import { ExternalLink } from '#ui/features/links/external-link'
import type { CatalogTemplate } from '#ui/features/live-data/live-data.ts'

// What a deploy needs from the user: each with its icon
const needsOf = ({ variables, secrets, registries }: CatalogTemplate) =>
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
    registries.length > 0
      ? {
          icon: LockIcon,
          text: `Private images: your ${registries.join(', ')} login`,
        }
      : null,
  ].filter((need): need is { icon: LucideIcon; text: string } => need !== null)

// A template of the sources: what it is and what a deploy needs, then
// Deploy, or its address and a link to its stack in Dockhand once deployed
// (deployed: null while Dockhand is asked, or when it can't be)
export function TemplateCard({
  template,
  deployed,
  domain,
}: {
  template: CatalogTemplate
  deployed: boolean | null
  domain: string | null
}) {
  const needs = needsOf(template)
  const url = domain ? appUrls(template.hosts, domain)[0] : undefined
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
          <CardTitle className="truncate">{template.title}</CardTitle>
        </div>
        {deployed ? (
          <CardAction>
            <Badge variant="success">Deployed</Badge>
          </CardAction>
        ) : null}
        {template.description ? (
          <CardDescription className="line-clamp-3">
            {template.description}
          </CardDescription>
        ) : null}
      </CardHeader>
      {needs.length > 0 ? (
        <CardContent>
          <ul className="text-muted-foreground flex flex-col gap-1.5 text-xs">
            {needs.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <Icon className="mt-0.5 size-3.5 shrink-0" />
                <span className="break-all">{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}
      <CardFooter className="mt-auto justify-between gap-2">
        {deployed && url ? (
          <ExternalLink href={url} className="truncate text-xs">
            {url}
          </ExternalLink>
        ) : (
          <span className="text-muted-foreground truncate text-xs">
            {template.id}
          </span>
        )}
        {deployed ? (
          dockhandUrl ? (
            <a
              href={`${dockhandUrl}/stacks`}
              target="_blank"
              rel="noopener"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              Open in Dockhand
            </a>
          ) : null
        ) : (
          <DeployButton template={template.id} />
        )}
      </CardFooter>
    </Card>
  )
}
