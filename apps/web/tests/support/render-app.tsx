import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render } from '@testing-library/react'
import { TooltipProvider } from '#ui/components/ui/tooltip'
import { createLiveDataStore } from '#ui/features/live-data/live-data.ts'
import { LiveDataProvider } from '#ui/features/live-data/live-data-provider'
import { ThemeProvider } from '#ui/features/theme/theme-provider'
import { createAppRouter } from '#ui/router.tsx'
import { FakeEventSource } from '#ui-tests/support/fake-event-source.ts'
import type { LoginsResponse } from '#services/dashboard/agent-protocol.ts'
import type { StacksResponse } from '#services/dashboard/catalog.ts'

// The whole app at a path, with the data of a fake event stream. The domain,
// the latest version, the logins and Dockhand's stacks are already loaded,
// and stay fresh: no request leaves the test, unless it refetches (a refresh
// button, a deploy that ends).
export const renderApp = async (
  path = '/',
  {
    latestVersion = null,
    logins = { available: true, logins: [] },
    stacks = { available: true, stacks: [] },
  }: {
    latestVersion?: string | null
    logins?: LoginsResponse
    stacks?: StacksResponse
  } = {},
) => {
  const events = new FakeEventSource()
  const store = createLiveDataStore(() => events as unknown as EventSource)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(['config'], { domain: 'dev.test' })
  queryClient.setQueryData(['latest-version'], latestVersion)
  queryClient.setQueryData(['logins'], logins)
  queryClient.setQueryData(['stacks'], stacks)
  const testRouter = createAppRouter({
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
