import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  buildLogin,
  buildService,
  buildSource,
} from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

const AGENT = { available: true, version: '0.6.1', run: null }

const VAULT = buildLogin({
  type: 'vault',
  name: 'example-vault',
  title: 'Vault vault.dev.test',
  state: 'logged-out',
  detail: null,
  command: 'local-env sources login acme --login example-vault',
})

// A card of the page, by its title: CardTitle is not a heading
const card = (title: string | RegExp) =>
  screen.getByText(title).closest<HTMLElement>('[data-slot="card"]')!

const attention = () => card(/^(Needs attention|All good)/)

afterEach(() => vi.unstubAllGlobals())

describe('the overview', () => {
  test('says all is good when everything runs and nothing waits', async () => {
    const { events } = await renderApp('/')

    act(() => {
      events.emit('services', [buildService()])
      events.emit('agent', AGENT)
    })

    expect(screen.getByText('All good')).toBeInTheDocument()
    expect(
      screen.getByText('Your services run, and nothing waits for you'),
    ).toBeInTheDocument()
  })

  test('lists what needs you first, each with what to do', async () => {
    const { events } = await renderApp('/', {
      logins: { available: true, logins: [buildLogin(), VAULT] },
    })

    act(() => {
      events.emit('services', [
        buildService(),
        buildService({ service: 'proxy', app: null, state: 'exited' }),
      ])
      events.emit('agent', AGENT)
    })

    expect(screen.getByText('Needs attention (2)')).toBeInTheDocument()
    const needs = attention()
    expect(
      within(needs).getByText('1 core service not running'),
    ).toBeInTheDocument()
    expect(within(needs).getByText('local-env start')).toBeInTheDocument()
    expect(
      within(needs).getByText('example-vault: logged out'),
    ).toBeInTheDocument()
    expect(
      within(needs).getByText(
        'local-env sources login acme --login example-vault',
      ),
    ).toBeInTheDocument()
  })

  test('links to Tools when the next install changes something', async () => {
    const user = userEvent.setup()
    const { events, router } = await renderApp('/')
    act(() => {
      events.emit('services', [buildService()])
      events.emit('agent', AGENT)
      events.emit('tools', {
        roles: [
          {
            id: 'acme/git',
            source: 'acme',
            folder: 'git',
            name: 'git',
            collection: null,
            label: 'git',
            description: null,
            tags: [],
            dependencies: [],
            isProfile: false,
            stacks: [],
            revision: 'abc',
            needsSudo: false,
            galaxy: {},
            inputs: [],
            secrets: [],
          },
        ],
        picked: ['acme/git'],
        installed: {},
        profile: null,
        stacks: {},
        variables: {},
        galaxyRoles: [],
      })
    })

    await user.click(
      within(attention()).getByRole('link', { name: 'Open Tools' }),
    )

    expect(router.state.location.pathname).toBe('/tools')
  })

  test('shows the health of each core service and the agent, the table in a sheet', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() => {
      events.emit('services', [
        buildService(),
        buildService({
          service: 'proxy',
          container: 'local-env-proxy',
          app: null,
          state: 'running',
        }),
      ])
      events.emit('agent', AGENT)
    })

    const health = card('Health')
    expect(within(health).getByText('2 running')).toBeInTheDocument()
    expect(within(health).getByText('dashboard agent')).toBeInTheDocument()

    await user.click(within(health).getByRole('button', { name: 'Details' }))

    const sheet = await screen.findByRole('dialog', { name: 'Core services' })
    expect(
      within(sheet).getByRole('row', { name: /local-env-dockhand/ }),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByRole('row', { name: /local-env-proxy/ }),
    ).toBeInTheDocument()
  })
})

describe('the logins in Sources', () => {
  test('shows the logins of each source and their state', async () => {
    const { events } = await renderApp('/', {
      logins: { available: true, logins: [buildLogin(), VAULT] },
    })

    act(() => events.emit('sources', [buildSource()]))

    expect(screen.getByText(/2 logins, 1 needs you/)).toBeInTheDocument()
    const source = screen.getByRole('listitem', { name: 'acme' })
    expect(within(source).getByText('Logins')).toBeInTheDocument()
    expect(within(source).getByText('Logged in')).toBeInTheDocument()
    expect(within(source).getByText('Logged out')).toBeInTheDocument()
    expect(
      within(source).getByText('Vault · Vault vault.dev.test'),
    ).toBeInTheDocument()
  })

  test('says to start the agent, which checks them', async () => {
    const { events } = await renderApp('/', { logins: { available: false } })

    act(() => events.emit('sources', [buildSource()]))

    expect(
      screen.getByText(/Start the dashboard agent to check the logins/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Logins')).not.toBeInTheDocument()
  })

  test('checks them again on demand', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        available: true,
        logins: [{ ...VAULT, state: 'logged-in', command: null }],
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const { events } = await renderApp('/', {
      logins: { available: true, logins: [VAULT] },
    })
    act(() => events.emit('sources', [buildSource()]))

    await userEvent.click(screen.getByRole('button', { name: 'Check logins' }))

    expect(fetch).toHaveBeenCalledWith('/api/logins')
    expect(
      await screen.findByText(/1 login, all logged in/),
    ).toBeInTheDocument()
  })
})
