import type { Route } from '#ui/features/live-data/live-data.ts'

// local-env's own services are listed on the overview
export const CORE_STACK = 'local-env'

export const userRoutes = (routes: Route[]) =>
  routes.filter((route) => route.stack !== CORE_STACK)

// Matches any host, the container or the stack
export const filterRoutes = (routes: Route[], query: string) => {
  const needle = query.trim().toLowerCase()
  if (!needle) return routes
  return routes.filter((route) =>
    [...route.hosts, route.container, route.stack ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
}
