import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table'
import { CopyButton } from '#ui/features/copy/copy-button'
import type { Route } from '#ui/features/live-data/live-data.ts'
import { StatusBadge } from '#ui/features/status/status-badge'
import { ExternalLink } from '#ui/features/links/external-link'

export function RoutesTable({ routes }: { routes: Route[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>URL</TableHead>
          <TableHead>Container</TableHead>
          <TableHead>Stack</TableHead>
          <TableHead>Port</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {routes.map((route) => (
          <TableRow key={route.url}>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <ExternalLink href={route.url} className="font-medium">
                  {route.url}
                </ExternalLink>
                {route.hosts.slice(1).map((host) => (
                  <span key={host} className="text-muted-foreground text-xs">
                    {host}
                  </span>
                ))}
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {route.container}
            </TableCell>
            <TableCell className={route.stack ? '' : 'text-muted-foreground'}>
              {route.stack ?? '—'}
            </TableCell>
            <TableCell className="font-mono text-xs">{route.port}</TableCell>
            <TableCell>
              <StatusBadge state={route.status} />
            </TableCell>
            <TableCell className="text-right">
              <CopyButton text={route.url} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
