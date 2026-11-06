import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import type { RunState } from '#services/dashboard/agent-protocol.ts'
import type { TerminalSession } from '#ui/features/terminal/terminal-session.ts'
import { buildRole, buildTools } from '#ui-tests/support/factories.ts'
import { FakeWebSocket } from '#ui-tests/support/fake-web-socket.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

// xterm needs a canvas: the output as text, and a field to type in
vi.mock('#ui/features/terminal/xterm-view/xterm-view.tsx', () => ({
  default: function FakeXterm({ session }: { session: TerminalSession }) {
    const decoder = new TextDecoder()
    const text = () =>
      session
        .output()
        .map((c) => decoder.decode(c))
        .join('')
    const [output, setOutput] = useState(text)
    useEffect(() => session.onOutput(() => setOutput(text())), [session])
    return (
      <div>
        <pre data-testid="terminal">{output}</pre>
        <input
          aria-label="Terminal input"
          onChange={(event) => session.input(event.target.value)}
        />
      </div>
    )
  },
}))

beforeEach(() => {
  FakeWebSocket.sockets = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})
afterEach(() => vi.unstubAllGlobals())

const run = (overrides: Partial<RunState> = {}): RunState => ({
  command: 'install',
  status: 'running',
  exitCode: null,
  startedAt: '2026-11-05T10:00:00Z',
  ...overrides,
})

const available = { available: true, version: '0.5.0', run: null }

// Update is in the menu of the version, at the bottom of the sidebar
const openVersionMenu = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole('button', { name: /v\d+\.\d+/ }))
const openUpdate = async (user: ReturnType<typeof userEvent.setup>) => {
  await openVersionMenu(user)
  await user.click(await screen.findByRole('menuitem', { name: 'Update' }))
}
const unavailable = { available: false, version: null, run: null }

const pickedTools = buildTools({
  roles: [buildRole()],
  picked: ['acme/git'],
})

