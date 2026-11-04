import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { playbookEvents } from '#cli-tests/support/factories/ansible.js'
import { TEST_DOMAIN } from '#cli-tests/support/factories/config.js'
import {
  buildDockhandStack,
  provisionedDockhand,
} from '#cli-tests/support/factories/dockhand.js'
import { buildTemplate } from '#cli-tests/support/factories/template.js'
import { machineReady } from '#cli-tests/support/machine.js'
import { COMPILED, createCli, type Cli } from '#cli-tests/support/run-cli.js'

// A source with these roles, cloned like `local-env sources add` does
const sourceWithRoles = async (
  cli: Cli,
  roles: string[],
  files: Record<string, string> = {},
) => {
  const acme = cli.createSource('acme', { roles })
  if (Object.keys(files).length > 0) acme.commit(files)
  await cli.run(['sources', 'add', acme.dir])
  return acme
}

// The roles of the playbook the last install ran, by source/name
const rolesRun = (cli: Cli) => {
  const run = cli.bin.calls('ansible-playbook').at(-1)
  const playbook = run?.args.at(-1) ?? ''
  const plays = Bun.YAML.parse(run?.inputs[playbook] ?? '[]') as {
    roles: { role: string }[]
  }[]
  return plays.flatMap(({ roles }) =>
    roles.map(
      ({ role }) =>
        `${basename(role.split('/ansible/')[0]!)}/${basename(role)}`,
    ),
  )
}

// A source with a profile: backend, made of base (itself a profile) and node
const sourceWithProfiles = (cli: Cli) =>
  sourceWithRoles(cli, ['git', 'node', 'backend', 'base', 'frontend'], {
    'ansible/backend/meta/main.yml':
      'galaxy_info:\n  galaxy_tags: [profile]\ndependencies: [base, node]\n',
    'ansible/base/meta/main.yml':
      'galaxy_info:\n  galaxy_tags: [profile]\ndependencies: [git]\n',
    'ansible/frontend/meta/main.yml':
      'galaxy_info:\n  galaxy_tags: [profile]\ndependencies: [node]\n',
  })

const MAIL = [
  'name: mail',
  'services:',
  '  mail:',
  '    image: axllent/mailpit',
  '',
].join('\n')

const TUNNEL = [
  'name: tunnel',
  'services:',
  '  tunnel:',
  '    image: ngrok/ngrok',
  '    environment:',
  '      NGROK_AUTHTOKEN: ${NGROK_AUTHTOKEN:?Your ngrok token}',
  '      REGION: ${REGION:-eu}',
  '',
].join('\n')

// The backend profile, which needs the mail stack; the tunnel tool needs the
// tunnel stack
const sourceWithStacks = async (cli: Cli) => {
  const acme = cli.createSource('acme', {
    roles: ['git', 'backend', 'tunnel'],
    templates: [
      buildTemplate({ folder: 'mail', compose: MAIL }),
      buildTemplate({ folder: 'tunnel', compose: TUNNEL }),
    ],
  })
  acme.commit({
    'ansible/backend/meta/main.yml':
      'galaxy_info:\n  galaxy_tags: [profile]\ndependencies: [git]\n',
    'ansible/backend/local-env.yml': 'stacks: [mail]\n',
    'ansible/tunnel/local-env.yml': 'stacks: [tunnel]\n',
  })
  await cli.run(['sources', 'add', acme.dir])
  return acme
}

// The stacks the CLI created in Dockhand, with what it sent
const createdStacks = (cli: Cli) =>
  cli.dockhand.requests
    .filter(({ method, path }) => method === 'POST' && path === '/stacks')
    .map(({ body }) => body as Record<string, unknown>)

const createInstallCli = async () => {
  const cli = await createCli({ dockhand: provisionedDockhand() })
  cli.home.seedConfig()
  machineReady(cli)
  cli.bin.on('which', ['ansible-playbook'])
  cli.bin.on('ansible-playbook', [])
  return cli
}

