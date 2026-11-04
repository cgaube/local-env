import {
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
  useTable,
} from '@tanstack/react-table'
import { SearchIcon } from 'lucide-react'
import { useState } from 'react'
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
import { plural } from '#ui/lib/plural.ts'
import { ColumnsMenu } from '#ui/features/tools/columns-menu'
import { FacetedFilter } from '#ui/features/tools/faceted-filter'
import { type FilterChip, FilterChips } from '#ui/features/tools/filter-chips'
import { TablePagination } from '#ui/features/tools/table-pagination'
import { type CatalogRow, STATUS_LABELS } from '#ui/features/tools/tools.ts'
import { catalogColumns } from '#ui/features/tools/catalog-table/catalog-columns.tsx'
import { catalogFeatures } from '#ui/features/tools/catalog-table/catalog-features.ts'
import { PickContext } from '#ui/features/tools/catalog-table/pick-context.ts'

// The switch's column as narrow as it gets. The status one as wide as its
// longest badge: the columns don't move when a switch changes the status.
const HEADER_WIDTHS: Record<string, string> = { pick: 'w-0', status: 'w-52' }

export function CatalogTable({
  rows,
  onPick,
}: {
  rows: CatalogRow[]
  onPick: (id: string, on: boolean) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'tool', desc: false },
  ])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] =
    // The installed date is there to sort by: shown from the Columns menu
    useState<ColumnVisibilityState>({ tags: false, installed: false })
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  })
  const table = useTable({
    features: catalogFeatures,
    data: rows,
    columns: catalogColumns,
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    // New filters show their first page
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater)
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    // The rows are new on every live update: a switch flipped on page 2
    // stays on page 2
    autoResetPageIndex: false,
    state: { sorting, columnFilters, columnVisibility, pagination },
  })

  // Fewer rows than before (a source removed): back to the last page
  const pageCount = table.getPageCount()
  if (pagination.pageIndex > 0 && pagination.pageIndex >= pageCount) {
    setPagination({ ...pagination, pageIndex: Math.max(pageCount - 1, 0) })
  }
  const matching = table.getFilteredRowModel().rows.length

  const search = table.getColumn('tool')
  const query = (search?.getFilterValue() as string | undefined) ?? ''
  const visible = table.getRowModel().rows

  // A column's values and their counts, picked ones first. A picked value the
  // other filters leave no row of stays, with 0, so it can be unpicked.
  // With labels: the values they name, in their order
  const facet = (
    id: 'source' | 'tags' | 'status',
    labels?: Record<string, string>,
  ) => {
    const column = table.getColumn(id)
    const picked = (column?.getFilterValue() as string[] | undefined) ?? []
    const counts = column?.getFacetedUniqueValues() ?? new Map()
    const found = new Set([...picked, ...counts.keys()])
    const values = labels
      ? Object.keys(labels).filter((value) => found.has(value))
      : [...found].sort()
    return {
      picked,
      options: values.map((value) => ({
        value,
        label: labels?.[value] ?? value,
        count: counts.get(value) ?? 0,
      })),
      label: (value: string) => labels?.[value] ?? value,
      setPicked: (values: string[]) => column?.setFilterValue(values),
    }
  }
  const sources = facet('source')
  const tags = facet('tags')
  const statuses = facet('status', STATUS_LABELS)

  const chips: FilterChip[] = [
    ...(query
      ? [
          {
            label: 'Search',
            value: query,
            remove: () => search?.setFilterValue(''),
          },
        ]
      : []),
    ...[
      { name: 'Source', ...sources },
      { name: 'Tag', ...tags },
      { name: 'Status', ...statuses },
    ].flatMap(({ name, label, picked, setPicked }) =>
      picked.map((value) => ({
        label: name,
        value: label(value),
        remove: () => setPicked(picked.filter((other) => other !== value)),
      })),
    ),
  ]

  return (
    <div className="flex flex-col gap-3">
      <Card className="py-0">
        <CardContent className="flex flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="w-full sm:w-72">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                placeholder="Filter by name, description, tag…"
                aria-label="Filter tools"
                value={query}
                onChange={(event) => search?.setFilterValue(event.target.value)}
              />
            </InputGroup>
            <FacetedFilter
              title="Source"
              options={sources.options}
              picked={sources.picked}
              onChange={sources.setPicked}
            />
            {tags.options.length > 0 ? (
              <FacetedFilter
                title="Tags"
                options={tags.options}
                picked={tags.picked}
                onChange={tags.setPicked}
              />
            ) : null}
            <FacetedFilter
              title="Status"
              options={statuses.options}
              picked={statuses.picked}
              onChange={statuses.setPicked}
            />
            <span className="text-muted-foreground ml-auto text-sm">
              {matching === rows.length
                ? plural(rows.length, 'tool')
                : `${matching} of ${plural(rows.length, 'tool')}`}
            </span>
            <ColumnsMenu
              columns={table
                .getAllLeafColumns()
                .filter((column) => column.getCanHide())
                .map((column) => ({
                  id: column.id,
                  visible: column.getIsVisible(),
                  toggle: (on: boolean) => column.toggleVisibility(on),
                }))}
            />
          </div>
          <FilterChips
            chips={chips}
            onClear={() => table.resetColumnFilters()}
          />
        </CardContent>
      </Card>

      <Card className="py-0">
        <PickContext value={onPick}>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={HEADER_WIDTHS[header.id]}
                    >
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
                  <TableRow key={row.id}>
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
                    No tools match the filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PickContext>
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
