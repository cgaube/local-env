import { useQuery } from '@tanstack/react-query'
import type { StacksResponse } from '#services/dashboard/catalog.ts'
import type { CatalogTemplate } from '#ui/features/live-data/live-data.ts'

// The names of the stacks in Dockhand, to show which templates are deployed.
// Asked when the page opens and after a deploy, never on a timer.
export const useStacks = () =>
  useQuery({
    queryKey: ['stacks'],
    queryFn: async () => {
      const response = await fetch('/api/stacks')
      if (!response.ok) throw new Error(`/api/stacks: ${response.status}`)
      return (await response.json()) as StacksResponse
    },
    refetchOnWindowFocus: false,
    retry: false,
  })

export type TemplateStatus = 'deployed' | 'not-deployed'

export const STATUS_LABELS: Record<TemplateStatus, string> = {
  deployed: 'Deployed',
  'not-deployed': 'Not deployed',
}

// The filters of the catalog: none picked in a facet keeps every template
export type TemplateFilters = {
  query: string
  sources: string[]
  categories: string[]
  statuses: TemplateStatus[]
}

export const NO_FILTERS: TemplateFilters = {
  query: '',
  sources: [],
  categories: [],
  statuses: [],
}

// null while Dockhand is asked, or when it can't be: no status then
const statusOf = (
  template: CatalogTemplate,
  deployed: Set<string> | null,
): TemplateStatus | null =>
  deployed ? (deployed.has(template.name) ? 'deployed' : 'not-deployed') : null

type Facet = 'sources' | 'categories' | 'statuses'

const matches = (
  template: CatalogTemplate,
  filters: TemplateFilters,
  deployed: Set<string> | null,
  skip?: Facet,
) => {
  const needle = filters.query.trim().toLowerCase()
  const status = statusOf(template, deployed)
  return (
    (!needle ||
      [
        template.title,
        template.description,
        template.id,
        ...template.categories,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)) &&
    (skip === 'sources' ||
      filters.sources.length === 0 ||
      filters.sources.includes(template.source)) &&
    (skip === 'categories' ||
      filters.categories.length === 0 ||
      template.categories.some((category) =>
        filters.categories.includes(category),
      )) &&
    (skip === 'statuses' ||
      filters.statuses.length === 0 ||
      (status !== null && filters.statuses.includes(status)))
  )
}

// Matches the search (title, description, id, a category) and each facet
export const filterTemplates = (
  templates: CatalogTemplate[],
  filters: TemplateFilters,
  deployed: Set<string> | null,
) => templates.filter((template) => matches(template, filters, deployed))

// The values of a facet, each with the number of templates that have it
// among those the other filters keep
export const facetOptions = (
  templates: CatalogTemplate[],
  filters: TemplateFilters,
  deployed: Set<string> | null,
  facet: Facet,
) => {
  const valuesOf = (template: CatalogTemplate): string[] => {
    if (facet === 'sources') return [template.source]
    if (facet === 'categories') return template.categories
    const status = statusOf(template, deployed)
    return status ? [status] : []
  }
  const all = [...new Set(templates.flatMap(valuesOf))]
  const kept = templates.filter((template) =>
    matches(template, filters, deployed, facet),
  )
  const counts = new Map<string, number>()
  for (const value of kept.flatMap(valuesOf)) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const ordered =
    facet === 'statuses'
      ? Object.keys(STATUS_LABELS).filter((status) => all.includes(status))
      : all.toSorted()
  return ordered.map((value) => ({
    value,
    ...(facet === 'statuses'
      ? { label: STATUS_LABELS[value as TemplateStatus] }
      : {}),
    count: counts.get(value) ?? 0,
  }))
}
