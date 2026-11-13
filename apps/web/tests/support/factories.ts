import type { LoginRow } from '#services/dashboard/agent-protocol.ts'
import type {
  CatalogTemplate,
  Role,
  RoleInput,
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
  app: { name: 'Dockhand' },
  container: 'local-env-dockhand',
  url: 'https://docker.dev.test',
  ports: [3000],
  state: 'healthy',
  ...overrides,
})

export const buildSource = (overrides: Partial<Source> = {}): Source => ({
  name: 'acme',
  label: null,
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
    galaxy: {},
    inputs: [],
    secrets: [],
    ...overrides,
  }
}

export const buildInput = (
  name: string,
  overrides: Partial<RoleInput> = {},
): RoleInput => ({
  name,
  type: 'str',
  required: false,
  choices: null,
  description: null,
  secret: false,
  ...overrides,
})

export const buildTools = (overrides: Partial<Tools> = {}): Tools => ({
  roles: [buildRole()],
  picked: [],
  installed: {},
  profile: null,
  stacks: {},
  variables: {},
  galaxyRoles: [],
  bootstraps: [],
  ...overrides,
})

export const buildLogin = (overrides: Partial<LoginRow> = {}): LoginRow => ({
  type: 'aws',
  name: 'acme-dev',
  title: 'AWS 123456789012 (Dev)',
  sources: ['acme'],
  state: 'logged-in',
  detail: 'as arn:aws:sts::123456789012:assumed-role/Dev/octocat',
  command: null,
  help: null,
  ...overrides,
})

export const buildCatalogTemplate = (
  overrides: Partial<CatalogTemplate> = {},
): CatalogTemplate => ({
  id: 'acme/mail',
  source: 'acme',
  folder: 'mail',
  title: 'Mailpit',
  description: 'Catches the emails your apps send.',
  logo: null,
  categories: ['mail'],
  name: 'mailpit',
  variables: [],
  secrets: [],
  unmasked: [],
  registries: [],
  hosts: ['mail'],
  ...overrides,
})
