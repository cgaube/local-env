import type {
  Route,
  Service,
  Source,
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
