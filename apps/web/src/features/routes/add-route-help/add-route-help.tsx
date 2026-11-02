import { ChevronRightIcon } from 'lucide-react'
import { Button } from '#ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#ui/components/ui/collapsible'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import { ExternalLink } from '#ui/features/links/external-link'

const Code = ({ children }: { children: string }) => (
  <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
    {children}
  </code>
)

// How to serve a container at https://<name>.<domain>. Open by default while
// there is no route yet.
export function AddRouteHelp({
  domain = '<domain>',
  defaultOpen,
}: {
  domain?: string
  defaultOpen: boolean
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="group/collapsible"
      render={<Card />}
    >
      <CardHeader>
        <CardTitle>Add a route</CardTitle>
        <CardDescription>
          Serve any container at https://&lt;name&gt;.{domain}
        </CardDescription>
        <CollapsibleTrigger
          render={
            <Button variant="ghost" size="sm" className="justify-self-start" />
          }
        >
          <ChevronRightIcon
            data-icon="inline-start"
            className="transition-transform group-data-open/collapsible:rotate-90"
          />
          How
        </CollapsibleTrigger>
      </CardHeader>
      <CollapsibleContent>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p>
            Set <Code>VIRTUAL_HOST</Code> on the container, and{' '}
            <Code>VIRTUAL_PORT</Code> if the app doesn't listen on port 80 and
            its image exposes more than one port. The route shows up here a
            second after the container starts.
          </p>

          <h3 className="font-medium">Docker Compose</h3>
          <CodeSnippet
            code={`services:
  app:
    image: my-app
    environment:
      VIRTUAL_HOST: myapp   # https://myapp.${domain}
      VIRTUAL_PORT: 3000    # the port the app listens on`}
          />

          <h3 className="font-medium">docker run</h3>
          <CodeSnippet code="docker run -d --name myapp -e VIRTUAL_HOST=myapp -e VIRTUAL_PORT=3000 my-app" />

          <h3 className="font-medium">Dockhand</h3>
          <p>
            Open the stack in{' '}
            <ExternalLink href={`https://docker.${domain}`}>
              Dockhand
            </ExternalLink>
            , add <Code>VIRTUAL_HOST</Code> (and <Code>VIRTUAL_PORT</Code>) to
            the service's environment, then redeploy.
          </p>

          <h3 className="font-medium">Good to know</h3>
          <ul className="text-muted-foreground flex list-disc flex-col gap-2 pl-5">
            <li>
              No <Code>ports</Code> or <Code>networks</Code> needed: local-env
              connects the container to the proxy for you.
            </li>
            <li>
              A short name gets the domain: <Code>myapp</Code> becomes{' '}
              <Code>{`myapp.${domain}`}</Code>. A full hostname is used as is.
            </li>
            <li>
              Several hosts: separate them with commas, as in{' '}
              <Code>VIRTUAL_HOST: myapp,api</Code>.
            </li>
            <li>
              The app must listen on <Code>0.0.0.0</Code>, not{' '}
              <Code>localhost</Code>, so the proxy can reach it.
            </li>
            <li>
              Containers with a route can call each other's URLs, such as{' '}
              <Code>{`https://api.${domain}`}</Code>. To trust the certificate,
              mount the local CA and point <Code>SSL_CERT_FILE</Code> (or{' '}
              <Code>NODE_EXTRA_CA_CERTS</Code>) at it:{' '}
              <Code>
                {
                  '"${HOST_HOME}/Library/Application Support/mkcert/rootCA.pem:/etc/local-env/ca.pem:ro"'
                }
              </Code>
              .
            </li>
          </ul>
        </CardContent>
      </CollapsibleContent>
    </Collapsible>
  )
}