describe.concurrent('local-env install', () => {
  test('runs the picked tools playbook on this Mac', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git', 'node'])
    cli.home.seedPickedTools(['acme/git', 'acme/node'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Installed 2 tools')
    const [run] = cli.bin.calls('ansible-playbook')
    expect(run?.args.slice(0, 2)).toEqual(['--inventory', 'localhost,'])
    expect(rolesRun(cli)).toEqual(['acme/git', 'acme/node'])
    // Written for the run, then removed
    expect(existsSync(run!.args[2]!)).toBe(false)
    // Dependencies are found by name in every source
    expect(run?.env.ANSIBLE_ROLES_PATH).toBe(
      cli.home.path('volumes/sources/acme/ansible'),
    )
    // Its events, drawn by local-env
    expect(run?.env.ANSIBLE_STDOUT_CALLBACK).toBe('ansible.posix.jsonl')
  })

  test("shows Ansible's own output with --verbose", async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'])
    cli.home.seedPickedTools(['acme/git'])
    cli.bin.on('ansible-playbook', [], { stdout: 'PLAY [local-env tools]\n' })

    const result = await cli.run(['install', '--verbose'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('PLAY [local-env tools]')
    expect(
      cli.bin.calls('ansible-playbook')[0]?.env.ANSIBLE_STDOUT_CALLBACK,
    ).toBeUndefined()
  })

  test('records what it installed, for the dashboard', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'])
    cli.home.seedPickedTools(['acme/git'])

    await cli.run(['install'])

    const installed = cli.home.readJson<
      Record<string, { revision: string; installedAt: string }>
    >('volumes/tools/installed.json')
    expect(Object.keys(installed)).toEqual(['acme/git'])
    expect(installed['acme/git']?.revision).toMatch(/^[0-9a-f]{12}$/)
    expect(Date.parse(installed['acme/git']!.installedAt)).not.toBeNaN()
  })

  test.skipIf(COMPILED)(
    'asks for the sudo password when a role needs it',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithRoles(cli, ['dns'], {
        'ansible/dns/tasks/main.yml':
          '- name: resolver\n  become: true\n  ansible.builtin.file:\n    path: /etc/resolver\n    state: directory\n',
      })
      cli.home.seedPickedTools(['acme/dns'])

      const result = await cli.run(['install'], {
        answers: [{ ask: 'Your password, for sudo (dns)', answer: 'secret' }],
      })

      expect(result.exitCode).toBe(0)
      // Ansible reads it from a file, removed once the run ends
      const file =
        cli.bin.calls('ansible-playbook')[0]?.env.ANSIBLE_BECOME_PASSWORD_FILE
      expect(file).toBeString()
      expect(existsSync(file!)).toBe(false)
    },
  )

  test.skipIf(COMPILED)(
    'asks for it too when a dependency needs it',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithRoles(cli, ['base', 'backend'], {
        'ansible/base/tasks/main.yml': '- name: x\n  become: yes\n  ping:\n',
        'ansible/backend/meta/main.yml': 'dependencies:\n  - role: base\n',
      })
      cli.home.seedPickedTools(['acme/backend'])

      const result = await cli.run(['install'], {
        answers: [{ ask: 'Your password, for sudo (base)', answer: 'secret' }],
      })

      expect(result.exitCode).toBe(0)
    },
  )

  test.skipIf(COMPILED)(
    'removes the password when stopped halfway',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithRoles(cli, ['dns'], {
        'ansible/dns/tasks/main.yml': '- name: x\n  become: true\n  ping:\n',
      })
      cli.home.seedPickedTools(['acme/dns'])
      cli.bin.on('ansible-playbook', [], { runMs: 30_000 })

      for (const send of ['SIGINT', 'SIGTERM'] as const) {
        const result = await cli.run(['install'], {
          answers: [{ ask: 'Your password, for sudo (dns)', answer: 'secret' }],
          signal: { send, after: 'ansible-playbook' },
        })

        expect(result.exitCode).toBe(send === 'SIGINT' ? 130 : 143)
        expect(result.output).toContain('Cancelled')
        expect(result.output).not.toContain('Failed')
        // Ansible had it, then the folder went
        const file = cli.bin.calls('ansible-playbook').at(-1)
          ?.env.ANSIBLE_BECOME_PASSWORD_FILE
        expect(file).toBeString()
        expect(existsSync(file!)).toBe(false)
        expect(readdirSync(cli.tmp)).not.toContainEqual(
          expect.stringMatching(/^local-env-install-/),
        )
      }
    },
    20_000,
  )

  test('removes the folders a killed install left', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'])
    cli.home.seedPickedTools(['acme/git'])
    // Its process is gone: no pid of a real process is this large
    const old = join(cli.tmp, 'local-env-install-old')
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, 'become'), 'secret\n')
    writeFileSync(join(old, 'pid'), '99999999')

    await cli.run(['install'])

    expect(existsSync(old)).toBe(false)
  })

  test('records the roles a picked role includes too', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git', 'backend'], {
      'ansible/backend/meta/main.yml': 'dependencies: [git]\n',
    })
    cli.home.seedPickedTools(['acme/backend'])

    await cli.run(['install'])

    expect(
      Object.keys(cli.home.readJson('volumes/tools/installed.json') as object),
    ).toEqual(['acme/backend', 'acme/git'])
  })

  test('records nothing when a task fails, and says why', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'])
    cli.home.seedPickedTools(['acme/git'])
    cli.bin.on('ansible-playbook', [], {
      stdout: playbookEvents([
        {
          role: 'git',
          task: 'Install git',
          result: 'failed',
          msg: 'Error: No available formula with the name "gti"',
        },
      ]),
      exitCode: 2,
    })

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('✗ Install git')
    expect(result.output).toContain('No available formula with the name "gti"')
    expect(result.output).toContain('Error installing tools')
    expect(cli.home.exists('volumes/tools/installed.json')).toBe(false)
  })

  test("shows Ansible's error when it stops before any task", async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'])
    cli.home.seedPickedTools(['acme/git'])
    cli.bin.on('ansible-playbook', [], {
      stderr: "ERROR! the role 'git' was not found\n",
      exitCode: 1,
    })

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("ERROR! the role 'git' was not found")
  })

  test('forgets the tools unpicked since their install', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git', 'node'])
    cli.home.seedPickedTools(['acme/git'])
    const installedAt = '2026-11-01T10:00:00.000Z'
    cli.home.writeJson('volumes/tools/installed.json', {
      'acme/git': { revision: 'old', installedAt },
      'acme/node': { revision: 'old', installedAt },
    })

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    // Last, where it is seen
    expect(
      result.output.indexOf('No longer wanted, still on this Mac'),
    ).toBeGreaterThan(result.output.indexOf('Installed 1 tool'))
    expect(result.output).toContain('┃  node')
    expect(
      Object.keys(cli.home.readJson('volumes/tools/installed.json') as object),
    ).toEqual(['acme/git'])
  })

  test('forgets them when nothing is picked any more', async () => {
    await using cli = await createInstallCli()
    cli.bin.on('open', [])
    await sourceWithRoles(cli, ['hello'])
    cli.home.seedPickedTools([])
    cli.home.writeJson('volumes/tools/installed.json', {
      'acme/hello': {
        revision: 'old',
        installedAt: '2026-11-01T10:00:00.000Z',
      },
    })

    const result = await cli.run(['install'])

    expect(result.output).toContain('┃  hello')
    expect(cli.home.readJson('volumes/tools/installed.json')).toEqual({})
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('opens the catalog when nothing is picked', async () => {
    await using cli = await createInstallCli()
    cli.bin.on('open', [])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    const catalog = `https://local-env.${TEST_DOMAIN}/tools`
    expect(result.output).toContain(`No tools picked yet`)
    expect(cli.bin.calls('open')[0]?.args).toEqual([catalog])
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('unpicks the tools that left their source, and installs the rest', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'])
    cli.home.seedPickedTools(['acme/git', 'acme/node'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'acme/node is no longer in your sources: unpicked.',
    )
    expect(cli.home.read('volumes/tools/playbook.yml')).not.toContain('node')
    expect(cli.bin.calls('ansible-playbook')).toHaveLength(1)
    expect(result.output).toContain('Installed 1 tool')
  })

  test('only unpicks when every picked tool left', async () => {
    await using cli = await createInstallCli()
    cli.bin.on('open', [])
    cli.home.seedPickedTools(['acme/node'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('No tools picked yet')
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('installs a profile and saves it as yours', async () => {
    await using cli = await createInstallCli()
    await sourceWithProfiles(cli)

    const result = await cli.run(['install', 'backend'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Installed the backend profile')
    expect(result.output).toContain('Profile: backend, now yours')
    // Not its tools: a profile can have hundreds
    expect(result.output).not.toContain('tools: git')
    expect(rolesRun(cli)).toEqual(['acme/backend'])
    expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
      profile: 'acme/backend',
    })
    // Its roles, and those of the profile it includes
    expect(
      Object.keys(cli.home.readJson('volumes/tools/installed.json') as object),
    ).toEqual(['acme/backend', 'acme/base', 'acme/git', 'acme/node'])
  })

  test('installs the saved profile with the picked tools', async () => {
    await using cli = await createInstallCli()
    await sourceWithProfiles(cli)
    cli.home.writeJson('volumes/tools/profile.json', {
      profile: 'acme/frontend',
    })
    cli.home.seedPickedTools(['acme/git', 'acme/frontend'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Installed the frontend profile and 1 tool')
    expect(result.output).toContain('Profile: frontend\n')
    expect(result.output).toContain(
      "Change it in the dashboard's sidebar, or with `local-env install <profile>`.",
    )
    expect(rolesRun(cli)).toEqual(['acme/frontend', 'acme/git'])
  })

  test('runs a pick the profile includes once, as part of it', async () => {
    await using cli = await createInstallCli()
    await sourceWithProfiles(cli)
    cli.home.writeJson('volumes/tools/profile.json', {
      profile: 'acme/frontend',
    })
    // node is in the frontend profile too
    cli.home.seedPickedTools(['acme/node', 'acme/git'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(rolesRun(cli)).toEqual(['acme/frontend', 'acme/git'])
    expect(result.output).toContain('Installed the frontend profile and 1 tool')
  })

  test('installs a profile without saving it with --no-save', async () => {
    await using cli = await createInstallCli()
    await sourceWithProfiles(cli)
    cli.home.writeJson('volumes/tools/profile.json', {
      profile: 'acme/frontend',
    })
    const installedAt = '2026-11-01T10:00:00.000Z'
    cli.home.writeJson('volumes/tools/installed.json', {
      'acme/frontend': { revision: 'old', installedAt },
      'acme/node': { revision: 'old', installedAt },
    })

    const result = await cli.run(['install', 'base', '--no-save'])

    expect(result.exitCode).toBe(0)
    expect(rolesRun(cli)).toEqual(['acme/base'])
    expect(result.output).toContain('Profile: base, this time only')
    expect(result.output).toContain('Your profile stays frontend.')
    expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
      profile: 'acme/frontend',
    })
    // The saved profile is still wanted
    expect(result.output).not.toContain('No longer wanted')
    expect(
      Object.keys(cli.home.readJson('volumes/tools/installed.json') as object),
    ).toEqual(['acme/frontend', 'acme/node', 'acme/base', 'acme/git'])
  })

  test('forgets the roles of the profile it replaces', async () => {
    await using cli = await createInstallCli()
    await sourceWithProfiles(cli)
    cli.home.writeJson('volumes/tools/profile.json', {
      profile: 'acme/backend',
    })
    const installedAt = '2026-11-01T10:00:00.000Z'
    cli.home.writeJson('volumes/tools/installed.json', {
      'acme/backend': { revision: 'old', installedAt },
      'acme/base': { revision: 'old', installedAt },
      'acme/git': { revision: 'old', installedAt },
      'acme/node': { revision: 'old', installedAt },
    })

    const result = await cli.run(['install', 'frontend'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('┃  backend, base, git')
    expect(
      Object.keys(cli.home.readJson('volumes/tools/installed.json') as object),
    ).toEqual(['acme/node', 'acme/frontend'])
  })

  test('stops on a name that is no profile', async () => {
    await using cli = await createInstallCli()
    await sourceWithProfiles(cli)

    const unknown = await cli.run(['install', 'mobile'])
    expect(unknown.exitCode).toBe(1)
    expect(unknown.output).toContain(
      'No profile named mobile. Profiles: backend, base, frontend.',
    )

    const tool = await cli.run(['install', 'git'])
    expect(tool.exitCode).toBe(1)
    expect(tool.output).toContain('git is a tool, not a profile')

    expect(cli.bin.calls('ansible-playbook')).toEqual([])
    expect(cli.home.exists('volumes/tools/profile.json')).toBe(false)
  })

  test('asks for the source of a profile two sources have', async () => {
    await using cli = await createInstallCli()
    await sourceWithProfiles(cli)
    const team = cli.createSource('team', { roles: ['backend'] })
    team.commit({
      'ansible/backend/meta/main.yml':
        'galaxy_info:\n  galaxy_tags: [profile]\n',
    })
    await cli.run(['sources', 'add', team.dir])

    const ambiguous = await cli.run(['install', 'backend'])
    expect(ambiguous.exitCode).toBe(1)
    expect(ambiguous.output).toContain('name one of acme/backend, team/backend')

    const named = await cli.run(['install', 'team/backend'])
    expect(named.exitCode).toBe(0)
    expect(rolesRun(cli)).toEqual(['team/backend'])
  })

  test('drops a saved profile that left the sources', async () => {
    await using cli = await createInstallCli()
    cli.bin.on('open', [])
    await sourceWithProfiles(cli)
    cli.home.writeJson('volumes/tools/profile.json', { profile: 'acme/mobile' })

    const result = await cli.run(['install'])

    expect(result.output).toContain(
      'Your profile, acme/mobile, is no longer in your sources',
    )
    expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
      profile: null,
    })
  })

  test('names the profiles when nothing is picked', async () => {
    await using cli = await createInstallCli()
    cli.bin.on('open', [])
    await sourceWithProfiles(cli)

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'Install a profile with `local-env install <profile>` (backend, base, frontend)',
    )
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test.skipIf(COMPILED)(
    'deploys the stacks of the profile once, linked to their template',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithStacks(cli)

      const result = await cli.run(['install', 'backend'], {
        answers: [
          {
            ask: 'Your tools need 1 stack (mail). Deploy it in Docker?',
            answer: true,
          },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('◇  Stacks')
      expect(result.output).toContain('mail deployed')
      expect(createdStacks(cli)).toEqual([
        expect.objectContaining({
          name: 'mail',
          compose: MAIL,
          start: true,
          pull: true,
          build: false,
          envVars: [],
        }),
      ])
      // `update` and `sources sync` merge from this version
      expect(
        cli.home.readJson('volumes/template-links.json') as object,
      ).toEqual({
        mail: {
          template: 'acme/mail',
          base: expect.stringMatching(/^[0-9a-f]{12}$/),
          how: 'name',
        },
      })
      expect(cli.home.readJson('volumes/tools/stacks.json')).toEqual({
        'acme/mail': {
          stack: 'mail',
          by: 'acme/backend',
          deployedAt: expect.any(String),
        },
      })

      // Once: the next install deploys nothing
      await cli.run(['install'])
      expect(createdStacks(cli)).toHaveLength(1)
    },
  )

  test('deploys them without asking with --yes', async () => {
    await using cli = await createInstallCli()
    await sourceWithStacks(cli)

    const result = await cli.run(['install', 'backend', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(createdStacks(cli).map(({ name }) => name)).toEqual(['mail'])
  })

  test('never deploys again a stack the user removed', async () => {
    await using cli = await createInstallCli()
    await sourceWithStacks(cli)
    cli.home.writeJson('volumes/tools/stacks.json', {
      'acme/mail': {
        stack: 'mail',
        by: 'acme/backend',
        deployedAt: '2026-11-01T10:00:00.000Z',
      },
    })

    const result = await cli.run(['install', 'backend', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(createdStacks(cli)).toEqual([])
  })

  test('leaves a stack of the same name alone, and records it', async () => {
    await using cli = await createInstallCli()
    await sourceWithStacks(cli)
    cli.dockhand.state.stacks.push(
      buildDockhandStack({ name: 'mail', content: 'name: mail\n' }),
    )

    const result = await cli.run(['install', 'backend', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(createdStacks(cli)).toEqual([])
    expect(cli.dockhand.state.stacks[0]?.content).toBe('name: mail\n')
    expect(
      Object.keys(cli.home.readJson('volumes/tools/stacks.json') as object),
    ).toEqual(['acme/mail'])
  })

  test.skipIf(COMPILED)(
    'asks for the variables a stack needs, a token as a secret',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithStacks(cli)
      cli.home.seedPickedTools(['acme/tunnel'])

      const result = await cli.run(['install', '--yes'], {
        answers: [
          { ask: 'tunnel: NGROK_AUTHTOKEN (Your ngrok token)', answer: 'tok' },
        ],
      })

      expect(result.exitCode).toBe(0)
      // REGION has a default: not asked
      expect(createdStacks(cli)[0]?.envVars).toEqual([
        { key: 'NGROK_AUTHTOKEN', value: 'tok', isSecret: true },
      ])
    },
  )

  test('deploys nothing without a terminal, and says how', async () => {
    await using cli = await createInstallCli()
    await sourceWithStacks(cli)
    cli.home.seedPickedTools(['acme/tunnel'])

    const asked = await cli.run(['install'], {
      env: { FAKE_PROMPTS_NO_TTY: '1' },
    })
    expect(asked.exitCode).toBe(0)
    expect(asked.output).toContain(
      'Your tools need tunnel, not deployed yet. Run local-env install in a terminal, or with --yes.',
    )

    // --yes can't ask for the token either
    const yes = await cli.run(['install', '--yes'], {
      env: { FAKE_PROMPTS_NO_TTY: '1' },
    })
    expect(yes.output).toContain('tunnel needs NGROK_AUTHTOKEN: not deployed')
    expect(createdStacks(cli)).toEqual([])
  })

  test('installs the tools when Dockhand does not answer', async () => {
    await using cli = await createInstallCli()
    await sourceWithStacks(cli)
    cli.dockhand.on(
      'GET /environments',
      () => new Response('Bad gateway', { status: 502 }),
    )

    const result = await cli.run(['install', 'backend', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("Dockhand doesn't answer")
    expect(result.output).toContain('Installed the backend profile')
  })

  test('stops when Ansible is not installed', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'])
    cli.home.seedPickedTools(['acme/git'])
    cli.bin.on('which', ['ansible-playbook'], { exitCode: 1 })

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Ansible is not installed')
  })
})

// Snapshots can't run concurrently
describe('local-env install output', () => {
  test('a group per role and a line per task, like the rest of the CLI', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['hello', 'colima'])
    cli.home.seedPickedTools(['acme/hello', 'acme/colima'])
    cli.bin.on('ansible-playbook', [], {
      stdout: playbookEvents([
        { role: 'hello', task: 'Say hello', result: 'ok', msg: 'Hello!' },
        {
          role: 'colima',
          task: 'Install Colima',
          result: 'changed',
          msg: 'Package installed: colima',
        },
        { role: 'colima', task: 'Look for a docker CLI', result: 'ok' },
        { role: 'colima', task: 'Install the docker CLI', result: 'skipped' },
      ]),
    })

    const result = await cli.run(['install'])

    expect(result.output).toMatchSnapshot()
  })
})
