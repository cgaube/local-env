import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  buildInput,
  buildRole,
  buildTools,
} from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

const email = buildInput('git_email', {
  required: true,
  description: 'Your email, for commits.',
})
const git = buildRole({
  inputs: [
    email,
    buildInput('git_editor', { choices: ['vim', 'nano'], default: 'vim' }),
    buildInput('git_sign', { type: 'bool' }),
    buildInput('git_token', { secret: true }),
  ],
})
const node = buildRole({
  name: 'node',
  inputs: [
    buildInput('node_jobs', { type: 'int', default: 4 }),
    buildInput('node_globals', { type: 'list' }),
  ],
})
const jq = buildRole({ name: 'jq' })
const installedAt = '2026-11-01T10:00:00Z'

// The PATCHes and PUTs the page sends, answered with `status`
const stubFetch = (status = 204) => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) => new Response(null, { status }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

// The bodies sent to one route
const sent = (fetch: ReturnType<typeof stubFetch>, route: string) =>
  fetch.mock.calls
    .filter(([url]) => url === route)
    .map(([, init]) => JSON.parse(init.body as string))

const sentVariables = (fetch: ReturnType<typeof stubFetch>) =>
  sent(fetch, '/api/tools/variables').map(({ variables }) => variables)

// Opens the Variables sheet from the page header
const openVariables = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^Variables/ }))
  return screen.findByRole('dialog', { name: 'Variables' })
}

// Unfolds the panel of a role, in a sheet with several
const openPanel = async (
  user: ReturnType<typeof userEvent.setup>,
  sheet: HTMLElement,
  label: string,
) => {
  await user.click(
    within(sheet).getByRole('button', {
      // Its name, then its count: "node2 inputs"
      name: (name) => new RegExp(`^${label}\\d`).test(name),
    }),
  )
  return within(sheet).getByRole('group', { name: label })
}

// The panels of a sheet: their role, and whether they are open
const panels = (sheet: HTMLElement) =>
  [...sheet.querySelectorAll('[data-slot="collapsible-trigger"]')].map(
    (trigger) => [
      trigger.querySelector('.font-medium')?.textContent,
      trigger.getAttribute('aria-expanded') === 'true',
    ],
  )

afterEach(() => vi.unstubAllGlobals())

