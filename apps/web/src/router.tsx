import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
} from '@tanstack/react-router'
import type { RouteComponent } from '@tanstack/react-router'
import { AppShell } from '#ui/features/layout/app-shell'
import { OverviewPage } from '#ui/features/overview/overview-page'
import { RoutesPage } from '#ui/features/routes/routes-page'
import { SourcesPage } from '#ui/features/sources/sources-page'
import { CatalogPage } from '#ui/features/tools/catalog-page'
import { InstalledPage } from '#ui/features/tools/installed-page'

const rootRoute = createRootRoute({
  component: AppShell,
  // An unknown path, such as an old bookmark: back to the overview
  notFoundComponent: () => <Navigate to="/" replace />,
})

const page = (path: string, component: RouteComponent) =>
  createRoute({ getParentRoute: () => rootRoute, path, component })

const routeTree = rootRoute.addChildren([
  page('/', OverviewPage),
  page('/docker/routes', RoutesPage),
  page('/tools/catalog', CatalogPage),
  page('/tools/installed', InstalledPage),
  page('/sources', SourcesPage),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
