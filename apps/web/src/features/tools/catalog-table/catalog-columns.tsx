import { createColumnHelper } from '@tanstack/react-table'
import { ArrowUpDownIcon, ContainerIcon } from 'lucide-react'
import { use } from 'react'
import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'
import { Switch } from '#ui/components/ui/switch'
import { ToolStatusBadge } from '#ui/features/tools/tool-status-badge'
import { type CatalogRow, stackName } from '#ui/features/tools/tools.ts'
import type { CatalogFeatures } from '#ui/features/tools/catalog-table/catalog-features.ts'
import { PickContext } from '#ui/features/tools/catalog-table/pick-context.ts'

const column = createColumnHelper<CatalogFeatures, CatalogRow>()

function PickSwitch({ tool }: { tool: CatalogRow }) {
  const onPick = use(PickContext)
  const included = tool.includedBy.length > 0 || tool.inProfile !== null
  return (
    // The switch's click area reaches 12px past it: past the cell's padding,
    // it would overflow the table and keep a horizontal scrollbar on
    <div className="flex justify-end px-1.5">
      <Switch
        aria-label={`Install ${tool.label}`}
        // A picked role or the profile includes it: it is installed with them
        checked={tool.picked || included}
        disabled={included}
        onCheckedChange={(on) => onPick(tool.id, on)}
      />
    </div>
  )
}

export const catalogColumns = column.columns([
  // Searched by its name, description and tags
  column.accessor(
    (tool) => [tool.label, tool.name, tool.description, ...tool.tags].join(' '),
    {
      id: 'tool',
      enableHiding: false,
      filterFn: 'includesString',
      sortFn: 'text',
      header: ({ column: header }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => header.toggleSorting()}
        >
          Tool
          <ArrowUpDownIcon data-icon="inline-end" />
        </Button>
      ),
      cell: ({ row: { original: tool } }) => (
        <div className="flex flex-col gap-1 whitespace-normal">
          <span className="font-medium">{tool.label}</span>
          {tool.description ? (
            <span className="text-muted-foreground text-xs">
              {tool.description}
            </span>
          ) : null}
          {tool.inProfile ? (
            <span className="text-muted-foreground text-xs">
              In the {tool.inProfile} profile
            </span>
          ) : tool.includedBy.length > 0 ? (
            <span className="text-muted-foreground text-xs">
              Included in {tool.includedBy.join(', ')}
            </span>
          ) : null}
          {tool.stacks.length > 0 ? (
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <ContainerIcon className="size-3" />
              Needs the{' '}
              {tool.stacks
                .map((stack) => stackName(stack, tool.source))
                .join(', ')}{' '}
              {tool.stacks.length === 1 ? 'stack' : 'stacks'}
            </span>
          ) : null}
          {tool.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tool.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ),
    },
  ),
  // The role's Ansible name, as dependencies name it:
  // <namespace>.<collection>.<role>
  column.accessor('name', {
    id: 'role',
    sortFn: 'text',
    header: ({ column: header }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => header.toggleSorting()}
      >
        Role
        <ArrowUpDownIcon data-icon="inline-end" />
      </Button>
    ),
    cell: ({ getValue }) => (
      <code className="text-muted-foreground font-mono text-xs break-all whitespace-normal">
        {getValue()}
      </code>
    ),
  }),
  column.accessor('source', {
    filterFn: 'oneOf',
    sortFn: 'text',
    header: 'Source',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue()}</span>
    ),
  }),
  // Never shown (the tool column shows them): the tag filter
  column.accessor('tags', {
    enableHiding: false,
    enableSorting: false,
    filterFn: 'arrIncludesSome',
    // Each tag counts in the filter, not the list
    getUniqueValues: (tool) => tool.tags,
  }),
  // A value for every row, so the status filter can pick the tools that are
  // neither picked nor installed
  column.accessor((tool) => tool.status ?? 'available', {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    filterFn: 'oneOf',
    cell: ({ row: { original: tool } }) =>
      tool.status ? <ToolStatusBadge status={tool.status} /> : null,
  }),
  column.display({
    id: 'pick',
    enableHiding: false,
    header: () => <span className="sr-only">Install</span>,
    cell: ({ row }) => <PickSwitch tool={row.original} />,
  }),
])
