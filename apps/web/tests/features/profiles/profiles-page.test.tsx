import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildRole, buildTools } from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

const git = buildRole()
const node = buildRole({ name: 'node', stacks: ['acme/mail'] })
const base = buildRole({
  name: 'base',
  description: null,
  isProfile: true,
  dependencies: ['git'],
})
const backend = buildRole({
  name: 'backend',
  description: 'Backend developer setup',
  isProfile: true,
  dependencies: ['base', 'node'],
  stacks: ['acme/postgres'],
})
const frontend = buildRole({
  source: 'team',
  name: 'frontend',
  description: 'Frontend developer setup',
  isProfile: true,
})
const roles = [git, node, base, backend, frontend]
const installedAt = '2026-11-01T10:00:00Z'

// The PUT the buttons send, answered with `status`
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

describe('Profiles page', () => {
  test('lists every profile, with its tools and stacks', async () => {
    const { events } = await renderApp('/profiles')

    act(() => events.emit('tools', buildTools({ roles })))

    const row = screen.getByRole('row', { name: /backend/ })
    expect(within(row).getByText('Backend developer setup')).toBeVisible()
    // git through base, and node
    expect(within(row).getByText('2 tools')).toBeVisible()
    // Its own stack, and the one node needs: counted, Details lists them
    expect(within(row).getByText('2 stacks')).toBeVisible()
    expect(screen.getByRole('row', { name: /frontend/ })).toBeVisible()
    expect(screen.getByText('3 profiles')).toBeVisible()
  })

  test('shows where your profile stands, and the command to install it', async () => {
    const { events } = await renderApp('/profiles')

    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles,
          profile: 'acme/backend',
          installed: { 'acme/git': { revision: git.revision, installedAt } },
          stacks: {
            'acme/mail': {
              stack: 'mail',
              by: 'acme/node',
              deployedAt: installedAt,
            },
          },
        }),
      ),
    )

    const card = screen.getByRole('region', { name: 'Your profile' })
    expect(within(card).getByText('1 to install')).toBeVisible()
    expect(within(card).getByText('1 to deploy')).toBeVisible()
    expect(within(card).getByText('local-env install')).toBeVisible()
  })

  test('picks a profile', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/profiles')
    act(() => events.emit('tools', buildTools({ roles })))

    await user.click(screen.getByRole('button', { name: 'Use frontend' }))

    expect(fetch.mock.calls[0]?.[0]).toBe('/api/tools/profile')
    expect(sentProfiles(fetch)).toEqual(['team/frontend'])
    // Marked, shaded, with nothing left to use
    const row = screen.getByRole('row', { name: /frontend/ })
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(row).toHaveAttribute('data-state', 'selected')
    expect(within(row).getByText('Your profile')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Use frontend' }),
    ).not.toBeInTheDocument()
  })

  test('lists the roles of the profile that come from Galaxy, or no source', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/profiles')
    const mobile = buildRole({
      name: 'acme.profiles.mobile',
      collection: 'acme.profiles',
      label: 'Mobile',
      isProfile: true,
      dependencies: ['git', 'geerlingguy.mac.dock', 'acme.gone.xcode'],
      galaxy: { 'geerlingguy.mac': '>=5.0.0,<6.0.0' },
    })
    act(() => events.emit('tools', buildTools({ roles: [git, mobile] })))

    await user.click(screen.getByRole('button', { name: 'Details of Mobile' }))

    const sheet = await screen.findByRole('dialog', { name: 'Mobile' })
    const tools = within(sheet).getByRole('region', { name: 'Tools (3)' })
    const galaxy = within(tools)
      .getByText('geerlingguy.mac.dock')
      .closest('li')!
    expect(within(galaxy).getByText('Galaxy')).toBeVisible()
    const missing = within(tools).getByText('acme.gone.xcode').closest('li')!
    expect(within(missing).getByText('Missing')).toBeVisible()
  })

  test('opens what a profile brings, before it is picked', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/profiles')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles,
          installed: { 'acme/git': { revision: git.revision, installedAt } },
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Details of backend' }))

    const sheet = await screen.findByRole('dialog', { name: 'backend' })
    expect(within(sheet).getByText('base')).toBeVisible()
    const tools = within(sheet).getByRole('region', { name: 'Tools (2)' })
    expect(within(tools).getByText('Installed')).toBeVisible()
    // The profile's own source goes without saying
    expect(within(tools).queryByText('acme')).not.toBeInTheDocument()
    expect(within(tools).getByText('To install')).toBeVisible()
    const stacks = within(sheet).getByRole('region', { name: 'Stacks (2)' })
    expect(within(stacks).getAllByText('To deploy')).toHaveLength(2)

    await user.click(
      within(sheet).getByRole('button', { name: 'Use this profile' }),
    )
    expect(sentProfiles(fetch)).toEqual(['acme/backend'])
  })

  test('filters the profiles', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/profiles')
    act(() => events.emit('tools', buildTools({ roles })))

    await user.type(
      screen.getByRole('searchbox', { name: 'Filter profiles' }),
      'frontend',
    )

    expect(screen.getByText('1 of 3 profiles')).toBeVisible()
    expect(
      screen.queryByRole('row', { name: /backend/ }),
    ).not.toBeInTheDocument()
  })

  test('says how to make one when the sources have none', async () => {
    const { events } = await renderApp('/profiles')

    act(() => events.emit('tools', buildTools({ roles: [git] })))

    expect(screen.getByText('No profiles yet')).toBeVisible()
  })
})