describe('Terminal', () => {
  test('installs from the install dialog, in a terminal', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() => {
      events.emit('tools', pickedTools)
      events.emit('agent', available)
    })

    await user.click(await screen.findByRole('button', { name: /^Install/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Install 1 tool' })
    await user.click(within(dialog).getByRole('button', { name: 'Install' }))

    const sheet = await screen.findByRole('dialog', { name: /Terminal/ })
    const socket = FakeWebSocket.last()
    expect(socket.url).toMatch(/\/api\/terminal$/)
    act(() => {
      socket.accept()
      // Nothing runs yet: the page starts the install
      socket.receive({ type: 'state', run: null, replay: true })
    })
    expect(socket.sent).toContainEqual(
      expect.objectContaining({ type: 'start', command: 'install' }),
    )

    act(() => {
      socket.receive({ type: 'state', run: run(), replay: false })
      socket.print('Installing git\r\n')
    })
    expect(within(sheet).getByText('local-env install')).toBeInTheDocument()
    expect(within(sheet).getByText('Running')).toBeInTheDocument()
    expect(within(sheet).getByTestId('terminal')).toHaveTextContent(
      'Installing git',
    )

    // A prompt of the CLI, answered in the terminal
    await user.type(within(sheet).getByLabelText('Terminal input'), 'y')
    expect(socket.sent).toContainEqual({ type: 'input', data: 'y' })

    act(() =>
      socket.receive({
        type: 'state',
        run: run({ status: 'exited', exitCode: 0 }),
        replay: false,
      }),
    )
    expect(within(sheet).getByText('Done')).toBeInTheDocument()
  })

  test('gives the command when the agent is not running', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() => {
      events.emit('tools', pickedTools)
      events.emit('agent', unavailable)
    })

    await user.click(await screen.findByRole('button', { name: /^Install/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Install 1 tool' })

    expect(
      within(dialog).queryByRole('button', { name: 'Install' }),
    ).not.toBeInTheDocument()
    expect(within(dialog).getByText('local-env start')).toBeInTheDocument()
    expect(FakeWebSocket.sockets).toEqual([])
  })

  test('updates from the overview, across a restart of the dashboard', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() => events.emit('agent', available))

    await openUpdate(user)
    const sheet = await screen.findByRole('dialog', { name: /Terminal/ })
    const first = FakeWebSocket.last()
    act(() => {
      first.accept()
      first.receive({ type: 'state', run: null, replay: true })
    })
    expect(first.sent).toContainEqual(
      expect.objectContaining({ type: 'start', command: 'update' }),
    )
    act(() => {
      first.receive({
        type: 'state',
        run: run({ command: 'update' }),
        replay: false,
      })
      first.print('Pulling core images\r\n')
      first.drop()
    })
    expect(within(sheet).getByText('Reconnecting')).toBeInTheDocument()

    // A new socket: the agent replays the run, which goes on
    await waitFor(() => expect(FakeWebSocket.sockets).toHaveLength(2))
    const second = FakeWebSocket.last()
    act(() => {
      second.accept()
      second.receive({
        type: 'state',
        run: run({ command: 'update' }),
        replay: true,
      })
      second.print('Pulling core images\r\nRestarting changed services\r\n')
    })
    expect(within(sheet).getByText('Running')).toBeInTheDocument()
    expect(within(sheet).getByTestId('terminal').textContent).toBe(
      'Pulling core images\r\nRestarting changed services\r\n',
    )
    // Not started twice
    expect(second.sent).not.toContainEqual(
      expect.objectContaining({ type: 'start' }),
    )
  })

  test('says when another command already runs', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() => events.emit('agent', available))

    await openUpdate(user)
    const sheet = await screen.findByRole('dialog', { name: /Terminal/ })
    const socket = FakeWebSocket.last()
    act(() => {
      socket.accept()
      // An install started from another tab
      socket.receive({ type: 'state', run: run(), replay: true })
    })

    expect(
      within(sheet).getByText('local-env install is already running'),
    ).toBeInTheDocument()
    expect(socket.sent).toEqual([])
  })

  test('installs from the Tools page, with nothing waiting too', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/tools')
    act(() => {
      events.emit('tools', buildTools({ roles: [buildRole()] }))
      events.emit('agent', available)
    })

    await user.click(await screen.findByRole('button', { name: 'Install' }))
    await screen.findByRole('dialog', { name: /Terminal/ })
    const socket = FakeWebSocket.last()
    act(() => {
      socket.accept()
      socket.receive({ type: 'state', run: null, replay: true })
    })
    expect(socket.sent).toContainEqual(
      expect.objectContaining({ type: 'start', command: 'install' }),
    )
  })

  test('says when a run ends, with its terminal closed too', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    // The last run, ended before the page loaded: no news
    act(() =>
      events.emit('agent', {
        ...available,
        run: run({ status: 'exited', exitCode: 0, startedAt: 'earlier' }),
      }),
    )
    expect(screen.queryByText(/finished$/)).not.toBeInTheDocument()

    act(() => events.emit('agent', { ...available, run: run() }))
    act(() =>
      events.emit('agent', {
        ...available,
        run: run({ status: 'exited', exitCode: 2 }),
      }),
    )
    expect(
      await screen.findByText('local-env install failed'),
    ).toBeInTheDocument()
    expect(screen.getByText('It exited with code 2.')).toBeInTheDocument()

    // Show opens the terminal on that run. Sonner keeps the toasts of other
    // tests: this one's button.
    const failed = screen
      .getByText('local-env install failed')
      .closest<HTMLElement>('[data-sonner-toast]')!
    await user.click(within(failed).getByRole('button', { name: 'Show' }))
    expect(
      await screen.findByRole('dialog', { name: /Terminal/ }),
    ).toBeInTheDocument()
  })

  test('says when the run in the terminal finished', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() => events.emit('agent', available))

    await openUpdate(user)
    const socket = FakeWebSocket.last()
    act(() => {
      socket.accept()
      socket.receive({ type: 'state', run: null, replay: true })
      socket.receive({
        type: 'state',
        run: run({ command: 'update' }),
        replay: false,
      })
      socket.receive({
        type: 'state',
        run: run({ command: 'update', status: 'exited', exitCode: 0 }),
        replay: false,
      })
    })
    expect(
      await screen.findByText('local-env update finished'),
    ).toBeInTheDocument()
    // The agent topic says it too, later: still one toast
    act(() =>
      events.emit('agent', {
        ...available,
        run: run({ command: 'update', status: 'exited', exitCode: 0 }),
      }),
    )
    expect(screen.getAllByText('local-env update finished')).toHaveLength(1)
    // Its terminal is on screen: no Show
    const finished = screen
      .getByText('local-env update finished')
      .closest<HTMLElement>('[data-sonner-toast]')!
    expect(
      within(finished).queryByRole('button', { name: 'Show' }),
    ).not.toBeInTheDocument()
  })

  test('cannot update while the agent is not running', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() => events.emit('agent', unavailable))

    await openVersionMenu(user)
    expect(
      await screen.findByRole('menuitem', { name: 'Update' }),
    ).toHaveAttribute('aria-disabled', 'true')
  })
})
