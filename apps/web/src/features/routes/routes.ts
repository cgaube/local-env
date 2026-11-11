import type { Route } from '#ui/features/live-data/live-data.ts'

// local-env's own services are listed on the overview
export const CORE_STACK = 'local-env'

export const userRoutes = (routes: Route[]) =>
  routes.filter((route) => route.stack !== CORE_STACK)
