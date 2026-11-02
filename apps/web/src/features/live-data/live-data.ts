// What services/dashboard/server.ts streams on /api/events: proxy-connector's
// routes and core services, and the sources' content counts

export type Route = {
  hosts: string[]
  url: string
  container: string
  stack: string | null
  port: string
  status: string
}

export type Service = {
  service: string
  description: string | null
  // A card on the overview. content is the source folder the app installs
  // from (docker, ansible), to count what it can install.
  app: { name: string; content: string | null } | null
  container: string
  url: string | null
  ports: number[]
  state: string
}

export type Source = {
  name: string
  origin: string | null
  docker: number
  ansible: number
}

export type LiveData = {
  // null until the server sent the list
  routes: Route[] | null
  services: Service[] | null
  sources: Source[] | null
  connected: boolean
  updatedAt: Date | null
}

const TOPICS = ['routes', 'services', 'sources'] as const

type Listener = () => void

// One connection for every component that reads the data, open while one of
// them is mounted. The server sends each list on connect and again when it
// changes; EventSource reconnects by itself after a drop.
export const createLiveDataStore = (
  connect: () => EventSource = () => new EventSource('/api/events'),
) => {
  let data: LiveData = {
    routes: null,
    services: null,
    sources: null,
    connected: false,
    updatedAt: null,
  }
  const listeners = new Set<Listener>()
  let source: EventSource | null = null

  const update = (patch: Partial<LiveData>) => {
    data = { ...data, ...patch }
    for (const listener of listeners) listener()
  }

  const open = () => {
    source = connect()
    source.addEventListener('open', () => update({ connected: true }))
    source.addEventListener('error', () => update({ connected: false }))
    for (const topic of TOPICS) {
      source.addEventListener(topic, (event) =>
        update({
          [topic]: JSON.parse((event as MessageEvent<string>).data),
          connected: true,
          updatedAt: new Date(),
        }),
      )
    }
  }

  return {
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      if (!source) open()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          source?.close()
          source = null
        }
      }
    },
    getSnapshot: () => data,
  }
}

export type LiveDataStore = ReturnType<typeof createLiveDataStore>
