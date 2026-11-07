import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
} from '@tanstack/react-router'
import type { RouteComponent } from '@tanstack/react-router'
import { ErrorPage } from '#ui/features/error-page/error-page'
import { AppShell } from '#ui/features/layout/app-shell'
import { OverviewPage } from '#ui/features/overview/overview-page'
import { ProfilesPage } from '#ui/features/profiles/profiles-page'
import { RoutesPage } from '#ui/features/routes/routes-page'
import { CatalogPage } from '#ui/features/tools/catalog-page'

const rootRoute = createRootRoute({
  component: AppShell,
  // An unknown path, such as an old bookmark: back to the overview
  notFoundComponent: () => <Navigate to="/" replace />,
  // The shell itself broke: the error page alone, on the shell's canvas
  errorComponent: (props) => (
    <div className="bg-muted dark:bg-background flex min-h-svh p-4">
      <ErrorPage {...props} />
    </div>
  ),
})

// A page that throws shows the error page in its place, in the shell
const page = (path: string, component: RouteComponent) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component,
    errorComponent: ErrorPage,
  })

const routeTree = rootRoute.addChildren([
  page('/', OverviewPage),
  page('/profiles', ProfilesPage),
  page('/docker', RoutesPage),
  page('/tools', CatalogPage),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
