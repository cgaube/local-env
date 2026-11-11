import { ContainerIcon, SearchIcon } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { Alert, AlertDescription } from '#ui/components/ui/alert'
import { Card, CardContent } from '#ui/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#ui/components/ui/input-group'
import { Skeleton } from '#ui/components/ui/skeleton'
import { useDomain } from '#ui/features/config/use-domain.ts'
import {
  facetOptions,
  filterTemplates,
  NO_FILTERS,
  STATUS_LABELS,
  type TemplateFilters,
  type TemplateStatus,
  templateStates,
} from '#ui/features/docker/docker.ts'
import { TemplateCard } from '#ui/features/docker/template-card'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { FacetedFilter } from '#ui/features/tools/faceted-filter'
import { type FilterChip, FilterChips } from '#ui/features/tools/filter-chips'
import { TablePagination } from '#ui/features/tools/table-pagination'
import { plural } from '#ui/lib/plural.ts'

// The templates of every source as cards, filtered and paged like the Tools
// table, each with Deploy, or Running or Stopped once Dockhand has a stack of
// its name
export function TemplatesPanel() {
  const { templates, routes, stacks } = useLiveData()
  const domain = useDomain()
  const [filters, setFilters] = useState<TemplateFilters>(NO_FILTERS)
  const query = useDeferredValue(filters.query)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  if (!templates) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (templates.length === 0) {
    return (
      <Card className="py-0">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ContainerIcon />
            </EmptyMedia>
            <EmptyTitle>No templates yet</EmptyTitle>
            <EmptyDescription>
              Your sources have no Docker templates. Add a source: local-env
              sources add &lt;repo&gt;
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    )
  }

  const states = templateStates(
    templates,
    stacks?.available ? stacks.stacks : null,
    routes,
  )
  const applied = { ...filters, query }
  const matching = filterTemplates(templates, applied, states)
  const pageCount = Math.max(Math.ceil(matching.length / pageSize), 1)
  // A filter that leaves fewer pages shows the last one
  const current = Math.min(page, pageCount - 1)
  const visible = matching.slice(current * pageSize, (current + 1) * pageSize)

  // Any filter change starts again at the first page
  const change = (patch: Partial<TemplateFilters>) => {
    setFilters((previous) => ({ ...previous, ...patch }))
    setPage(0)
  }
  const facet = (name: 'sources' | 'categories' | 'statuses') =>
    facetOptions(templates, applied, states, name)
  const categories = facet('categories')
  const chips: FilterChip[] = [
    ...(filters.query
      ? [
          {
            label: 'Search',
            value: filters.query,
            remove: () => change({ query: '' }),
          },
        ]
      : []),
    ...filters.sources.map((value) => ({
      label: 'Source',
      value,
      remove: () =>
        change({ sources: filters.sources.filter((other) => other !== value) }),
    })),
    ...filters.categories.map((value) => ({
      label: 'Category',
      value,
      remove: () =>
        change({
          categories: filters.categories.filter((other) => other !== value),
        }),
    })),
    ...filters.statuses.map((value) => ({
      label: 'Status',
      value: STATUS_LABELS[value],
      remove: () =>
        change({
          statuses: filters.statuses.filter((other) => other !== value),
        }),
    })),
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
                placeholder="Filter by name, description, category…"
                aria-label="Filter templates"
                value={filters.query}
                onChange={(event) => change({ query: event.target.value })}
              />
            </InputGroup>
            <FacetedFilter
              title="Source"
              options={facet('sources')}
              picked={filters.sources}
              onChange={(sources) => change({ sources })}
            />
            {categories.length > 0 ? (
              <FacetedFilter
                title="Category"
                options={categories}
                picked={filters.categories}
                onChange={(picked) => change({ categories: picked })}
              />
            ) : null}
            {states ? (
              <FacetedFilter
                title="Status"
                options={facet('statuses')}
                picked={filters.statuses}
                onChange={(statuses) =>
                  change({ statuses: statuses as TemplateStatus[] })
                }
              />
            ) : null}
            <span className="text-muted-foreground ml-auto text-sm">
              {matching.length === templates.length
                ? plural(templates.length, 'template')
                : `${matching.length} of ${plural(templates.length, 'template')}`}
            </span>
          </div>
          <FilterChips chips={chips} onClear={() => change(NO_FILTERS)} />
        </CardContent>
      </Card>

      {stacks && !stacks.available ? (
        <Alert>
          <AlertDescription>
            Dockhand doesn&apos;t answer: run local-env start to see which
            templates are deployed.
          </AlertDescription>
        </Alert>
      ) : null}

      {visible.length > 0 ? (
        <ul
          aria-label="Templates"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {visible.map((template) => (
            <li key={template.id} aria-label={template.title} className="flex">
              <TemplateCard
                template={template}
                state={states?.get(template.name) ?? null}
                domain={domain ?? null}
              />
            </li>
          ))}
        </ul>
      ) : (
        <Card className="py-0">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No templates match the filters</EmptyTitle>
              <EmptyDescription>
                Try another name, or remove a filter.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      )}

      <TablePagination
        page={current}
        pageCount={pageCount}
        pageSize={pageSize}
        sizeLabel="Per page"
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(0)
        }}
      />
    </div>
  )
}
