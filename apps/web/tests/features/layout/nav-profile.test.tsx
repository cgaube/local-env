import { act, screen } from '@testing-library/react'
import { buildRole, buildTools } from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

const backend = buildRole({
  name: 'backend',
  isProfile: true,
  tags: ['profile'],
})

describe('Sidebar profile', () => {
  test('leaves the logo to the overview', async () => {
    await renderApp('/tools')

    expect(screen.getByRole('link', { name: /^local-env/ })).toHaveAttribute(
      'href',
      '/',
    )
  })

  test('has no profile item without profiles in the sources', async () => {
    const { events } = await renderApp('/')

    act(() => events.emit('tools', buildTools({ roles: [buildRole()] })))

    expect(
      screen.queryByRole('link', { name: /^Profile:/ }),
    ).not.toBeInTheDocument()
  })

  test('shows the profile at the bottom, linked to the Profiles page', async () => {
    const { events } = await renderApp('/')

    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [buildRole(), backend], profile: 'acme/backend' }),
      ),
    )

    const item = screen.getByRole('link', { name: 'Profile: backend' })
    expect(item).toHaveAttribute('href', '/profiles')
    expect(item).toHaveTextContent('backend')
    // The logo's link stays the logo's
    expect(screen.getByRole('link', { name: /^local-env/ })).toHaveAttribute(
      'href',
      '/',
    )
  })

  test('says when no profile is picked', async () => {
    const { events } = await renderApp('/')

    act(() => events.emit('tools', buildTools({ roles: [backend] })))

    expect(
      screen.getByRole('link', { name: 'Profile: none' }),
    ).toBeInTheDocument()
  })
})
