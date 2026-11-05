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

// The roles of the playbook the last install ran: by source/name, or by
// their full name for the roles of a collection
const rolesRun = (cli: Cli) => {
  const run = cli.bin.calls('ansible-playbook').at(-1)
  const playbook = run?.args.at(-1) ?? ''
  const plays = Bun.YAML.parse(run?.inputs[playbook] ?? '[]') as {
    roles: { role: string }[]
  }[]
  return plays.flatMap(({ roles }) =>
    roles.map(({ role }) =>
      role.includes('/ansible/')
        ? `${basename(role.split('/ansible/')[0]!)}/${basename(role)}`
        : role,
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

// The backend profile of a collection that needs geerlingguy.mac from
// Galaxy, and acme.tools, which the source has
const sourceWithGalaxy = async (cli: Cli) => {
  const acme = cli.createSource('acme')
  acme.commit({
    'ansible/tools/galaxy.yml': 'namespace: acme\nname: tools\n',
    'ansible/tools/roles/git/tasks/main.yml': '- ping:\n',
    'ansible/profiles/galaxy.yml': [
      'namespace: acme',
      'name: profiles',
      'dependencies:',
      '  acme.tools: "*"',
      '  geerlingguy.mac: ">=5.0.0,<6.0.0"',
      '  community.general: ">=8.0.0"',
      '',
    ].join('\n'),
    'ansible/profiles/roles/backend/meta/main.yml': [
      'galaxy_info:',
      '  galaxy_tags: [profile]',
      'dependencies:',
      '  - acme.tools.git',
      '  - geerlingguy.mac.dock',
      '',
    ].join('\n'),
  })
  await cli.run(['sources', 'add', acme.dir])
  return acme
}

// The requirements file of the last ansible-galaxy call
const requirementsSent = (cli: Cli) => {
  const call = cli.bin.calls('ansible-galaxy').at(-1)
  const file = call?.args[call.args.indexOf('-r') + 1] ?? ''
  return Bun.YAML.parse(call?.inputs[file] ?? 'null')
}

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
    // Nothing to install from Galaxy
    expect(cli.bin.calls('ansible-galaxy')).toEqual([])
  })

  test('installs the Galaxy collections a profile needs, then runs it', async () => {
    await using cli = await createInstallCli()
    await sourceWithGalaxy(cli)
    cli.bin.on('ansible-galaxy', ['collection', 'install'], {
      stdout: [
        'geerlingguy.mac:5.0.0 was installed successfully',
        "'community.general:13.2.0' is already installed, skipping.",
        '',
      ].join('\n'),
    })

    // The user's own collections stay out
    const result = await cli.run(['install', 'backend'], {
      env: { ANSIBLE_COLLECTIONS_PATH: '/Users/someone/.ansible/collections' },
    })

    expect(result.exitCode).toBe(0)
    // A group, then a line per collection, like the playbook's tasks
    expect(result.output).toContain('Collections from Galaxy')
    expect(result.output).toContain('✓ geerlingguy.mac 5.0.0  installed')
    expect(result.output).toContain(
      '✓ community.general 13.2.0  already installed',
    )
    const [galaxy] = cli.bin.calls('ansible-galaxy')
    expect(galaxy?.args.slice(0, 2)).toEqual(['collection', 'install'])
    expect(galaxy?.args).not.toContain('--upgrade')
    // One file for all: acme.tools is linked from the source, not installed
    expect(requirementsSent(cli)).toEqual({
      collections: [
        { name: 'geerlingguy.mac', version: '>=5.0.0,<6.0.0' },
        { name: 'community.general', version: '>=8.0.0' },
      ],
    })
    // Into a lasting folder, local-env's only one: never the user's own
    const collections = cli.home.path('volumes/tools/collections')
    expect(galaxy?.env.ANSIBLE_COLLECTIONS_PATH).toBe(collections)
    const run = cli.bin.calls('ansible-playbook').at(-1)
    const [links, ...rest] = run?.env.ANSIBLE_COLLECTIONS_PATH?.split(':') ?? []
    expect(links).toMatch(/local-env-install-[^/]+\/collections$/)
    expect(rest).toEqual([collections])
    expect(rolesRun(cli)).toEqual(['acme.profiles.backend'])
  })

  test('titles each role by its label, a Galaxy role by its name', async () => {
    await using cli = await createInstallCli()
    const acme = await sourceWithGalaxy(cli)
    acme.commit({
      'ansible/tools/roles/git/local-env.yml': 'label: Git and friends\n',
    })
    await cli.run(['sources', 'sync', '--yes'])
    cli.bin.on('ansible-galaxy', ['collection', 'install'])
    cli.bin.on('ansible-playbook', [], {
      stdout: playbookEvents([
        { role: 'acme.tools.git', task: 'Install git', result: 'ok' },
        {
          role: 'geerlingguy.mac.dock',
          task: 'Install dockutil.',
          result: 'ok',
        },
      ]),
    })

    const result = await cli.run(['install', 'backend'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('◇  Git and friends')
    expect(result.output).not.toContain('◇  acme.tools.git')
    expect(result.output).toContain('◇  geerlingguy.mac.dock')
  })

  test('stops before the playbook when Galaxy fails, and says what asked', async () => {
    await using cli = await createInstallCli()
    await sourceWithGalaxy(cli)
    cli.bin.on('ansible-galaxy', ['collection', 'install'], {
      stderr: 'ERROR! Unknown error when attempting to call Galaxy',
      exitCode: 1,
    })

    const result = await cli.run(['install', 'backend'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Could not install the collections your tools need from Galaxy',
    )
    expect(result.output).toContain(
      'geerlingguy.mac >=5.0.0,<6.0.0 (acme/ansible/profiles/galaxy.yml)',
    )
    // ansible-galaxy's own words
    expect(result.output).toContain('Unknown error when attempting to call')
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test.skipIf(COMPILED)(
    'asks for the sudo password when an installed Galaxy role needs it',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithGalaxy(cli)
      cli.bin.on('ansible-galaxy', ['collection', 'install'])
      // Installed by an earlier run: dock depends on homebrew, which uses
      // sudo
      const mac =
        'volumes/tools/collections/ansible_collections/geerlingguy/mac'
      cli.home.write(
        `${mac}/roles/dock/meta/main.yml`,
        'dependencies: [homebrew]\n',
      )
      cli.home.write(`${mac}/roles/dock/tasks/main.yml`, '- ping:\n')
      cli.home.write(
        `${mac}/roles/homebrew/tasks/main.yml`,
        '- name: Prepare\n  become: true\n  ping:\n',
      )

      const result = await cli.run(['install', 'backend'], {
        answers: [
          {
            ask: 'Your password, for sudo (geerlingguy.mac.homebrew)',
            answer: 'secret',
          },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(
        cli.bin.calls('ansible-playbook')[0]?.env.ANSIBLE_BECOME_PASSWORD_FILE,
      ).toBeDefined()
    },
  )

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
        answers: [{ ask: 'Your password, for sudo (Dns)', answer: 'secret' }],
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
        answers: [{ ask: 'Your password, for sudo (Base)', answer: 'secret' }],
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
          answers: [{ ask: 'Your password, for sudo (Dns)', answer: 'secret' }],
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
    // At the end, where it is seen, just before the summary
    expect(
      result.output.indexOf('No longer wanted, still on this Mac'),
    ).toBeLessThan(result.output.indexOf('Installed 1 tool'))
    expect(result.output).not.toContain('Done')
    expect(result.output).toContain('┃  Node')
    expect(
      Object.keys(cli.home.readJson('volumes/tools/installed.json') as object),
    ).toEqual(['acme/git'])
  })

  test('forgets them when nothing is picked any more', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['hello'])
    cli.home.seedPickedTools([])
    cli.home.writeJson('volumes/tools/installed.json', {
      'acme/hello': {
        revision: 'old',
        installedAt: '2026-11-01T10:00:00.000Z',
      },
    })

    const result = await cli.run(['install'])

    expect(result.output).toContain('┃  Hello')
    expect(cli.home.readJson('volumes/tools/installed.json')).toEqual({})
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('says where to pick tools when nothing is picked', async () => {
    await using cli = await createInstallCli()

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      `Nothing to install. Pick tools in the dashboard, then run \`local-env install\`: https://local-env.${TEST_DOMAIN}/tools`,
    )
    // The browser stays closed: a call to open would fail here
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test.skipIf(COMPILED)(
    'asks for a profile when nothing is picked, then saves and installs it',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithProfiles(cli)

      const result = await cli.run(['install'], {
        answers: [{ ask: 'Pick your profile', answer: 'acme/backend' }],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('Saved Backend as your profile')
      expect(rolesRun(cli)).toEqual(['acme/backend'])
      expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
        profile: 'acme/backend',
      })
    },
  )

  test.skipIf(COMPILED)(
    'installs nothing when no profile is picked in the select',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithProfiles(cli)

      const result = await cli.run(['install'], {
        answers: [{ ask: 'Pick your profile', answer: '' }],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('Nothing to install.')
      expect(cli.bin.calls('ansible-playbook')).toEqual([])
    },
  )

  test('unpicks the tools that left their source, and installs the rest', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'])
    cli.home.seedPickedTools(['acme/git', 'acme/node'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'acme/node is no longer in your sources: unpicked.',
    )
    expect(cli.home.readJson('volumes/tools/picked.json')).toEqual({
      picked: ['acme/git'],
    })
    expect(cli.bin.calls('ansible-playbook')).toHaveLength(1)
    expect(result.output).toContain('Installed 1 tool')
  })

  test('only unpicks when every picked tool left', async () => {
    await using cli = await createInstallCli()
    cli.home.seedPickedTools(['acme/node'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Nothing to install.')
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('installs a profile and saves it as yours', async () => {
    await using cli = await createInstallCli()
    await sourceWithProfiles(cli)

    const result = await cli.run(['install', 'backend'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Installed the Backend profile')
    expect(result.output).toContain('Saved Backend as your profile')
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

  test('installs a profile of a collection, which Ansible finds by name', async () => {
    await using cli = await createInstallCli()
    const acme = cli.createSource('acme')
    acme.commit({
      'ansible/tools/galaxy.yml': 'namespace: acme\nname: tools\n',
      'ansible/tools/roles/git/tasks/main.yml': '- ping:\n',
      'ansible/tools/roles/node/meta/main.yml': 'dependencies: [git]\n',
      'ansible/profiles/galaxy.yml': 'namespace: acme\nname: profiles\n',
      'ansible/profiles/roles/backend/meta/main.yml':
        'galaxy_info:\n  galaxy_tags: [profile]\ndependencies: [acme.tools.node]\n',
      'ansible/profiles/roles/backend/local-env.yml': 'label: Backend\n',
    })
    await cli.run(['sources', 'add', acme.dir])

    // By its short name or its full name
    for (const name of ['backend', 'acme.profiles.backend']) {
      const result = await cli.run(['install', name])
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('Profile: Backend')
    }
    // Not by its label, which is for reading
    const byLabel = await cli.run(['install', 'Backend'])
    expect(byLabel.exitCode).toBe(1)
    expect(byLabel.output).toContain(
      'No profile named Backend. Profiles: backend.',
    )

    const run = cli.bin.calls('ansible-playbook').at(-1)
    expect(rolesRun(cli)).toEqual(['acme.profiles.backend'])
    // Each collection of the sources, where Ansible looks for it first
    expect(run?.collections).toEqual({
      'acme.profiles': cli.home.path('volumes/sources/acme/ansible/profiles'),
      'acme.tools': cli.home.path('volumes/sources/acme/ansible/tools'),
    })
    expect(run?.env.ANSIBLE_COLLECTIONS_PATH).toMatch(
      /local-env-install-[^/]+\/collections:/,
    )
    expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
      profile: 'acme/acme.profiles.backend',
    })
    // Found by their full name, and by a short name in their collection
    expect(
      Object.keys(cli.home.readJson('volumes/tools/installed.json') as object),
    ).toEqual([
      'acme/acme.profiles.backend',
      'acme/acme.tools.git',
      'acme/acme.tools.node',
    ])
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
    expect(result.output).toContain('Installed the Frontend profile and 1 tool')
    expect(result.output).toContain('Profile: Frontend\n')
    expect(result.output).toContain(
      'Change it on the Profiles page, or with `local-env install <profile>`.',
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
    expect(result.output).toContain('Installed the Frontend profile and 1 tool')
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
    expect(result.output).toContain('Profile: Base')
    expect(result.output).toContain(
      'This run only: your profile stays Frontend.',
    )
    expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
      profile: 'acme/frontend',
    })
    // The saved profile is still wanted
    expect(result.output).not.toContain('No longer wanted')
    expect(
      Object.keys(cli.home.readJson('volumes/tools/installed.json') as object),
    ).toEqual(['acme/frontend', 'acme/node', 'acme/base', 'acme/git'])
  })

  test.skipIf(COMPILED)('asks before it switches your profile', async () => {
    await using cli = await createInstallCli()
    await sourceWithProfiles(cli)
    cli.home.writeJson('volumes/tools/profile.json', {
      profile: 'acme/backend',
    })

    const result = await cli.run(['install', 'frontend'], {
      answers: [
        { ask: 'Switch your profile from Backend to Frontend?', answer: true },
      ],
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Saved Frontend as your profile')
    expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
      profile: 'acme/frontend',
    })
    expect(rolesRun(cli)).toEqual(['acme/frontend'])
  })

  test.skipIf(COMPILED)(
    'changes and installs nothing when you keep your profile',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithProfiles(cli)
      cli.home.writeJson('volumes/tools/profile.json', {
        profile: 'acme/backend',
      })

      const result = await cli.run(['install', 'frontend'], {
        answers: [
          {
            ask: 'Switch your profile from Backend to Frontend?',
            answer: false,
          },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(
        'Your profile stays Backend. To install Frontend once, add --no-save.',
      )
      expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
        profile: 'acme/backend',
      })
      expect(cli.bin.calls('ansible-playbook')).toEqual([])
    },
  )

  test('does not switch your profile without a terminal, unless --yes', async () => {
    await using cli = await createInstallCli()
    await sourceWithProfiles(cli)
    cli.home.writeJson('volumes/tools/profile.json', {
      profile: 'acme/backend',
    })

    const result = await cli.run(['install', 'frontend'], {
      env: { FAKE_PROMPTS_NO_TTY: '1' },
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Switching your profile from Backend to Frontend needs a confirmation: run this in a terminal, or add --yes.',
    )
    expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
      profile: 'acme/backend',
    })
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
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

    const result = await cli.run(['install', 'frontend', '--yes'])

    expect(result.exitCode).toBe(0)
    // Its tools, not the profiles: switching is no news
    expect(result.output).toContain('┃  Git\n')
    expect(result.output).not.toMatch(
      /┃ {2}.*Backend.*\n┃ {2}local-env doesn't uninstall/,
    )
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

  test('asks for the full name of a profile two collections have', async () => {
    await using cli = await createInstallCli()
    const acme = cli.createSource('acme')
    const profile = 'galaxy_info:\n  galaxy_tags: [profile]\n'
    acme.commit({
      'ansible/profiles/galaxy.yml': 'namespace: acme\nname: profiles\n',
      'ansible/profiles/roles/backend/meta/main.yml': profile,
      'ansible/team/galaxy.yml': 'namespace: team\nname: profiles\n',
      'ansible/team/roles/backend/meta/main.yml': profile,
    })
    await cli.run(['sources', 'add', acme.dir])

    const ambiguous = await cli.run(['install', 'backend'])
    expect(ambiguous.exitCode).toBe(1)
    expect(ambiguous.output).toContain(
      'Several profiles are named backend: name one of acme.profiles.backend, team.profiles.backend.',
    )

    const named = await cli.run(['install', 'team.profiles.backend'])
    expect(named.exitCode).toBe(0)
    expect(rolesRun(cli)).toEqual(['team.profiles.backend'])
  })

  test('asks for the source of a plain profile two sources have', async () => {
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

  test.skipIf(COMPILED)(
    'drops a saved profile that left the sources, and asks for another',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithProfiles(cli)
      cli.home.writeJson('volumes/tools/profile.json', {
        profile: 'acme/mobile',
      })

      const result = await cli.run(['install'], {
        answers: [{ ask: 'Pick your profile', answer: 'acme/frontend' }],
      })

      expect(result.output).toContain(
        'Your profile, acme/mobile, is no longer in your sources',
      )
      expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
        profile: 'acme/frontend',
      })
      expect(rolesRun(cli)).toEqual(['acme/frontend'])
    },
  )

  test('names the profiles when nothing is picked, without a terminal', async () => {
    await using cli = await createInstallCli()
    const acme = await sourceWithProfiles(cli)
    acme.commit({
      'ansible/frontend/local-env.yml': 'label: Frontend with AWS tools\n',
    })
    await cli.run(['sources', 'sync', '--yes'])

    const result = await cli.run(['install'], {
      env: { FAKE_PROMPTS_NO_TTY: '1' },
    })

    expect(result.exitCode).toBe(0)
    // The name to type, and the label when it says more
    expect(result.output).toContain(
      'Install a profile with `local-env install <profile>` (backend, base, frontend (Frontend with AWS tools))',
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
    expect(result.output).toContain('Installed the Backend profile')
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
