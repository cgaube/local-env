import { createLiveDataStore } from '#ui/features/live-data/live-data.ts'
import { FakeEventSource } from '../../support/fake-event-source.ts'
import { buildRoute } from '../../support/factories.ts'

const setup = () => {
  const connections: FakeEventSource[] = []
  const store = createLiveDataStore(() => {
    const events = new FakeEventSource()
    connections.push(events)
    return events as unknown as EventSource
  })
  return { store, connections }
}

describe('createLiveDataStore', () => {
  test('connects on the first subscriber and keeps the lists it receives', () => {
    const { store, connections } = setup()
    const listener = vi.fn()

    store.subscribe(listener)
    connections[0]?.emit('routes', [buildRoute()])

    expect(connections).toHaveLength(1)
    expect(listener).toHaveBeenCalled()
    expect(store.getSnapshot()).toMatchObject({
      routes: [buildRoute()],
      services: null,
      connected: true,
    })
  })

  test('shares one connection and closes it after the last subscriber', () => {
    const { store, connections } = setup()

    const first = store.subscribe(() => {})
    const second = store.subscribe(() => {})
    first()

    expect(connections).toHaveLength(1)
    expect(connections[0]?.closed).toBe(false)
    second()
    expect(connections[0]?.closed).toBe(true)
  })

  test('marks the data as disconnected on an error', () => {
    const { store, connections } = setup()
    store.subscribe(() => {})
    connections[0]?.emit('routes', [])

    connections[0]?.emit('error')

    expect(store.getSnapshot().connected).toBe(false)
  })
})
