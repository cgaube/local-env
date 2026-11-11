import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildCatalogTemplate } from '#ui-tests/support/factories.ts'
import { FakeWebSocket } from '#ui-tests/support/fake-web-socket.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

// xterm needs a canvas: the terminal isn't what these tests look at
vi.mock('#ui/features/terminal/xterm-view/xterm-view.tsx', () => ({
  default: function FakeXterm() {
    return null
  },
}))

beforeEach(() => {
  FakeWebSocket.sockets = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})
afterEach(() => vi.unstubAllGlobals())

const available = { available: true, version: '0.5.0', run: null }

const mail = buildCatalogTemplate({
  variables: [{ key: 'ADMIN_PASSWORD', help: 'a password for the web UI' }],
  secrets: ['SMTP_PASSWORD'],
  registries: ['ghcr.io'],
})
const wiki = buildCatalogTemplate({
  id: 'team/wiki',
  source: 'team',
  folder: 'wiki',
  title: 'Wiki',
  description: 'Notes of the team.',
  categories: ['docs'],
  name: 'wiki',
  hosts: ['wiki'],
})

const card = (title: string) => screen.getByRole('listitem', { name: title })

describe('Docker page, Templates', () => {
  test('lists the templates with what a deploy needs, and the deployed ones', async () => {
    const { events } = await renderApp('/docker', {
      stacks: { available: true, stacks: ['wiki'] },
    })
    act(() => {
      events.emit('templates', [mail, wiki])
      events.emit('agent', available)
    })

    expect(await screen.findByText('2 templates')).toBeVisible()
    const mailCard = card('Mailpit')
    expect(
      within(mailCard).getByText('Asks for ADMIN_PASSWORD'),
    ).toBeInTheDocument()
    expect(
      within(mailCard).getByText('From your vault: SMTP_PASSWORD'),
    ).toBeInTheDocument()
    expect(
      within(mailCard).getByText('Private images: your ghcr.io login'),
    ).toBeInTheDocument()
    expect(
      within(mailCard).getByRole('button', { name: 'Deploy' }),
    ).toBeEnabled()

    const wikiCard = card('Wiki')
    expect(within(wikiCard).getByText('Deployed')).toBeInTheDocument()
    // Where the app is, once deployed
    expect(
      within(wikiCard).getByRole('link', { name: 'https://wiki.dev.test' }),
    ).toHaveAttribute('href', 'https://wiki.dev.test')
    expect(
      within(wikiCard).getByRole('link', { name: 'Open in Dockhand' }),
    ).toHaveAttribute('href', 'https://docker.dev.test/stacks')
    expect(
      within(wikiCard).queryByRole('button', { name: 'Deploy' }),
    ).not.toBeInTheDocument()
  })

  test('filters the templates by text, source and status, with chips', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/docker', {
      stacks: { available: true, stacks: ['wiki'] },
    })
    act(() => events.emit('templates', [mail, wiki]))

    await user.type(
      await screen.findByRole('searchbox', { name: 'Filter templates' }),
      'docs',
    )
    expect(await screen.findByRole('listitem', { name: 'Wiki' })).toBeVisible()
    expect(
      screen.queryByRole('listitem', { name: 'Mailpit' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 templates')).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Remove Search: docs' }),
    )

    // Each value counts the templates the other filters keep
    await user.click(screen.getByRole('button', { name: 'Source' }))
    expect(
      within(screen.getByRole('option', { name: /^acme/ })).getByText('1'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /^acme/ }))
    await user.keyboard('{Escape}')
    expect(
      await screen.findByRole('listitem', { name: 'Mailpit' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('listitem', { name: 'Wiki' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await user.click(screen.getByRole('button', { name: 'Status' }))
    await user.click(screen.getByRole('option', { name: /^Deployed/ }))
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('listitem', { name: 'Wiki' })).toBeVisible()
    expect(
      screen.queryByRole('listitem', { name: 'Mailpit' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Status: Deployed' }),
    ).toBeInTheDocument()
  })

  test('pages the cards', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/docker')
    act(() =>
      events.emit(
        'templates',
        Array.from({ length: 51 }, (_, index) =>
          buildCatalogTemplate({
            id: `acme/app-${index + 1}`,
            folder: `app-${index + 1}`,
            name: `app-${index + 1}`,
            title: `App ${String(index + 1).padStart(2, '0')}`,
          }),
        ),
      ),
    )

    const cards = () =>
      within(screen.getByRole('list', { name: 'Templates' })).getAllByRole(
        'listitem',
      )
    expect(await screen.findByText('Page 1 of 2')).toBeVisible()
    expect(cards()).toHaveLength(50)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(cards()).toHaveLength(1)
    expect(screen.getByRole('listitem', { name: 'App 51' })).toBeVisible()
  })

  test('deploys a template in the terminal, through the agent', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/docker')
    act(() => {
      events.emit('templates', [mail])
      events.emit('agent', available)
    })

    await user.click(
      within(
        await screen.findByRole('listitem', { name: 'Mailpit' }),
      ).getByRole('button', { name: 'Deploy' }),
    )

    const sheet = await screen.findByRole('dialog', { name: /Terminal/ })
    const socket = FakeWebSocket.last()
    act(() => {
      socket.accept()
      socket.receive({ type: 'state', run: null, replay: true })
    })
    expect(socket.sent).toContainEqual(
      expect.objectContaining({
        type: 'start',
        command: 'deploy',
        template: 'acme/mail',
      }),
    )
    act(() =>
      socket.receive({
        type: 'state',
        run: {
          command: 'deploy',
          template: 'acme/mail',
          status: 'running',
          exitCode: null,
          startedAt: '2026-11-10T10:00:00Z',
        },
        replay: false,
      }),
    )
    // What runs, to run it in a terminal instead
    expect(
      within(sheet).getByText('local-env deploy acme/mail'),
    ).toBeInTheDocument()
  })

  test('says how to deploy when the agent is not running', async () => {
    const { events } = await renderApp('/docker')
    act(() => {
      events.emit('templates', [mail])
      events.emit('agent', { available: false, version: null, run: null })
    })

    expect(
      within(
        await screen.findByRole('listitem', { name: 'Mailpit' }),
      ).getByRole('button', { name: 'Deploy' }),
    ).toBeDisabled()
  })

  test('says when the sources have no templates', async () => {
    const { events } = await renderApp('/docker')
    act(() => events.emit('templates', []))

    expect(await screen.findByText('No templates yet')).toBeVisible()
  })

  test('opens the Routes tab from the address', async () => {
    const user = userEvent.setup()
    const { events, router } = await renderApp('/docker')
    act(() => events.emit('templates', [mail]))

    await user.click(screen.getByRole('tab', { name: 'Routes' }))

    expect(router.state.location.search).toEqual({ tab: 'routes' })
    expect(
      await screen.findByRole('searchbox', { name: 'Filter routes' }),
    ).toBeVisible()
  })
})
