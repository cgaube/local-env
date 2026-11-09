import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LoginRow } from '#services/dashboard/agent-protocol.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

const login = (overrides: Partial<LoginRow> = {}): LoginRow => ({
  type: 'aws',
  name: 'acme-dev',
  title: 'AWS 123456789012 (Dev)',
  sources: ['acme'],
  state: 'logged-in',
  detail: 'as arn:aws:sts::123456789012:assumed-role/Dev/octocat',
  command: null,
  help: null,
  ...overrides,
})

const GHCR = login({
  type: 'registry',
  name: 'ghcr',
  title: 'ghcr.io',
  state: 'logged-out',
  detail: null,
  command: 'local-env sources login acme --login ghcr',
})

afterEach(() => vi.unstubAllGlobals())

describe('Logins on the overview', () => {
  test('shows each login, its state, and what to run', async () => {
    await renderApp('/', {
      logins: {
        available: true,
        logins: [GHCR, login({ help: 'Ask #platform for the dev account' })],
      },
    })

    expect(screen.getByText('2 logins, 1 needs you')).toBeInTheDocument()
    const registry = screen.getByRole('row', { name: /ghcr/ })
    expect(within(registry).getByText('Registry · ghcr.io')).toBeInTheDocument()
    expect(within(registry).getByText('Logged out')).toBeInTheDocument()
    expect(
      within(registry).getByText('local-env sources login acme --login ghcr'),
    ).toBeInTheDocument()
    const aws = screen.getByRole('row', { name: /acme-dev/ })
    expect(within(aws).getByText('Logged in')).toBeInTheDocument()
    expect(
      within(aws).getByText(
        'as arn:aws:sts::123456789012:assumed-role/Dev/octocat',
      ),
    ).toBeInTheDocument()
    expect(
      within(aws).getByText('Ask #platform for the dev account'),
    ).toBeInTheDocument()
  })

  test('says how to start the agent, which checks them', async () => {
    await renderApp('/', { logins: { available: false } })

    expect(
      screen.getByText('The dashboard agent checks them on your Mac: start it'),
    ).toBeInTheDocument()
    expect(screen.getByText('local-env start')).toBeInTheDocument()
  })

  test('is not there when no source needs a login', async () => {
    await renderApp('/')

    expect(
      screen.queryByRole('heading', { name: 'Logins' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Logins')).not.toBeInTheDocument()
  })

  test('checks them again on refresh', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        available: true,
        logins: [
          { ...GHCR, state: 'logged-in', command: null, detail: 'as octocat' },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetch)
    await renderApp('/', { logins: { available: true, logins: [GHCR] } })

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(fetch).toHaveBeenCalledWith('/api/logins')
    expect(
      await screen.findByText('1 login, all logged in'),
    ).toBeInTheDocument()
    expect(screen.getByText('as octocat')).toBeInTheDocument()
  })
})
