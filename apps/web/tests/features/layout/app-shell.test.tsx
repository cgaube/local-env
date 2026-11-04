import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import cli from '#package.json' with { type: 'json' }
import { buildService } from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

describe('App shell', () => {
  test('shows where you are in the breadcrumb', async () => {
    await renderApp('/tools')

    const breadcrumb = screen.getByRole('navigation', { name: 'breadcrumb' })
    expect(breadcrumb).toHaveTextContent('Tools')
  })

  test('navigates from the sidebar, one link a page', async () => {
    const user = userEvent.setup()
    await renderApp('/')

    await user.click(screen.getByRole('link', { name: 'Docker' }))
    expect(
      await screen.findByRole('heading', { name: 'Routes', level: 1 }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Tools' }))
    expect(
      await screen.findByRole('heading', { name: 'Tools', level: 1 }),
    ).toBeInTheDocument()
  })

  test('collapses the sidebar to its icons', async () => {
    const user = userEvent.setup()
    await renderApp('/')
    const sidebar = () =>
      document.querySelector('[data-slot="sidebar"][data-state]')

    // The header's trigger: the sidebar's rail toggles it too
    await user.click(
      within(screen.getByRole('main')).getByRole('button', {
        name: 'Toggle Sidebar',
      }),
    )

    expect(sidebar()).toHaveAttribute('data-collapsible', 'icon')
    // The pages stay, as icons
    expect(screen.getByRole('link', { name: 'Tools' })).toBeInTheDocument()
  })

  test('links to the apps of the core stack', async () => {
    const { events } = await renderApp('/')

    act(() => events.emit('services', [buildService()]))

    expect(screen.getByRole('link', { name: 'Open Dockhand' })).toHaveAttribute(
      'href',
      'https://docker.dev.test',
    )
  })

  test("shows the CLI's version, as a dev build outside a release", async () => {
    await renderApp('/')

    expect(screen.getByText('Dev build')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`^v${cli.version}`))).toBeInTheDocument()
  })

  test('sends an unknown path to the overview', async () => {
    const { router } = await renderApp('/nowhere')

    expect(
      await screen.findByRole('heading', { name: 'Overview', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