describe('Variables sheet', () => {
  test('one form for the values of every tool the install runs', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [git, jq], picked: ['acme/git'] }),
      ),
    )

    const sheet = await openVariables(user)

    expect(
      within(sheet).getByRole('textbox', { name: 'git_email' }),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByText('Your email, for commits.'),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByRole('combobox', { name: 'git_editor' }),
    ).toHaveTextContent('vim')
    expect(
      within(sheet).getByRole('switch', { name: 'git_sign' }),
    ).not.toBeChecked()
    // A secret is never shown
    expect(within(sheet).queryByText('git_token')).not.toBeInTheDocument()
  })

  test('has no Variables button when the tools take no values', async () => {
    const { events } = await renderApp('/tools')

    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [git, jq], picked: ['acme/jq'] }),
      ),
    )

    expect(
      screen.queryByRole('button', { name: /^Variables/ }),
    ).not.toBeInTheDocument()
  })

  test('picks a tool at once, even without its values: the install needs them', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/tools')
    act(() => events.emit('tools', buildTools({ roles: [git] })))

    await user.click(screen.getByRole('switch', { name: 'Install git' }))

    expect(sent(fetch, '/api/tools/picked')).toEqual([{ roles: ['acme/git'] }])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The stream sends the saved pick back
    act(() =>
      events.emit('tools', buildTools({ roles: [git], picked: ['acme/git'] })),
    )
    expect(
      screen.getByRole('button', { name: 'Variables, 1 missing' }),
    ).toBeInTheDocument()
  })

  test('says a value is missing on the field and Variables, and the install dialog opens the sheet', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() => {
      events.emit('tools', buildTools({ roles: [git], picked: ['acme/git'] }))
      events.emit('agent', { available: true, version: '0.5.0', run: null })
    })

    expect(
      screen.getByRole('button', { name: 'Variables, 1 missing' }),
    ).toBeInTheDocument()
    // Only on Variables: Install counts the changes
    await user.click(screen.getByRole('button', { name: 'Install, 1 change' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/git_email \(git\)/)).toBeInTheDocument()
    // Not before the values it needs
    expect(
      within(dialog).getByRole('button', { name: 'Install' }),
    ).toBeDisabled()
    await user.click(
      within(dialog).getByRole('button', { name: 'Set the variables' }),
    )

    const sheet = await screen.findByRole('dialog', { name: 'Variables' })
    expect(
      within(sheet).getByRole('textbox', { name: 'git_email' }),
    ).toHaveAttribute('aria-invalid', 'true')
    expect(
      within(sheet).getByText(
        'Required: set it here, or the install asks for it in the terminal.',
      ),
    ).toBeInTheDocument()
  })

  test('cannot install with nothing else to do while a value is missing', async () => {
    const { events } = await renderApp('/tools')
    act(() => {
      events.emit(
        'tools',
        buildTools({
          roles: [git],
          picked: ['acme/git'],
          installed: { 'acme/git': { revision: git.revision, installedAt } },
        }),
      )
      events.emit('agent', { available: true, version: '0.5.0', run: null })
    })

    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled()
  })

  test('a variable two tools use is one field, which names the other', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    const gh = buildRole({
      name: 'gh',
      inputs: [buildInput('git_email'), buildInput('gh_host')],
    })
    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [gh, git], picked: ['acme/gh', 'acme/git'] }),
      ),
    )

    const sheet = await openVariables(user)

    // git_email is a field of gh, the first role that declares it
    expect(panels(sheet)).toEqual([
      ['gh', true],
      ['git', false],
    ])
    expect(
      within(sheet).getAllByRole('textbox', { name: 'git_email' }),
    ).toHaveLength(1)
    expect(within(sheet).getByText('Also used by git.')).toBeInTheDocument()
  })

  test('says when two tools declare a variable differently', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    const zsh = buildRole({
      name: 'zsh',
      inputs: [buildInput('git_editor', { type: 'list' })],
    })
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git, zsh],
          picked: ['acme/git', 'acme/zsh'],
          variables: { git_email: 'me@acme.test' },
        }),
      ),
    )

    const sheet = await openVariables(user)

    expect(
      within(sheet).getByText(
        /Declared differently by git and zsh: one value goes to all of them\./,
      ),
    ).toBeInTheDocument()
  })

  test("shows a value the profile sets disabled: its owner's value wins", async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/profiles')
    const backend = buildRole({
      name: 'backend',
      label: 'Backend',
      isProfile: true,
      dependencies: ['git'],
      dependencyVars: [{ git_editor: 'nano' }],
    })
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git, backend],
          profile: 'acme/backend',
          // Picked too: it still runs inside the profile
          picked: ['acme/git'],
          variables: { git_editor: 'vim' },
        }),
      ),
    )

    const sheet = await openVariables(user)

    // In the profile's group, at the top: all its values are there
    expect(panels(sheet)).toEqual([
      ['Backend', true],
      ['git', true],
    ])
    const backendPanel = within(sheet).getByRole('group', { name: 'Backend' })
    const editor = within(backendPanel).getByRole('combobox', {
      name: 'git_editor',
    })
    expect(editor).toHaveTextContent('nano')
    expect(editor).toBeDisabled()
    expect(
      within(backendPanel).getByText('Set by Backend. Used by git.'),
    ).toBeInTheDocument()
  })

  test('folds the tools of a profile, the Galaxy roles too', async () => {
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
              name: 'acme.profiles.backend',
              collection: 'acme.profiles',
              label: 'Backend',
              isProfile: true,
              dependencies: ['git', 'node', 'geerlingguy.mac.dock'],
              galaxy: { 'geerlingguy.mac': '*' },
            }),
          ],
          profile: 'acme/acme.profiles.backend',
          galaxyRoles: [
            {
              name: 'geerlingguy.mac.dock',
              dependencies: [],
              inputs: [buildInput('dockitems_remove', { type: 'list' })],
            },
          ],
        }),
      ),
    )

    const sheet = await openVariables(user)

    // The first open, and the one that misses a value
    expect(panels(sheet)).toEqual([
      ['git', true],
      ['node', false],
      ['geerlingguy.mac.dock', false],
    ])
    expect(
      within(await openPanel(user, sheet, 'geerlingguy.mac.dock')).getByRole(
        'textbox',
        { name: 'dockitems_remove' },
      ),
    ).toBeInTheDocument()
  })

  test("puts the profile's own values first", async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/profiles')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          // The profile comes last in the catalog
          roles: [
            git,
            node,
            buildRole({
              name: 'zz_backend',
              label: 'Backend',
              isProfile: true,
              dependencies: ['git', 'node'],
              inputs: [buildInput('team')],
            }),
          ],
          profile: 'acme/zz_backend',
        }),
      ),
    )

    const sheet = await openVariables(user)

    expect(panels(sheet)).toEqual([
      ['Backend', true],
      // It misses a value: open
      ['git', true],
      ['node', false],
    ])
  })

  test('saves a value on blur, only what changed', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git],
          picked: ['acme/git'],
          variables: { git_sign: true },
        }),
      ),
    )
    const sheet = await openVariables(user)

    await user.type(
      within(sheet).getByRole('textbox', { name: 'git_email' }),
      'me@acme.test',
    )
    await user.tab()

    expect(sentVariables(fetch)).toEqual([{ git_email: 'me@acme.test' }])
    expect(fetch.mock.calls[0]?.[1].method).toBe('PATCH')
    expect(
      within(sheet).getByRole('textbox', { name: 'git_email' }),
    ).not.toHaveAttribute('aria-invalid')
  })

  test('saves a choice, a switch, a number and a list of their type, and clears a text', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git, node],
          picked: ['acme/git', 'acme/node'],
          variables: { git_email: 'me@acme.test' },
        }),
      ),
    )
    const sheet = await openVariables(user)
    await openPanel(user, sheet, 'node')

    await user.click(
      within(sheet).getByRole('combobox', { name: 'git_editor' }),
    )
    await user.click(await screen.findByRole('option', { name: 'nano' }))
    await user.click(within(sheet).getByRole('switch', { name: 'git_sign' }))
    await user.type(
      within(sheet).getByRole('spinbutton', { name: 'node_jobs' }),
      '8{Enter}',
    )
    // A list as a list: Ansible would give the role the text
    await user.type(
      within(sheet).getByRole('textbox', { name: 'node_globals' }),
      'pnpm, yarn{Enter}',
    )
    // An empty field has no value
    await user.clear(within(sheet).getByRole('textbox', { name: 'git_email' }))
    await user.keyboard('{Enter}')

    expect(sentVariables(fetch)).toEqual([
      { git_editor: 'nano' },
      { git_sign: true },
      { node_jobs: 8 },
      { node_globals: ['pnpm', 'yarn'] },
      { git_email: null },
    ])
  })

  test('Save and Escape keep the value just typed, and close', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit('tools', buildTools({ roles: [git], picked: ['acme/git'] })),
    )

    let sheet = await openVariables(user)
    await user.type(
      within(sheet).getByRole('textbox', { name: 'git_email' }),
      'me@acme.test',
    )
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )

    sheet = await openVariables(user)
    await user.type(
      within(sheet).getByRole('textbox', { name: 'git_email' }),
      '.uk',
    )
    await user.keyboard('{Escape}')

    expect(sentVariables(fetch)).toEqual([
      { git_email: 'me@acme.test' },
      { git_email: 'me@acme.test.uk' },
    ])
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  test('stays open on a click outside it', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit('tools', buildTools({ roles: [git], picked: ['acme/git'] })),
    )
    await openVariables(user)

    await user.click(document.body)

    expect(
      screen.getByRole('dialog', { name: 'Variables' }),
    ).toBeInTheDocument()
  })

  test('stays open on Save while a value typed is not valid, and says why', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [node], picked: ['acme/node'] }),
      ),
    )
    const sheet = await openVariables(user)

    await user.type(
      within(sheet).getByRole('textbox', { name: 'node_globals' }),
      'pnpm',
    )
    await user.click(
      within(sheet).getByRole('spinbutton', { name: 'node_jobs' }),
    )
    await user.keyboard('2.5')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(
      screen.getByRole('dialog', { name: 'Variables' }),
    ).toBeInTheDocument()
    expect(within(sheet).getByText('Type a whole number.')).toBeInTheDocument()
    expect(sentVariables(fetch)).toEqual([{ node_globals: ['pnpm'] }])
  })

  test('lists in a tab the values no tool you install takes, by role, to remove', async () => {
    const user = userEvent.setup()
    const fetch = stubFetch()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [git, node],
          // node is unpicked: its values stay
          picked: ['acme/git'],
          variables: { git_email: 'me@acme.test', node_jobs: 8, gone: 'x' },
        }),
      ),
    )
    const sheet = await openVariables(user)

    expect(
      within(sheet).getByRole('tab', { name: /^Your tools\s*3$/ }),
    ).toHaveAttribute('aria-selected', 'true')
    await user.click(within(sheet).getByRole('tab', { name: /^Saved\s*2$/ }))
    expect(panels(sheet)).toEqual([
      ['node', false],
      // Its role left the sources
      ['No role declares them', false],
    ])
    const nodePanel = await openPanel(user, sheet, 'node')
    expect(within(nodePanel).getByText('node_jobs')).toBeInTheDocument()
    await user.click(
      within(nodePanel).getByRole('button', { name: 'Remove node_jobs' }),
    )

    expect(sentVariables(fetch)).toEqual([{ node_jobs: null }])
  })

  test('puts the profiles first in the Saved tab too', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit(
        'tools',
        buildTools({
          roles: [
            node,
            // A profile you no longer use, after node in the catalog
            buildRole({
              name: 'zz_team',
              label: 'Team',
              isProfile: true,
              inputs: [buildInput('team_name')],
            }),
          ],
          variables: { node_jobs: 8, team_name: 'core', gone: 'x' },
        }),
      ),
    )
    const sheet = await openVariables(user)

    await user.click(within(sheet).getByRole('tab', { name: /^Saved/ }))

    expect(panels(sheet).map(([label]) => label)).toEqual([
      'Team',
      'node',
      'No role declares them',
    ])
  })

  test("says when a value wasn't saved", async () => {
    const user = userEvent.setup()
    stubFetch(400)
    const { events } = await renderApp('/tools')
    act(() =>
      events.emit('tools', buildTools({ roles: [git], picked: ['acme/git'] })),
    )
    const sheet = await openVariables(user)

    await user.click(within(sheet).getByRole('switch', { name: 'git_sign' }))

    expect(
      await within(sheet).findByText("Your value wasn't saved"),
    ).toBeInTheDocument()
  })

  test('marks a tool changed when a value it got changed since', async () => {
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
              installedAt,
              values: { git_email: 'old@acme.test' },
            },
          },
          variables: { git_email: 'me@acme.test' },
        }),
      ),
    )

    expect(
      within(screen.getByRole('row', { name: /git/ })).getByText(
        'Update available',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Install, 1 change' }),
    ).toBeInTheDocument()
  })

  test('names a required secret, which local-env does not support yet', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    const deploy = buildRole({
      name: 'deploy',
      inputs: [buildInput('deploy_token', { required: true, secret: true })],
    })
    act(() =>
      events.emit(
        'tools',
        buildTools({ roles: [deploy], picked: ['acme/deploy'] }),
      ),
    )

    const sheet = await openVariables(user)

    expect(
      within(sheet).getByText('Secrets not supported yet'),
    ).toBeInTheDocument()
    expect(within(sheet).queryByRole('textbox')).not.toBeInTheDocument()
  })
})
