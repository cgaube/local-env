import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildRole, buildTools } from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

const git = buildRole()
const node = buildRole({ name: 'node' })
const installedAt = '2026-11-01T10:00:00Z'
const available = { available: true, version: '0.5.0', run: null }

// The sidebar's Tools item, with what the next install changes
const toolsBadge = () => screen.queryByLabelText(/to install$/)

describe('Install button', () => {
  test('stands out with the count once a pick leaves something to do', async () => {
    const { events } = await renderApp('/tools')
    act(() => {
      events.emit('tools', buildTools({ roles: [git, node] }))
      events.emit('agent', available)
    })

    // Nothing waits: a plain button that runs the install
    expect(await screen.findByRole('button', { name: 'Install' })).toBeEnabled()
    expect(toolsBadge()).not.toBeInTheDocument()

    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [git, node], picked: ['acme/git', 'acme/node'] }),
      ),
    )
    expect(
      await screen.findByRole('button', { name: 'Install, 2 changes' }),
    ).toBeInTheDocument()
    expect(toolsBadge()).toHaveTextContent('2')
    // What the count is, on hover
    await userEvent.hover(toolsBadge()!)
    expect(
      await screen.findByText(/2 changes wait for local-env install/),
    ).toBeInTheDocument()
  })

  test('counts an unpicked tool: the install forgets it', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git],
          installed: { 'acme/git': { revision: git.revision, installedAt } },
        }),
      ),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Install, 1 change' }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Apply your changes',
    })
    const unpicked = within(dialog).getByRole('region', {
      name: 'Unpicked, stay on this Mac',
    })
    expect(within(unpicked).getByText('git')).toBeInTheDocument()
  })

  test('lists the tools of the profile under it, and who needs sudo', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/profiles')
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

    await user.click(
      await screen.findByRole('button', { name: /^Install, \d/ }),
    )
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
    // The profile's own tasks run too
    expect(
      within(dialog).getByText(
        'It asks for your password: Backend needs sudo.',
      ),
    ).toBeInTheDocument()
  })
})
