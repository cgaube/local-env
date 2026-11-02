import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render } from '@testing-library/react'
import { TooltipProvider } from '#ui/components/ui/tooltip'
import { createLiveDataStore } from '#ui/features/live-data/live-data.ts'
import { LiveDataProvider } from '#ui/features/live-data/live-data-provider'
import { ThemeProvider } from '#ui/features/theme/theme-provider'
import { router } from '#ui/router.tsx'
import { FakeEventSource } from './fake-event-source.ts'

// The whole app at a path, with the data of a fake event stream. The domain
// is already loaded: no request leaves the test.
export const renderApp = async (path = '/') => {
  const events = new FakeEventSource()
  const store = createLiveDataStore(() => events as unknown as EventSource)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(['config'], { domain: 'dev.test' })
  const testRouter = createRouter({
    routeTree: router.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <LiveDataProvider store={store}>
          <TooltipProvider>
            <RouterProvider router={testRouter} />
          </TooltipProvider>
        </LiveDataProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  // The router renders the page once it loaded: inside act, so the state
  // the page sets on mount (the sidebar's) is applied before the test goes on
  await act(() => testRouter.load())
  return { events, router: testRouter }
}
