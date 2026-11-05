import {
  createColumnHelper,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  useTable,
} from '@tanstack/react-table'
import { ArrowUpDownIcon, CheckIcon, SearchIcon } from 'lucide-react'
import { createContext, use, useState } from 'react'
import { Button } from '#ui/components/ui/button'
import { Card, CardContent } from '#ui/components/ui/card'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#ui/components/ui/input-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table'
import type { ProfileRow } from '#ui/features/profiles/profiles.ts'
import {
  type CatalogFeatures,
  catalogFeatures,
} from '#ui/features/tools/catalog-table/catalog-features.ts'
import { FacetedFilter } from '#ui/features/tools/faceted-filter'
import { TablePagination } from '#ui/features/tools/table-pagination'
import { plural } from '#ui/lib/plural.ts'
import { cn } from '#ui/lib/utils.ts'

// What a row's buttons do, for the columns that render them
const ActionsContext = createContext<{
  open: (id: string) => void
  pick: (id: string) => void
}>({ open: () => {}, pick: () => {} })

const column = createColumnHelper<CatalogFeatures, ProfileRow>()

const columns = column.columns([
  // Searched by its name and description
  column.accessor(
    (profile) => [profile.label, profile.name, profile.description].join(' '),
    {
      id: 'profile',
      filterFn: 'includesString',
      sortFn: 'text',
      header: ({ column: header }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => header.toggleSorting()}
        >
          Profile
          <ArrowUpDownIcon data-icon="inline-end" />
        </Button>
      ),
      // A checkmark before your profile; the others keep its room, so the
      // names line up
      cell: ({ row: { original: profile } }) => (
        <div className="flex items-center gap-2 whitespace-normal">
          <span className="text-primary flex size-5 shrink-0 items-center justify-center">
            {profile.current ? (
              <>
                <CheckIcon aria-hidden="true" />
                <span className="sr-only">Your profile</span>
              </>
            ) : null}
          </span>
          <div className="flex flex-col gap-1">
            <span className="font-medium">{profile.label}</span>
            {profile.description ? (
              <span className="text-muted-foreground text-xs">
                {profile.description}
              </span>
            ) : null}
          </div>
        </div>
      ),
    },
  ),
  column.accessor('source', {
    filterFn: 'oneOf',
    sortFn: 'text',
    header: 'Source',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue()}</span>
    ),
  }),
  column.display({
    id: 'tools',
    header: 'Tools',
    cell: ({ row: { original: profile } }) => (
      <span className="text-muted-foreground">
        {plural(profile.tools.length, 'tool')}
      </span>
    ),
  }),
  column.display({
    id: 'stacks',
    header: 'Stacks',
    // A count: a profile can need many. Details lists them.
    cell: ({ row: { original: profile } }) => (
      <span className="text-muted-foreground">
        {profile.stackStates.length > 0
          ? plural(profile.stackStates.length, 'stack')
          : 'None'}
      </span>
    ),
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    cell: function ActionsCell({ row: { original: profile } }) {
      const { open, pick } = use(ActionsContext)
      return (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Details of ${profile.label}`}
            onClick={() => open(profile.id)}
          >
            Details
          </Button>
          {/* Your profile's row is marked: nothing to use */}
          {profile.current ? null : (
            <Button
              size="sm"
              variant="outline"
              aria-label={`Use ${profile.label}`}
              onClick={() => pick(profile.id)}
            >
              Use
            </Button>
          )}
        </div>
      )
    },
  }),
])

// Every profile of the sources, hundreds included: searched, filtered by
// source, in pages
export function ProfilesTable({
  rows,
  onOpen,
  onPick,
}: {
  rows: ProfileRow[]
  onOpen: (id: string) => void
  onPick: (id: string) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'profile', desc: false },
  ])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  })
  const table = useTable({
    features: catalogFeatures,
    data: rows,
    columns,
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    // New filters show their first page
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater)
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    onPaginationChange: setPagination,
    // The rows are new on every live update: the page stays
    autoResetPageIndex: false,
    state: { sorting, columnFilters, pagination },
  })

  const pageCount = table.getPageCount()
  if (pagination.pageIndex > 0 && pagination.pageIndex >= pageCount) {
    setPagination({ ...pagination, pageIndex: Math.max(pageCount - 1, 0) })
  }
  const matching = table.getFilteredRowModel().rows.length
  const search = table.getColumn('profile')
  const query = (search?.getFilterValue() as string | undefined) ?? ''
  const source = table.getColumn('source')
  const pickedSources = (source?.getFilterValue() as string[] | undefined) ?? []
  const sourceCounts = source?.getFacetedUniqueValues() ?? new Map()
  const visible = table.getRowModel().rows

  return (
    <div className="flex flex-col gap-3">
      <Card className="py-0">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <InputGroup className="w-full sm:w-72">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder="Filter by name, description…"
              aria-label="Filter profiles"
              value={query}
              onChange={(event) => search?.setFilterValue(event.target.value)}
            />
          </InputGroup>
          <FacetedFilter
            title="Source"
            options={[...new Set([...pickedSources, ...sourceCounts.keys()])]
              .sort()
              .map((value) => ({
                value,
                count: sourceCounts.get(value) ?? 0,
              }))}
            picked={pickedSources}
            onChange={(values) => source?.setFilterValue(values)}
          />
          <span className="text-muted-foreground ml-auto text-sm">
            {matching === rows.length
              ? plural(rows.length, 'profile')
              : `${matching} of ${plural(rows.length, 'profile')}`}
          </span>
        </CardContent>
      </Card>

      <Card className="py-0">
        <ActionsContext value={{ open: onOpen, pick: onPick }}>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {visible.length > 0 ? (
                visible.map((row) => (
                  <TableRow
                    key={row.id}
                    // Your profile: a selected row, tinted with the brand's
                    // purple, which stands out from the muted page
                    data-state={row.original.current ? 'selected' : undefined}
                    className={cn(
                      row.original.current &&
                        'data-[state=selected]:bg-primary/10 hover:bg-primary/15',
                    )}
                    aria-current={row.original.current ? 'true' : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={table.getVisibleLeafColumns().length}
                    className="text-muted-foreground h-24 text-center"
                  >
                    No profiles match the filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ActionsContext>
      </Card>
      <TablePagination
        page={pagination.pageIndex}
        pageCount={pageCount}
        pageSize={pagination.pageSize}
        onPageChange={(page) => table.setPageIndex(page)}
        onPageSizeChange={(size) =>
          setPagination({ pageIndex: 0, pageSize: size })
        }
      />
    </div>
  )
}
