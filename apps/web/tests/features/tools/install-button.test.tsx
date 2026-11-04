import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildRole, buildTools } from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

const git = buildRole()
const node = buildRole({ name: 'node' })
const installedAt = '2026-11-01T10:00:00Z'

describe('Install button', () => {
  test('is in the header while tools wait for an install, on every page', async () => {
    const { events } = await renderApp('/docker')

    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git, node],
          picked: ['acme/git', 'acme/node'],
          installed: { 'acme/git': { revision: git.revision, installedAt } },
        }),
      ),
    )

    expect(
      screen.getByRole('button', { name: 'Install 1 tool' }),
    ).toBeInTheDocument()
  })

  test('is not there when everything picked is installed', async () => {
    const { events } = await renderApp('/')

    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git],
          picked: ['acme/git'],
          installed: { 'acme/git': { revision: git.revision, installedAt } },
        }),
      ),
    )

    expect(
      screen.queryByRole('button', { name: /^Install/ }),
    ).not.toBeInTheDocument()
  })

  test('opens the command to run, with the tools it installs', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git, node],
          picked: ['acme/git', 'acme/node'],
          installed: { 'acme/node': { revision: 'old', installedAt } },
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Install 2 tools' }))

    const dialog = screen.getByRole('dialog', { name: 'Install 2 tools' })
    expect(within(dialog).getByText('local-env install')).toBeInTheDocument()
    expect(within(dialog).getByText('To install')).toBeInTheDocument()
    expect(within(dialog).getByText('Update available')).toBeInTheDocument()
  })

  test('says when the install asks for the password', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [buildRole({ name: 'dns', needsSudo: true })],
          picked: ['acme/dns'],
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Install 1 tool' }))

    expect(
      screen.getByText('It asks for your password: dns needs sudo.'),
    ).toBeInTheDocument()
  })

  test('lists the tools of the profile under it, not the profile', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [
            git,
            node,
            buildRole({
              name: 'backend',
              isProfile: true,
              dependencies: ['git'],
            }),
          ],
          picked: ['acme/node'],
          profile: 'acme/backend',
        }),
      ),
    )

    // git and node: the profile is a set of tools, not one
    await user.click(screen.getByRole('button', { name: 'Install 2 tools' }))

    const dialog = screen.getByRole('dialog', { name: 'Install 2 tools' })
    const inProfile = within(dialog).getByRole('region', {
      name: 'backend profile',
    })
    expect(within(inProfile).getByText('git')).toBeInTheDocument()
    expect(within(inProfile).queryByText('backend')).not.toBeInTheDocument()
    expect(
      within(within(dialog).getByRole('region', { name: 'Picked' })).getByText(
        'node',
      ),
    ).toBeInTheDocument()
  })
})
