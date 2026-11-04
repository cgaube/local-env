import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildRole, buildTools } from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

const git = buildRole()
const postgresClient = buildRole({
  name: 'postgres-client',
  stacks: ['acme/postgres', 'shared/mailpit'],
})
const backend = buildRole({
  name: 'backend',
  description: 'Backend developer setup',
  tags: ['profile'],
  isProfile: true,
  dependencies: ['git', 'postgres-client'],
})
const frontend = buildRole({
  source: 'team',
  id: 'team/frontend',
  name: 'frontend',
  description: null,
  tags: ['profile'],
  isProfile: true,
})
const roles = [git, postgresClient, backend, frontend]

// The PUT the menu sends, answered with `status`
const stubFetch = (status = 204) => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) => new Response(null, { status }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const sentProfiles = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).profile)

afterEach(() => vi.unstubAllGlobals())

describe('Profile switcher', () => {
  test('shows the logo and the domain without profiles in the sources', async () => {
    const { events } = await renderApp('/')

    act(() => events.emit('tools', buildTools({ roles: [git] })))

    expect(screen.getByText('*.dev.test')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Profile/ }),
    ).not.toBeInTheDocument()
  })

  test('lists the profiles by source', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() =>
      events.emit('tools', buildTools({ roles, profile: 'acme/backend' })),
    )

    await user.click(screen.getByRole('button', { name: 'Profile: backend' }))

    const acme = await screen.findByRole('group', { name: 'acme' })
    const item = within(acme).getByRole('menuitemradio', { name: /backend/ })
    expect(item).toBeChecked()
    expect(within(item).getByText('Backend developer setup')).toBeVisible()
    // The stacks they need are on the Tools page, not here
    expect(within(item).queryByText(/postgres/)).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: 'team' })).getByRole(
        'menuitemradio',
        { name: 'frontend' },
      ),
    ).not.toBeChecked()
  })

  test('saves the profile picked', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/')
    act(() => events.emit('tools', buildTools({ roles })))

    await user.click(screen.getByRole('button', { name: 'Profile: none' }))
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'frontend' }),
    )

    expect(fetch.mock.calls[0]?.[0]).toBe('/api/tools/profile')
    expect(sentProfiles(fetch)).toEqual(['team/frontend'])
    expect(
      screen.getByRole('button', { name: 'Profile: frontend' }),
    ).toBeInTheDocument()
  })

  test('saves no profile', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/')
    act(() =>
      events.emit('tools', buildTools({ roles, profile: 'acme/backend' })),
    )

    await user.click(screen.getByRole('button', { name: 'Profile: backend' }))
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'No profile' }),
    )

    expect(sentProfiles(fetch)).toEqual([null])
    expect(
      screen.getByRole('button', { name: 'Profile: none' }),
    ).toBeInTheDocument()
  })

  test('goes back to the saved profile when the save fails', async () => {
    const user = userEvent.setup()
    stubFetch(500)
    const { events } = await renderApp('/')
    act(() =>
      events.emit('tools', buildTools({ roles, profile: 'acme/backend' })),
    )

    await user.click(screen.getByRole('button', { name: 'Profile: backend' }))
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'frontend' }),
    )

    expect(
      await screen.findByRole('button', { name: 'Profile: backend' }),
    ).toHaveTextContent('Profile not saved')
  })

  test('shows no profile when the saved one left the sources', async () => {
    const { events } = await renderApp('/')

    act(() =>
      events.emit('tools', buildTools({ roles, profile: 'acme/mobile' })),
    )

    expect(
      screen.getByRole('button', { name: 'Profile: none' }),
    ).toHaveTextContent('No profile')
  })
})
