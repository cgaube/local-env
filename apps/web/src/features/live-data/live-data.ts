// What services/dashboard/server.ts streams on /api/events: proxy-connector's
// routes and core services, the sources' content counts and the tools
// (services/dashboard/tools.ts)

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

// An Ansible role of a source
export type Role = {
  // <source>/<name>
  id: string
  source: string
  // Its folder in the source's ansible/: <collection>/roles/<role>, or
  // <role>
  folder: string
  // <namespace>.<collection>.<role>, or <role> for a plain role
  name: string
  // <namespace>.<collection>, or null for a plain role
  collection: string | null
  // The name to show: `label` of its local-env.yml, else its folder,
  // title-cased
  label: string
  description: string | null
  tags: string[]
  dependencies: string[]
  // Tagged `profile`: a set of roles, picked as a whole
  isProfile: boolean
  // Stack templates it needs, as <source>/<folder>
  stacks: string[]
  // Hash of its files, recorded by each install
  revision: string
  needsSudo: boolean
  // The Galaxy collections its collection needs (galaxy.yml), by name: their
  // version ranges. `local-env install` installs them.
  galaxy: Record<string, string>
}

export type Tools = {
  roles: Role[]
  // Ids of the roles picked in the catalog
  picked: string[]
  // What `local-env install` ran, by id
  installed: Record<string, { revision: string; installedAt: string }>
  // Id of the profile, picked in the sidebar or by `local-env install
  // <profile>`. One no longer in a source is the CLI's to drop.
  profile: string | null
  // The stacks `local-env install` deployed for the roles, by template
  // (<source>/<folder>): once each, even if removed since
  stacks: Record<string, { stack: string; by: string; deployedAt: string }>
}

export type LiveData = {
  // null until the server sent the list
  routes: Route[] | null
  services: Service[] | null
  sources: Source[] | null
  tools: Tools | null
  connected: boolean
  updatedAt: Date | null
}

const TOPICS = ['routes', 'services', 'sources', 'tools'] as const

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
    tools: null,
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
