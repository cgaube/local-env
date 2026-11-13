import type {
  LoginRow,
  LoginsResponse,
} from '#services/dashboard/agent-protocol.ts'
import type { AgentState, Service } from '#ui/features/live-data/live-data.ts'
import type { WantedInput } from '#services/dashboard/role-graph.ts'
import { accountLabel, stateLabel } from '#ui/features/logins/logins.ts'
import { tone } from '#ui/features/status/tone.ts'
import { plural } from '#ui/lib/plural.ts'
import {
  bootstrapCommand,
  type BootstrapRow,
} from '#ui/features/bootstrap/bootstrap.ts'

// What needs you, at the top of the overview: each problem the dashboard
// can see, with what to do about it. A command to run in your terminal (the
// dashboard runs nothing on the Mac but install and update), or a page.

export type AttentionAction =
  | { kind: 'command'; command: string }
  | { kind: 'link'; to: '/tools'; label: string }

export type AttentionItem = {
  id: string
  title: string
  detail: string | null
  action: AttentionAction | null
}

const START = { kind: 'command', command: 'local-env start' } as const

// A login that waits for you. Not one you chose not to be asked about.
const needsYou = ({ state }: LoginRow) =>
  state === 'logged-out' || state === 'no-cli' || state === 'unknown'

const loginItem = (login: LoginRow): AttentionItem => ({
  id: `login:${login.type}:${login.title}`,
  title: `${login.name}: ${stateLabel(login.state).toLowerCase()}`,
  detail: [
    `${accountLabel(login)}, for ${login.sources.join(', ')}`,
    login.state === 'unknown' ? login.detail : null,
    login.help,
  ]
    .filter(Boolean)
    .join('. '),
  action: login.command ? { kind: 'command', command: login.command } : null,
})

// A bootstrap that never ran, changed since it ran, or can't run
const bootstrapItem = (bootstrap: BootstrapRow): AttentionItem => {
  const roles = bootstrap.labels.join(', ')
  if (bootstrap.state === 'blocked') {
    return {
      id: `bootstrap:${bootstrap.source}`,
      title: `The bootstrap of ${bootstrap.source} can't run`,
      detail: bootstrap.problems.join(' '),
      action: null,
    }
  }
  return {
    id: `bootstrap:${bootstrap.source}`,
    title:
      bootstrap.state === 'changed'
        ? `The bootstrap of ${bootstrap.source} changed`
        : `The bootstrap of ${bootstrap.source} never ran`,
    detail: `${roles}: it makes your Mac ready for the logins of ${bootstrap.source}. Install runs it first.`,
    action: { kind: 'command', command: bootstrapCommand(bootstrap.source) },
  }
}

export const attentionItems = ({
  services,
  agent,
  logins,
  tools,
  bootstraps = [],
}: {
  // null until the server sent them
  services: Service[] | null
  agent: AgentState | null
  // undefined while the agent checks them
  logins: LoginsResponse | undefined
  // What the next install changes and lacks (useToolChanges)
  tools: {
    count: number
    missing: WantedInput[]
    secrets: WantedInput[]
  }
  // The sources' bootstraps (bootstrapRows)
  bootstraps?: BootstrapRow[]
}): AttentionItem[] => {
  const items: AttentionItem[] = []

  if (services && services.length === 0) {
    items.push({
      id: 'services',
      title: 'The core services are not running',
      detail: 'The proxy, Dockhand and the dashboard start with local-env.',
      action: START,
    })
  } else if (services) {
    const down = services.filter(({ state }) => tone(state) === 'bad')
    if (down.length > 0) {
      items.push({
        id: 'services',
        title: `${plural(down.length, 'core service')} not running`,
        detail: down
          .map(({ service, state }) => `${service} (${state})`)
          .join(', '),
        action: START,
      })
    }
  }

  if (agent && !agent.available) {
    items.push({
      id: 'agent',
      title: 'The dashboard agent is not running',
      detail:
        'It runs Install and Update for the dashboard, and checks your logins.',
      action: START,
    })
  }

  if (logins?.available) {
    items.push(...logins.logins.filter(needsYou).map(loginItem))
  }

  for (const bootstrap of bootstraps.filter(({ state }) => state !== 'done')) {
    items.push(bootstrapItem(bootstrap))
  }

  if (tools.secrets.length > 0) {
    items.push({
      id: 'secrets',
      title: `${plural(tools.secrets.length, 'secret')} that no source gives`,
      detail: `${tools.secrets.map(({ name, roles }) => `${name} (${roles.join(', ')})`).join(', ')}: the install stops before it runs.`,
      action: { kind: 'link', to: '/tools', label: 'Open Tools' },
    })
  }

  if (tools.missing.length > 0) {
    items.push({
      id: 'missing',
      title: `${plural(tools.missing.length, 'value')} your tools need`,
      detail: tools.missing.map(({ name }) => name).join(', '),
      action: { kind: 'link', to: '/tools', label: 'Set them' },
    })
  }

  if (tools.count > 0) {
    items.push({
      id: 'tools',
      title: `${plural(tools.count, 'tool')} to install or update`,
      detail: null,
      action: { kind: 'link', to: '/tools', label: 'Open Tools' },
    })
  }

  return items
}
