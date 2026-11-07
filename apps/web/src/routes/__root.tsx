import { createRootRoute, Navigate } from '@tanstack/react-router'
import { ErrorPage } from '#ui/features/error-page/error-page'
import { AppShell } from '#ui/features/layout/app-shell'

export const Route = createRootRoute({
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
