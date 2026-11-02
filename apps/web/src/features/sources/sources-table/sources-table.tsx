import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table'
import type { Source } from '#ui/features/live-data/live-data.ts'
import { plural } from '#ui/lib/plural.ts'

const Count = ({ total, word }: { total: number; word: string }) => (
  <TableCell className={total ? '' : 'text-muted-foreground'}>
    {total ? plural(total, word) : '—'}
  </TableCell>
)

export function SourcesTable({ sources }: { sources: Source[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead>Docker templates</TableHead>
          <TableHead>Ansible roles</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sources.map((source) => (
          <TableRow key={source.name}>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{source.name}</span>
                {source.origin ? (
                  <span className="text-muted-foreground text-xs">
                    {source.origin}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <Count total={source.docker} word="template" />
            <Count total={source.ansible} word="role" />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
