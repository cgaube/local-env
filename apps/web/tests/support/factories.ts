import type {
  Role,
  Route,
  Service,
  Source,
  Tools,
} from '#ui/features/live-data/live-data.ts'

export const buildRoute = (overrides: Partial<Route> = {}): Route => ({
  hosts: ['mail.dev.test'],
  url: 'https://mail.dev.test',
  container: 'mailpit',
  stack: 'mailpit',
  port: '8025',
  status: 'healthy',
  ...overrides,
})

export const buildService = (overrides: Partial<Service> = {}): Service => ({
  service: 'dockhand',
  description: 'Docker UI: deploy and manage stacks from your templates',
  app: { name: 'Dockhand', content: 'docker' },
  container: 'local-env-dockhand',
  url: 'https://docker.dev.test',
  ports: [3000],
  state: 'healthy',
  ...overrides,
})

export const buildSource = (overrides: Partial<Source> = {}): Source => ({
  name: 'acme',
  origin: 'https://github.com/acme/local-env-templates',
  docker: 3,
  ansible: 0,
  ...overrides,
})

export const buildRole = (overrides: Partial<Role> = {}): Role => {
  const source = overrides.source ?? 'acme'
  const name = overrides.name ?? 'git'
  return {
    id: `${source}/${name}`,
    source,
    folder: name,
    name,
    collection: null,
    label: name,
    description: 'Git, from Homebrew',
    tags: ['vcs'],
    dependencies: [],
    isProfile: false,
    stacks: [],
    revision: 'a1b2c3d4e5f6',
    needsSudo: false,
    ...overrides,
  }
}

export const buildTools = (overrides: Partial<Tools> = {}): Tools => ({
  roles: [buildRole()],
  picked: [],
  installed: {},
  profile: null,
  stacks: {},
  ...overrides,
})
