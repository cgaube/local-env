import { createRouter } from '@tanstack/react-router'
import type { RouterHistory } from '@tanstack/react-router'
import { ErrorPage } from '#ui/features/error-page/error-page'
import { routeTree } from '#ui/routeTree.gen.ts'

// The routes are the files of routes/: the Vite plugin generates
// routeTree.gen.ts from them. The tests build theirs here too, with a
// memory history, so they get the same options.
export const createAppRouter = ({
  history,
}: { history?: RouterHistory } = {}) =>
  createRouter({
    routeTree,
    history,
    // A page that throws shows the error page in its place, in the shell
    defaultErrorComponent: ErrorPage,
  })

export const router = createAppRouter()

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
