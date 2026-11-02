import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table'
import type { Service } from '#ui/features/live-data/live-data.ts'
import { StatusBadge } from '#ui/features/status/status-badge'
import { ExternalLink } from '#ui/features/links/external-link'

export function CoreServicesTable({ services }: { services: Service[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Service</TableHead>
          <TableHead>Container</TableHead>
          <TableHead>URL</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {services.map((service) => (
          <TableRow key={service.service}>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{service.service}</span>
                {service.description ? (
                  <span className="text-muted-foreground text-xs whitespace-normal">
                    {service.description}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {service.container}
            </TableCell>
            <TableCell>
              {service.url ? (
                <ExternalLink href={service.url}>{service.url}</ExternalLink>
              ) : (
                <span className="text-muted-foreground">
                  {service.ports.length
                    ? `ports ${service.ports.join(', ')}`
                    : '—'}
                </span>
              )}
            </TableCell>
            <TableCell>
              <StatusBadge state={service.state} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
