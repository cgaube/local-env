import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeWebSocket } from '#ui-tests/support/fake-web-socket.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

beforeEach(() => {
  FakeWebSocket.sockets = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})
afterEach(() => vi.unstubAllGlobals())

const available = { available: true, version: '0.5.0', run: null }

describe('Command menu', () => {
  test('opens with ⌘K and runs local-env update in the terminal', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() => events.emit('agent', available))

    await user.keyboard('{Meta>}k{/Meta}')
    const menu = await screen.findByRole('dialog', { name: 'Commands' })
    await user.type(within(menu).getByRole('combobox'), 'update')
    await user.keyboard('{Enter}')

    await screen.findByRole('dialog', { name: /Terminal/ })
    const socket = FakeWebSocket.last()
    act(() => {
      socket.accept()
      socket.receive({ type: 'state', run: null, replay: true })
    })
    expect(socket.sent).toContainEqual(
      expect.objectContaining({ type: 'start', command: 'update' }),
    )
  })

  test('opens from its button and goes to a page', async () => {
    const user = userEvent.setup()
    const { router } = await renderApp('/')

    await user.click(screen.getByRole('button', { name: 'Commands' }))
    const menu = await screen.findByRole('dialog', { name: 'Commands' })
    await user.click(within(menu).getByRole('option', { name: 'Docker' }))

    expect(router.state.location.pathname).toBe('/docker')
  })

  test('disables the runs while the agent is not running', async () => {
    const user = userEvent.setup()
    const { events } = await renderApp('/')
    act(() =>
      events.emit('agent', { available: false, version: null, run: null }),
    )

    await user.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: 'Commands' })
    expect(
      within(menu).getByRole('option', { name: /Install tools/ }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(menu).getByRole('option', { name: /Update local-env/ }),
    ).toHaveAttribute('aria-disabled', 'true')
  })
})
