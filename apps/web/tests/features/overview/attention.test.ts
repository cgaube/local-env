import { attentionItems } from '#ui/features/overview/attention.ts'
import type { WantedInput } from '#services/dashboard/role-graph.ts'
import {
  buildInput,
  buildLogin,
  buildService,
} from '#ui-tests/support/factories.ts'

const AGENT = { available: true, version: '0.6.1', run: null } as const
const NO_TOOLS = { count: 0, missing: [], secrets: [] }

const wanted = (name: string, roles: string[]): WantedInput => ({
  ...buildInput(name, { required: true }),
  roles,
  setBy: [],
  provided: false,
  vault: false,
  conflict: false,
})

describe('attentionItems', () => {
  test('is empty when all runs and nothing waits', () => {
    expect(
      attentionItems({
        services: [buildService()],
        agent: AGENT,
        logins: { available: true, logins: [buildLogin()] },
        tools: NO_TOOLS,
      }),
    ).toEqual([])
  })

  test('names the core services that are down, and how to start them', () => {
    const [item] = attentionItems({
      services: [
        buildService(),
        buildService({ service: 'proxy', state: 'exited' }),
      ],
      agent: AGENT,
      logins: undefined,
      tools: NO_TOOLS,
    })

    expect(item).toEqual({
      id: 'services',
      title: '1 core service not running',
      detail: 'proxy (exited)',
      action: { kind: 'command', command: 'local-env start' },
    })
  })

  test('says when nothing runs, and when the agent is stopped', () => {
    const items = attentionItems({
      services: [],
      agent: { available: false, version: null, run: null },
      logins: { available: false },
      tools: NO_TOOLS,
    })

    expect(items.map(({ id, title }) => [id, title])).toEqual([
      ['services', 'The core services are not running'],
      ['agent', 'The dashboard agent is not running'],
    ])
  })

  test('lists the logins that wait for you, with their command', () => {
    const items = attentionItems({
      services: [buildService()],
      agent: AGENT,
      logins: {
        available: true,
        logins: [
          buildLogin(),
          buildLogin({
            type: 'vault',
            name: 'data',
            title: 'Vault vault.acme.test',
            state: 'logged-out',
            detail: null,
            command: 'local-env sources login acme --login data',
            help: 'Ask #data for the developer role',
          }),
          // Chosen not to be asked about again: not a problem
          buildLogin({ type: 'registry', name: 'ghcr', state: 'not-asked' }),
        ],
      },
      tools: NO_TOOLS,
    })

    expect(items).toEqual([
      {
        id: 'login:vault:Vault vault.acme.test',
        title: 'data: logged out',
        detail:
          'Vault vault.acme.test, for acme. Ask #data for the developer role',
        action: {
          kind: 'command',
          command: 'local-env sources login acme --login data',
        },
      },
    ])
  })

  test('points to Tools for the next install, its values and its secrets', () => {
    const items = attentionItems({
      services: [buildService()],
      agent: AGENT,
      logins: undefined,
      tools: {
        count: 2,
        missing: [wanted('git_email', ['git'])],
        secrets: [wanted('deploy_token', ['Deploy'])],
      },
    })

    expect(items.map(({ id, title, action }) => [id, title, action])).toEqual([
      [
        'secrets',
        '1 secret that no source gives',
        { kind: 'link', to: '/tools', label: 'Open Tools' },
      ],
      [
        'missing',
        '1 value your tools need',
        { kind: 'link', to: '/tools', label: 'Set them' },
      ],
      [
        'tools',
        '2 tools to install or update',
        { kind: 'link', to: '/tools', label: 'Open Tools' },
      ],
    ])
  })
})
