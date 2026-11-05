import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildRole, buildTools } from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

const git = buildRole()
const node = buildRole({ name: 'node' })
const installedAt = '2026-11-01T10:00:00Z'

describe('Install toast', () => {
  test('stays on every page while tools wait for local-env install', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [git, node], picked: ['acme/git', 'acme/node'] }),
      ),
    )

    expect(await screen.findByText('2 tools to install')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Details' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Install 2 tools',
    })
    expect(within(dialog).getByText('local-env install')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    // Still there: the tools still wait
    expect(screen.getByText('2 tools to install')).toBeInTheDocument()

    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git, node],
          picked: ['acme/git', 'acme/node'],
          installed: {
            'acme/git': { revision: git.revision, installedAt },
            'acme/node': { revision: node.revision, installedAt },
          },
        }),
      ),
    )
    await waitFor(() =>
      expect(screen.queryByText(/to install$/)).not.toBeInTheDocument(),
    )
  })

  test('says when the install asks for the password', async () => {
    const { events } = await renderApp('/')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [buildRole({ name: 'dns', label: 'DNS', needsSudo: true })],
          picked: ['acme/dns'],
        }),
      ),
    )

    expect(
      await screen.findByText(/It asks for your password: DNS uses sudo\./),
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
              label: 'Backend',
              isProfile: true,
              needsSudo: true,
              dependencies: ['git'],
            }),
          ],
          picked: ['acme/node'],
          profile: 'acme/backend',
        }),
      ),
    )

    // git and node: the profile is a set of tools, not one
    await user.click(await screen.findByRole('button', { name: 'Details' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Install 2 tools',
    })
    const inProfile = within(dialog).getByRole('region', {
      name: 'Backend profile',
    })
    expect(within(inProfile).getByText('git')).toBeInTheDocument()
    expect(within(inProfile).queryByText('Backend')).not.toBeInTheDocument()
    expect(
      within(within(dialog).getByRole('region', { name: 'Picked' })).getByText(
        'node',
      ),
    ).toBeInTheDocument()
    // Its own tasks run too
    expect(
      within(dialog).getByText(
        'It asks for your password: Backend needs sudo.',
      ),
    ).toBeInTheDocument()
  })

  test('comes back once closed only when what waits changes', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    const tools = buildTools({ roles: [git, node], picked: ['acme/git'] })
    act(() => events.emit('tools', tools))

    await user.click(await screen.findByRole('button', { name: 'Close toast' }))
    await waitFor(() =>
      expect(screen.queryByText('1 tool to install')).not.toBeInTheDocument(),
    )

    // The same data again: still closed
    act(() => events.emit('tools', { ...tools }))
    expect(screen.queryByText('1 tool to install')).not.toBeInTheDocument()

    act(() =>
      events.emit('tools', { ...tools, picked: ['acme/git', 'acme/node'] }),
    )
    expect(await screen.findByText('2 tools to install')).toBeInTheDocument()
  })
})
