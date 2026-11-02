import type { Environment } from '#cli/providers/docker/environments.js'

export type DockhandEnvironment = Environment & { socketPath?: string }

export type DockhandTemplateSource = {
  id: number
  name: string
  url: string
  enabled: boolean
  builtin: boolean
}

// A stack deployed through Dockhand, with the compose file it runs
export type DockhandStack = {
  name: string
  content: string
  // Unix seconds, like Dockhand's containerDetails
  createdAt: number
  variables: string[]
}

// The result of Dockhand's image check for one container
export type DockhandContainerUpdate = {
  containerId: string
  containerName: string
  hasUpdate: boolean
  systemContainer: string | null
  updateDisabled: boolean
}

// The Local environment provisioning creates
export const buildDockhandEnvironment = (
  overrides: Partial<DockhandEnvironment> = {},
): DockhandEnvironment => ({
  id: 1,
  name: 'Local',
  connectionType: 'socket',
  socketPath: '/var/run/docker.sock',
  ...overrides,
})

export const buildDockhandTemplateSource = (
  overrides: Partial<DockhandTemplateSource> = {},
): DockhandTemplateSource => ({
  id: 1,
  name: 'acme',
  url: 'http://catalog-server:8080/acme/templates.json',
  enabled: true,
  builtin: false,
  ...overrides,
})

export const buildDockhandStack = (
  overrides: Partial<DockhandStack> & Pick<DockhandStack, 'content'>,
): DockhandStack => ({
  name: 'hello',
  createdAt: Math.floor(Date.now() / 1000),
  variables: [],
  ...overrides,
})

export const buildContainerUpdate = (
  overrides: Partial<DockhandContainerUpdate> = {},
): DockhandContainerUpdate => ({
  containerId: 'abc123',
  containerName: 'hello-hello-1',
  hasUpdate: true,
  systemContainer: null,
  updateDisabled: false,
  ...overrides,
})

// A Dockhand where `local-env start` already ran: provisioning changes nothing
export const provisionedDockhand = () => ({
  environments: [buildDockhandEnvironment()],
  exposure: { warn: true, dismissed: true },
  updateChecks: {
    1: { enabled: true, autoUpdate: true, cron: '0 10,14 * * 1-5' },
  },
})
