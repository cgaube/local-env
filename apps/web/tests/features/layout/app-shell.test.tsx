import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import cli from '../../../../../package.json' with { type: 'json' }
import { buildService } from '../../support/factories.ts'
import { renderApp } from '../../support/render-app.tsx'

describe('App shell', () => {
  test('shows where you are in the breadcrumb', async () => {
    await renderApp('/tools/catalog')

    const breadcrumb = screen.getByRole('navigation', { name: 'breadcrumb' })
    expect(breadcrumb).toHaveTextContent('Tools')
    expect(breadcrumb).toHaveTextContent('Catalog')
  })

  test('navigates from the sidebar', async () => {
    const user = userEvent.setup()
    await renderApp('/')

    await user.click(screen.getByRole('link', { name: 'Routes' }))

    expect(
      await screen.findByRole('heading', { name: 'Routes', level: 1 }),
    ).toBeInTheDocument()
  })

  test('shows every page, and a section links to its first one', async () => {
    const user = userEvent.setup()
    await renderApp('/')

    expect(screen.getByRole('link', { name: 'Installed' })).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'Tools' }))

    expect(
      await screen.findByRole('heading', { name: 'Catalog', level: 1 }),
    ).toBeInTheDocument()
  })

  test('links to the apps of the core stack', async () => {
    const { events } = await renderApp('/')

    act(() => events.emit('services', [buildService()]))

    expect(screen.getByRole('link', { name: 'Open Dockhand' })).toHaveAttribute(
      'href',
      'https://docker.dev.test',
    )
  })

  test("shows the CLI's version", async () => {
    await renderApp('/')

    expect(
      screen.getByRole('link', { name: `v${cli.version}` }),
    ).toHaveAttribute('href', expect.stringContaining('CHANGELOG.md'))
  })

  test('sends an unknown path to the overview', async () => {
    const { router } = await renderApp('/nowhere')

    expect(
      await screen.findByRole('heading', { name: 'Overview', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
