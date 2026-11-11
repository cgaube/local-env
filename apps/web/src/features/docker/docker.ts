import type { DockhandStack } from '#services/dashboard/catalog.ts'
import type {
  CatalogTemplate,
  Route,
} from '#ui/features/live-data/live-data.ts'
import { userRoutes } from '#ui/features/routes/routes.ts'

export type TemplateStatus = 'running' | 'stopped' | 'not-deployed'

export const STATUS_LABELS: Record<TemplateStatus, string> = {
  running: 'Running',
  stopped: 'Stopped',
  'not-deployed': 'Not deployed',
}

// What a template's card shows: its status, and the address of its app while
// it runs
export type TemplateState = { status: TemplateStatus; url: string | null }

// The state of each template, by its stack name: deployed when Dockhand has a
// stack of that name. A template with a VIRTUAL_HOST runs while the proxy
// routes to its stack: the routes stream live, Dockhand's list doesn't.
// Without one, Dockhand's state. null while Dockhand or the routes are
// loading, or when Dockhand doesn't answer: no status then.
export const templateStates = (
  templates: CatalogTemplate[],
  stacks: DockhandStack[] | null,
  routes: Route[] | null,
): Map<string, TemplateState> | null => {
  if (!stacks || !routes) return null
  const byName = new Map(stacks.map((stack) => [stack.name, stack]))
  const states = new Map<string, TemplateState>()
  for (const { name, hosts } of templates) {
    const stack = byName.get(name)
    const route = routes.find((candidate) => candidate.stack === name)
    states.set(
      name,
      !stack
        ? { status: 'not-deployed', url: null }
        : route
          ? { status: 'running', url: route.url }
          : hosts.length === 0 && stack.status === 'running'
            ? { status: 'running', url: null }
            : { status: 'stopped', url: null },
    )
  }
  return states
}

// The routes of what no template deployed: stacks made in Dockhand, or
// containers started by hand with a VIRTUAL_HOST. Not local-env's own.
export const otherRoutes = (routes: Route[], templates: CatalogTemplate[]) => {
  const names = new Set(templates.map(({ name }) => name))
  return userRoutes(routes).filter(
    (route) => !route.stack || !names.has(route.stack),
  )
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

type States = Map<string, TemplateState> | null

const statusOf = (template: CatalogTemplate, states: States) =>
  states?.get(template.name)?.status ?? null

type Facet = 'sources' | 'categories' | 'statuses'

const matches = (
  template: CatalogTemplate,
  filters: TemplateFilters,
  states: States,
  skip?: Facet,
) => {
  const needle = filters.query.trim().toLowerCase()
  const status = statusOf(template, states)
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
  states: States,
) => templates.filter((template) => matches(template, filters, states))

// The values of a facet, each with the number of templates that have it
// among those the other filters keep
export const facetOptions = (
  templates: CatalogTemplate[],
  filters: TemplateFilters,
  states: States,
  facet: Facet,
) => {
  const valuesOf = (template: CatalogTemplate): string[] => {
    if (facet === 'sources') return [template.source]
    if (facet === 'categories') return template.categories
    const status = statusOf(template, states)
    return status ? [status] : []
  }
  const all = [...new Set(templates.flatMap(valuesOf))]
  const kept = templates.filter((template) =>
    matches(template, filters, states, facet),
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
