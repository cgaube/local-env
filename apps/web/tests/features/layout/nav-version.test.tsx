import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarProvider } from '#ui/components/ui/sidebar'
import { Toaster } from '#ui/components/ui/sonner'
import { ThemeProvider } from '#ui/features/theme/theme-provider'
import { NavVersion } from '#ui/features/layout/nav-version'

type Build = Parameters<typeof NavVersion>[0]['build']

// The sidebar's version, the latest one already read (or not)
const renderVersion = (build: Build, latest: string | null | undefined) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (latest !== undefined) {
    queryClient.setQueryData(['latest-version'], latest)
  }
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <NavVersion build={build} />
          <Toaster />
        </SidebarProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

const release = { version: '0.2.0', kind: 'release', commit: null } as const

afterEach(() => vi.unstubAllGlobals())

describe('NavVersion', () => {
  test('shows the running and the latest version, and how to update', async () => {
    const user = userEvent.setup()
    renderVersion(release, '0.3.0')

    await user.click(screen.getByRole('button', { name: /v0\.2\.0.*Update/ }))
    expect(await screen.findByText('v0.3.0')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'How to update' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Update local-env',
    })
    expect(
      within(dialog).getByText('local-env 0.3.0 is out.', { exact: false }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('local-env update')).toBeInTheDocument()
  })

  test('says nothing about updates when this is the latest', async () => {
    const user = userEvent.setup()
    renderVersion(release, '0.2.0')

    await user.click(screen.getByRole('button', { name: /v0\.2\.0/ }))

    const menu = await screen.findByRole('menu')
    expect(screen.queryByText('Update')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'How to update' }),
    ).not.toBeInTheDocument()
    // Running and Latest
    expect(within(menu).getAllByText('v0.2.0')).toHaveLength(2)
  })

  test('checks again on request', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('class LocalEnv\n  version "0.4.0"\nend')),
    )
    renderVersion(release, null)

    await user.click(screen.getByRole('button', { name: /v0\.2\.0/ }))
    expect(await screen.findByText('Unknown')).toBeInTheDocument()
    await user.click(
      screen.getByRole('menuitem', { name: 'Check for updates' }),
    )

    expect(
      await screen.findByText('local-env 0.4.0 is out'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'How to update' }),
    ).toBeInTheDocument()
  })

  test('says in a toast when this is the latest', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('class LocalEnv\n  version "0.2.0"\nend')),
    )
    renderVersion(release, '0.2.0')

    await user.click(screen.getByRole('button', { name: /v0\.2\.0/ }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Check for updates' }),
    )

    expect(await screen.findByText("You're up to date")).toBeInTheDocument()
  })

  test('says when GitHub can not be reached', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    )
    renderVersion(release, '0.2.0')

    await user.click(screen.getByRole('button', { name: /v0\.2\.0/ }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Check for updates' }),
    )

    expect(await screen.findByText("Couldn't reach GitHub")).toBeInTheDocument()
  })

  test('marks a build of a checkout, with its commit in the menu, and no update', async () => {
    const user = userEvent.setup()
    renderVersion(
      { version: '0.1.1', kind: 'checkout', commit: 'abc1234-dirty' },
      '0.3.0',
    )

    expect(screen.getByText('Dev build')).toBeInTheDocument()
    // The commit is too long for the sidebar
    expect(screen.getByText('v0.1.1')).toBeInTheDocument()
    expect(screen.queryByText(/abc1234/)).not.toBeInTheDocument()
    expect(screen.queryByText('Update')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /v0\.1\.1/ }))
    expect(await screen.findByText('abc1234-dirty')).toBeInTheDocument()
  })

  test('marks the dev server', () => {
    renderVersion({ version: '0.2.0', kind: 'dev-server', commit: null }, null)

    expect(screen.getByText('Dev server')).toBeInTheDocument()
  })
})
