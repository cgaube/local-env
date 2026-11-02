import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildRole, buildTools } from '../../support/factories.ts'
import { renderApp } from '../../support/render-app.tsx'

const git = buildRole()
const node = buildRole({
  name: 'node',
  description: 'Node.js and npm',
  tags: [],
})

// The PUT the switches send, answered with `status`
const stubFetch = (status = 204) => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) => new Response(null, { status }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const sentRoles = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).roles)

afterEach(() => vi.unstubAllGlobals())

describe('Catalog page', () => {
  test('lists the tools of every source', async () => {
    const { events } = await renderApp('/tools')

    act(() => events.emit('tools', buildTools({ roles: [git, node] })))

    const row = screen.getByRole('row', { name: /git/ })
    expect(within(row).getByText('Git, from Homebrew')).toBeInTheDocument()
    expect(within(row).getByText('vcs')).toBeInTheDocument()
    expect(within(row).getByText('acme')).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Install node' }),
    ).not.toBeChecked()
  })

  test('saves a pick and tells how to install it', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/tools')
    act(() => events.emit('tools', buildTools({ roles: [git, node] })))

    await user.click(screen.getByRole('switch', { name: 'Install node' }))

    expect(screen.getByRole('switch', { name: 'Install node' })).toBeChecked()
    expect(sentRoles(fetch)).toEqual([['acme/node']])
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/tools/picked')
    expect(
      within(screen.getByRole('row', { name: /node/ })).getByText('To install'),
    ).toBeInTheDocument()
  })

  test('unpicks a tool', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [git, node], picked: ['acme/git', 'acme/node'] }),
      ),
    )

    await user.click(screen.getByRole('switch', { name: 'Install git' }))

    expect(sentRoles(fetch)).toEqual([['acme/node']])
    expect(
      screen.getByRole('switch', { name: 'Install git' }),
    ).not.toBeChecked()
  })

  test('shows installed tools and the ones whose role changed', async () => {
    const { events } = await renderApp('/tools')

    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git, node],
          picked: ['acme/git', 'acme/node'],
          installed: {
            'acme/git': {
              revision: git.revision,
              installedAt: '2026-11-01T10:00:00Z',
            },
            'acme/node': {
              revision: 'old',
              installedAt: '2026-11-01T10:00:00Z',
            },
          },
        }),
      ),
    )

    expect(
      within(screen.getByRole('row', { name: /git/ })).getByText('Installed'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /node/ })).getByText(
        'Update available',
      ),
    ).toBeInTheDocument()
  })

  test('puts the switch back when the pick is not saved', async () => {
    const user = userEvent.setup()
    stubFetch(400)
    const { events } = await renderApp('/tools')
    act(() => events.emit('tools', buildTools({ roles: [git] })))

    await user.click(screen.getByRole('switch', { name: 'Install git' }))

    expect(
      await screen.findByText("Your pick wasn't saved"),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Install git' }),
    ).not.toBeChecked()
  })

  test('filters the tools by name, description or tag', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() => events.emit('tools', buildTools({ roles: [git, node] })))

    await user.type(
      screen.getByRole('searchbox', { name: 'Filter tools' }),
      'npm',
    )

    expect(
      screen.getByRole('switch', { name: 'Install node' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'Install git' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 tools')).toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: 'Filter tools' }))
    await user.type(
      screen.getByRole('searchbox', { name: 'Filter tools' }),
      'zsh',
    )

    expect(screen.getByText('No tools match the filters.')).toBeInTheDocument()
  })

  test('filters the tools by source, with the count of each', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    const teamGit = buildRole({ source: 'team' })
    act(() => events.emit('tools', buildTools({ roles: [git, node, teamGit] })))

    await user.click(screen.getByRole('button', { name: 'Source' }))
    expect(
      within(screen.getByRole('option', { name: /^acme/ })).getByText('2'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /^team/ }))
    await user.keyboard('{Escape}')

    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect(screen.getByText('1 of 3 tools')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Remove Source: team' }),
    )

    expect(screen.getAllByRole('switch')).toHaveLength(3)
  })

  test('filters the tools by tag', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    const jq = buildRole({ name: 'jq', tags: ['cli', 'json'] })
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git, buildRole({ name: 'node', tags: ['cli'] }), jq],
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Tags' }))
    // Each tag of a tool counts
    expect(
      within(screen.getByRole('option', { name: /^cli/ })).getByText('2'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /^json/ }))
    await user.keyboard('{Escape}')

    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect(
      screen.getByRole('switch', { name: 'Install jq' }),
    ).toBeInTheDocument()
  })

  test('shows the active filters as chips, cleared all at once', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() => events.emit('tools', buildTools({ roles: [git, node] })))

    await user.type(
      screen.getByRole('searchbox', { name: 'Filter tools' }),
      'npm',
    )
    await user.click(screen.getByRole('button', { name: 'Source' }))
    await user.click(screen.getByRole('option', { name: /acme/ }))
    await user.keyboard('{Escape}')

    expect(
      screen.getByRole('button', { name: 'Remove Search: npm' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Source: acme' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear all' }))

    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.getByRole('searchbox', { name: 'Filter tools' })).toHaveValue(
      '',
    )
  })

  test('hides and shows columns', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() => events.emit('tools', buildTools({ roles: [git] })))
    expect(
      screen.getByRole('columnheader', { name: 'Source' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'source' }),
    )
    await user.keyboard('{Escape}')

    expect(
      screen.queryByRole('columnheader', { name: 'Source' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Install git' }),
    ).toBeInTheDocument()
  })

  test('sorts the tools by name', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() => events.emit('tools', buildTools({ roles: [node, git] })))
    const names = () =>
      screen
        .getAllByRole('switch')
        .map((toggle) => toggle.getAttribute('aria-label'))

    expect(names()).toEqual(['Install git', 'Install node'])

    await user.click(screen.getByRole('button', { name: 'Tool' }))

    expect(names()).toEqual(['Install node', 'Install git'])
  })

  test('locks the tools a picked tool includes', async () => {
    const { events } = await renderApp('/tools')
    const backend = buildRole({
      name: 'backend',
      description: "A backend engineer's tools",
      dependencies: ['git', 'node'],
    })

    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [git, node, backend], picked: ['acme/backend'] }),
      ),
    )

    const gitSwitch = screen.getByRole('switch', { name: 'Install git' })
    expect(gitSwitch).toBeChecked()
    expect(gitSwitch).toHaveAttribute('data-disabled')
    expect(screen.getAllByText('Included in backend')).toHaveLength(2)
    // Installed with backend
    expect(
      within(screen.getByRole('row', { name: /^git/ })).getByText('To install'),
    ).toBeInTheDocument()
  })

  describe('pages', () => {
    // tool-01 … tool-30, in that order
    const many = Array.from({ length: 30 }, (_, index) =>
      buildRole({
        name: `tool-${String(index + 1).padStart(2, '0')}`,
        tags: [],
      }),
    )

    test('shows 25 tools a page', async () => {
      const user = userEvent.setup()
      const { events } = await renderApp('/tools')
      act(() => events.emit('tools', buildTools({ roles: many })))

      expect(screen.getAllByRole('switch')).toHaveLength(25)
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Previous page' }),
      ).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'Next page' }))

      expect(screen.getAllByRole('switch')).toHaveLength(5)
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Last page' })).toBeDisabled()
    })

    test('changes how many tools a page shows', async () => {
      const user = userEvent.setup()
      const { events } = await renderApp('/tools')
      act(() => events.emit('tools', buildTools({ roles: many })))

      await user.click(screen.getByRole('combobox', { name: 'Rows per page' }))
      await user.click(await screen.findByRole('option', { name: '10' }))

      expect(screen.getAllByRole('switch')).toHaveLength(10)
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    })

    test('stays on the page when a tool is picked', async () => {
      const user = userEvent.setup()
      stubFetch()
      const { events } = await renderApp('/tools')
      act(() => events.emit('tools', buildTools({ roles: many })))
      await user.click(screen.getByRole('button', { name: 'Next page' }))

      await user.click(screen.getByRole('switch', { name: 'Install tool-30' }))
      // The saved playbook comes back on the stream
      act(() =>
        events.emit(
          'tools',
          buildTools({ roles: many, picked: ['acme/tool-30'] }),
        ),
      )

      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
      expect(
        screen.getByRole('switch', { name: 'Install tool-30' }),
      ).toBeChecked()
    })

    test('goes back to the first page when the filters change', async () => {
      const user = userEvent.setup()
      const { events } = await renderApp('/tools')
      act(() => events.emit('tools', buildTools({ roles: many })))
      await user.click(screen.getByRole('button', { name: 'Next page' }))

      await user.type(
        screen.getByRole('searchbox', { name: 'Filter tools' }),
        'tool-1',
      )

      expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
      expect(screen.getAllByRole('switch')).toHaveLength(10)
    })
  })

  test('lists a pick whose role left the sources, to unpick it', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [node], picked: ['acme/git', 'acme/node'] }),
      ),
    )

    const row = screen.getByRole('row', { name: /^git/ })
    expect(within(row).getByText('Gone from the sources')).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Install git' }))

    expect(sentRoles(fetch)).toEqual([['acme/node']])
  })

  test('filters the tools by status', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    const jq = buildRole({ name: 'jq' })
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git, node, jq],
          picked: ['acme/git', 'acme/node'],
          installed: {
            'acme/git': {
              revision: git.revision,
              installedAt: '2026-11-01T10:00:00Z',
            },
          },
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Status' }))
    expect(
      within(screen.getByRole('option', { name: /^Not installed/ })).getByText(
        '1',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /^Installed/ }))
    await user.keyboard('{Escape}')

    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect(
      screen.getByRole('switch', { name: 'Install git' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Status: Installed' }),
    ).toBeInTheDocument()
  })

  test('shows when each tool was installed, from the Columns menu', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git],
          picked: ['acme/git'],
          installed: {
            'acme/git': {
              revision: git.revision,
              installedAt: '2026-11-01T10:00:00Z',
            },
          },
        }),
      ),
    )
    expect(
      screen.queryByRole('columnheader', { name: 'Installed' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'installed' }),
    )
    await user.keyboard('{Escape}')

    expect(
      screen.getByRole('columnheader', { name: 'Installed' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /^git/ })).getByText(/2026/),
    ).toBeInTheDocument()
  })

  test('says when the sources have no tools', async () => {
    const { events } = await renderApp('/tools')

    act(() => events.emit('tools', buildTools({ roles: [] })))

    expect(screen.getByText('No tools yet')).toBeInTheDocument()
  })
})
