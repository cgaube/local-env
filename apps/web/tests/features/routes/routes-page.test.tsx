import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildRoute } from '../../support/factories.ts'
import { renderApp } from '../../support/render-app.tsx'

const mail = buildRoute()
const api = buildRoute({
  hosts: ['api.dev.test'],
  url: 'https://api.dev.test',
  container: 'shop-api',
  stack: 'shop',
})
const dockhand = buildRoute({
  hosts: ['docker.dev.test'],
  url: 'https://docker.dev.test',
  container: 'local-env-dockhand',
  stack: 'local-env',
})

describe('Routes page', () => {
  test("lists the routes, without local-env's own", async () => {
    const { events } = await renderApp('/docker/routes')

    act(() => events.emit('routes', [mail, api, dockhand]))

    expect(
      screen.getByRole('link', { name: 'https://mail.dev.test' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'https://api.dev.test' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'https://docker.dev.test' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/^2 routes · updated/)).toBeInTheDocument()
  })

  test('filters the routes', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/docker/routes')
    act(() => events.emit('routes', [mail, api]))

    await user.type(
      screen.getByRole('searchbox', { name: 'Filter routes' }),
      'shop',
    )

    expect(
      await screen.findByRole('link', { name: 'https://api.dev.test' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'https://mail.dev.test' }),
    ).not.toBeInTheDocument()
  })

  test('says when no route matches the filter', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/docker/routes')
    act(() => events.emit('routes', [mail]))

    await user.type(
      screen.getByRole('searchbox', { name: 'Filter routes' }),
      'nope',
    )

    expect(
      await screen.findByText('No routes match the filter'),
    ).toBeInTheDocument()
  })

  test('opens the help to add a route while there is none', async () => {
    const { events } = await renderApp('/docker/routes')

    act(() => events.emit('routes', [dockhand]))

    expect(screen.getByText('No routes yet')).toBeInTheDocument()
    expect(screen.getByText('Docker Compose')).toBeVisible()
    expect(
      screen.getByText(/Serve any container at https:\/\/<name>\.dev\.test/),
    ).toBeInTheDocument()
  })
})
