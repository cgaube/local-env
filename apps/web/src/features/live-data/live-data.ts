// What services/dashboard/server.ts streams on /api/events: proxy-connector's
// routes and core services, the sources' content counts, the tools
// (services/dashboard/tools.ts) and the dashboard agent
import type { AgentState } from '#services/dashboard/agent-protocol.ts'
import type { GalaxyRole, RoleInput } from '#services/dashboard/role-graph.ts'

export type { AgentState, GalaxyRole, RoleInput }

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
  // The label of its manifest (local-env.yml), else null
  label: string | null
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
  // The variables it passes to each dependency (`vars:`), in the same order
  dependencyVars?: Record<string, unknown>[]
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
  // The values it takes: its meta/argument_specs.yml
  inputs: RoleInput[]
}

export type Tools = {
  roles: Role[]
  // Ids of the roles picked in the catalog
  picked: string[]
  // What `local-env install` ran, by id, with the values its inputs got
  installed: Record<
    string,
    {
      revision: string
      installedAt: string
      values?: Record<string, unknown>
    }
  >
  // Id of the profile, picked in the sidebar or by `local-env install
  // <profile>`. One no longer in a source is the CLI's to drop.
  profile: string | null
  // The stacks `local-env install` deployed for the roles, by template
  // (<source>/<folder>): once each, even if removed since
  stacks: Record<string, { stack: string; by: string; deployedAt: string }>
  // The values of the roles' inputs, by variable name (variables.json)
  variables: Record<string, unknown>
  // The roles of the installed Galaxy collections: their inputs count once
  // a wanted role includes them
  galaxyRoles: GalaxyRole[]
}

export type LiveData = {
  // null until the server sent the list
  routes: Route[] | null
  services: Service[] | null
  sources: Source[] | null
  tools: Tools | null
  // Whether install and update can run from here, and the current run
  agent: AgentState | null
  connected: boolean
  updatedAt: Date | null
}

const TOPICS = ['routes', 'services', 'sources', 'tools', 'agent'] as const

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
    agent: null,
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
