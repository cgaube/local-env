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

// Ansible got the password on its stdin, with `--become-password-file -`,
// and no file of its run folder held it
const expectPasswordOnStdin = (cli: Cli, password: string) => {
  const run = cli.bin.calls('ansible-playbook').at(-1)
  const flag = run?.args.indexOf('--become-password-file') ?? -1
  expect(flag).toBeGreaterThan(-1)
  expect(run?.args[flag + 1]).toBe('-')
  expect(run?.stdin).toBe(`${password}\n`)
  expect(run?.env.ANSIBLE_BECOME_PASSWORD_FILE).toBeUndefined()
  expect(Object.keys(run?.runFolder ?? {})).toContainEqual(
    expect.stringMatching(/playbook\.yml$/),
  )
  for (const content of Object.values(run?.runFolder ?? {})) {
    expect(content).not.toContain(password.trim())
  }
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
      expectPasswordOnStdin(cli, 'secret')
    },
  )

  test('passes no password when no role needs sudo', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'])
    cli.home.seedPickedTools(['acme/git'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    const [run] = cli.bin.calls('ansible-playbook')
    expect(run?.args).not.toContain('--become-password-file')
    // Closed: a role never waits for input
    expect(run?.stdin).toBe('')
  })

  test.skipIf(COMPILED)(
    'names the role when sudo wants a password local-env did not ask for',
    async () => {
      await using cli = await createInstallCli()
      // A templated become: the scan doesn't see it
      await sourceWithRoles(cli, ['dns'], {
        'ansible/dns/tasks/main.yml':
          '- name: x\n  become: "{{ true }}"\n  ping:\n',
      })
      cli.home.seedPickedTools(['acme/dns'])
      cli.bin.on('ansible-playbook', [], {
        exitCode: 2,
        stdout: playbookEvents([
          {
            role: 'dns',
            task: 'Create the resolver',
            result: 'failed',
            msg: 'Task failed: Premature end of stream waiting for become success.\n>>> Standard Error\nsudo: a password is required',
          },
        ]),
      })

      const result = await cli.run(['install'])

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('A role needs your sudo password: Dns')
      expect(result.output).toContain('did not ask for it')
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
      expectPasswordOnStdin(cli, 'secret')
    },
  )

  test.skipIf(COMPILED)('keeps the spaces around the password', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['dns'], {
      'ansible/dns/tasks/main.yml': '- name: x\n  become: true\n  ping:\n',
    })
    cli.home.seedPickedTools(['acme/dns'])

    await cli.run(['install'], {
      answers: [{ ask: 'Your password, for sudo (Dns)', answer: ' s3 cret ' }],
    })

    expectPasswordOnStdin(cli, ' s3 cret ')
  })

  test.skipIf(COMPILED)(
    'passes the password on stdin with --verbose too',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithRoles(cli, ['dns'], {
        'ansible/dns/tasks/main.yml': '- name: x\n  become: true\n  ping:\n',
      })
      cli.home.seedPickedTools(['acme/dns'])
      cli.bin.on('ansible-playbook', [], { stdout: 'PLAY [local-env tools]\n' })

      const result = await cli.run(['install', '--verbose'], {
        answers: [{ ask: 'Your password, for sudo (Dns)', answer: 'secret' }],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('PLAY [local-env tools]')
      expectPasswordOnStdin(cli, 'secret')
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
    'removes the run folder when stopped halfway',
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
    writeFileSync(join(old, 'playbook.yml'), '- hosts: localhost\n')
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
    expect(result.output).toContain('No longer wanted, still on this Mac')
    expect(result.output).toContain('node (no longer in your sources)')
    // Once, in the list of the end
    expect(result.output.split('node').length - 1).toBe(1)
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
    // local-env's own, then each collection of the sources, where Ansible
    // looks for them first
    expect(run?.collections).toEqual({
      'local_env.core': cli.home.path('ansible/local_env/core'),
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
      cli.home.writeJson('volumes/tools/installed.json', {
        'acme/mobile': {
          revision: 'old',
          installedAt: '2026-11-01T10:00:00.000Z',
        },
      })

      const result = await cli.run(['install'], {
        answers: [{ ask: 'Pick your profile', answer: 'acme/frontend' }],
      })

      expect(result.output).toContain(
        'Your profile, mobile, is no longer in your sources',
      )
      // Said once, at the start: not a tool in the list of the end
      expect(result.output).not.toContain('mobile (no longer in your sources)')
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

// git needs an email (required), an editor (choices, with a default) and a
// signing switch; node needs the same email
const GIT_SPECS = [
  'argument_specs:',
  '  main:',
  '    options:',
  '      git_email:',
  '        type: str',
  '        required: true',
  '        description: Your email, for commits',
  '      git_editor:',
  '        choices: [vim, nano]',
  '        default: vim',
  '      git_sign:',
  '        type: bool',
  '',
].join('\n')

const sourceWithInputs = (cli: Cli, files: Record<string, string> = {}) =>
  sourceWithRoles(cli, ['git', 'node'], {
    'ansible/git/meta/argument_specs.yml': GIT_SPECS,
    'ansible/node/meta/argument_specs.yml':
      'argument_specs:\n  main:\n    options:\n      git_email: { required: true }\n',
    ...files,
  })

// What the last playbook run got with `--extra-vars @<file>`, or null
const extraVarsSent = (cli: Cli) => {
  const run = cli.bin.calls('ansible-playbook').at(-1)
  const flag = run?.args.indexOf('--extra-vars') ?? -1
  if (flag === -1) return null
  const file = run!.args[flag + 1]!
  expect(file).toMatch(/^@.*local-env-install-[^/]+\/extra-vars\.json$/)
  return JSON.parse(run!.inputs[file.slice(1)] ?? 'null')
}

describe.concurrent('local-env install inputs', () => {
  test.skipIf(COMPILED)(
    'asks for a required value it has no value for, then saves it',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithInputs(cli)
      cli.home.seedPickedTools(['acme/git', 'acme/node'])

      const result = await cli.run(['install'], {
        answers: [{ ask: 'git_email, for Git, Node', answer: 'me@acme.test' }],
      })

      expect(result.exitCode).toBe(0)
      // Once, for both roles; the editor has a default, the switch is not
      // required
      expect(result.questions).toEqual([
        'git_email, for Git, Node · Your email, for commits',
      ])
      expect(cli.home.readJson('volumes/tools/variables.json')).toEqual({
        git_email: 'me@acme.test',
      })
      // Where it went, and where to change it
      expect(result.output).toContain('Saved git_email')
      expect(result.output).toContain(
        `Change it with \`local-env vars set\`, or in Variables on the Tools page: https://local-env.${TEST_DOMAIN}/tools`,
      )
      // Only what was set: the role's defaults/main.yml gives the default
      expect(extraVarsSent(cli)).toEqual({ git_email: 'me@acme.test' })
      // Recorded: a change makes the roles changed
      const installed = cli.home.readJson<
        Record<string, { values?: Record<string, unknown> }>
      >('volumes/tools/installed.json')
      expect(installed['acme/git']?.values).toEqual({
        git_email: 'me@acme.test',
      })
    },
  )

  test('uses a saved value without a question, and passes only declared inputs', async () => {
    await using cli = await createInstallCli()
    await sourceWithInputs(cli)
    cli.home.seedPickedTools(['acme/git'])
    cli.home.writeJson('volumes/tools/variables.json', {
      git_email: 'me@acme.test',
      git_editor: 'nano',
      // Of a role that is not wanted
      ruby_version: '3.4',
    })

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.questions).toEqual([])
    expect(extraVarsSent(cli)).toEqual({
      git_email: 'me@acme.test',
      git_editor: 'nano',
    })
    // Only the user can read it
    const run = cli.bin.calls('ansible-playbook').at(-1)
    const file = run!.args[run!.args.indexOf('--extra-vars') + 1]!.slice(1)
    expect(existsSync(file)).toBe(false)
  })

  test('asks nothing and passes no extra vars when every input has a default', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'], {
      'ansible/git/meta/argument_specs.yml':
        'argument_specs:\n  main:\n    options:\n      git_editor: { required: true, default: vim }\n',
    })
    cli.home.seedPickedTools(['acme/git'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.questions).toEqual([])
    expect(extraVarsSent(cli)).toBeNull()
    expect(existsSync(cli.home.path('volumes/tools/variables.json'))).toBe(
      false,
    )
  })

  test('asks nothing for a required input that defaults/main.yml sets', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git'], {
      'ansible/git/meta/argument_specs.yml':
        'argument_specs:\n  main:\n    options:\n      git_email: { required: true }\n',
      'ansible/git/defaults/main.yml': 'git_email: team@acme.test\n',
    })
    cli.home.seedPickedTools(['acme/git'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.questions).toEqual([])
    expect(extraVarsSent(cli)).toBeNull()
  })

  test('leaves an input to the role that passes it, and does not pass a saved value over it', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git', 'backend'], {
      'ansible/git/meta/argument_specs.yml':
        'argument_specs:\n  main:\n    options:\n      git_email: { required: true }\n',
      'ansible/backend/meta/main.yml': [
        'galaxy_info:',
        '  galaxy_tags: [profile]',
        'dependencies:',
        '  - role: git',
        '    vars:',
        '      git_email: backend@acme.test',
        '',
      ].join('\n'),
    })
    cli.home.writeJson('volumes/tools/variables.json', {
      git_email: 'me@acme.test',
    })

    const result = await cli.run(['install', 'backend'])

    expect(result.exitCode).toBe(0)
    expect(result.questions).toEqual([])
    // Extra vars would win over the profile's value
    expect(extraVarsSent(cli)).toBeNull()
  })

  test("keeps the profile's value when the tool is picked too", async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['git', 'backend'], {
      'ansible/git/meta/argument_specs.yml':
        'argument_specs:\n  main:\n    options:\n      git_editor: {}\n      git_email: {}\n',
      'ansible/backend/meta/main.yml': [
        'galaxy_info:',
        '  galaxy_tags: [profile]',
        'dependencies:',
        '  - role: git',
        '    vars:',
        '      git_editor: code',
        '',
      ].join('\n'),
    })
    cli.home.seedPickedTools(['acme/git'])
    cli.home.writeJson('volumes/tools/variables.json', {
      git_editor: 'vim',
      git_email: 'me@acme.test',
    })

    const result = await cli.run(['install', 'backend'])

    expect(result.exitCode).toBe(0)
    // git runs inside the profile: the profile's editor stays, the email
    // the profile doesn't set goes
    expect(rolesRun(cli)).toEqual(['acme/backend'])
    expect(extraVarsSent(cli)).toEqual({ git_email: 'me@acme.test' })
  })

  test.skipIf(COMPILED)(
    'asks with a select for choices, a number for an int, a list for a list',
    async () => {
      await using cli = await createInstallCli()
      await sourceWithRoles(cli, ['editor'], {
        'ansible/editor/meta/argument_specs.yml': [
          'argument_specs:',
          '  main:',
          '    options:',
          '      editor: { required: true, choices: [vim, code] }',
          '      tab_width: { required: true, type: int }',
          '      plugins: { required: true, type: list }',
          '',
        ].join('\n'),
      })
      cli.home.seedPickedTools(['acme/editor'])

      const result = await cli.run(['install'], {
        answers: [
          { ask: 'editor, for Editor', answer: 'code' },
          { ask: 'tab_width, for Editor', answer: '2' },
          { ask: 'plugins, for Editor', answer: 'copilot, vim' },
        ],
      })

      expect(result.exitCode).toBe(0)
      // A list as a list: Ansible would give the role the text
      expect(extraVarsSent(cli)).toEqual({
        editor: 'code',
        tab_width: 2,
        plugins: ['copilot', 'vim'],
      })
    },
  )

  test.skipIf(COMPILED)('uses the answer once with --no-save', async () => {
    await using cli = await createInstallCli()
    await sourceWithInputs(cli)
    cli.home.seedPickedTools(['acme/git'])

    const result = await cli.run(['install', '--no-save'], {
      answers: [{ ask: 'git_email, for Git', answer: 'me@acme.test' }],
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'Used git_email for this run only: not saved (--no-save).',
    )
    expect(extraVarsSent(cli)).toEqual({ git_email: 'me@acme.test' })
    expect(existsSync(cli.home.path('volumes/tools/variables.json'))).toBe(
      false,
    )
  })

  test('stops before Ansible without a terminal, and names the missing inputs', async () => {
    await using cli = await createInstallCli()
    await sourceWithInputs(cli)
    cli.home.seedPickedTools(['acme/git', 'acme/node'])

    const result = await cli.run(['install'], {
      env: { FAKE_PROMPTS_NO_TTY: '1' },
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Your tools need values: git_email (Git, Node).',
    )
    expect(result.output).toContain('Tools page of the dashboard')
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('stops on a required secret, which it never asks or passes', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['deploy'], {
      'ansible/deploy/meta/argument_specs.yml': [
        'argument_specs:',
        '  main:',
        '    options:',
        '      deploy_token: { required: true, no_log: true }',
        '',
      ].join('\n'),
    })
    cli.home.seedPickedTools(['acme/deploy'])
    // Written by hand: still never passed
    cli.home.writeJson('volumes/tools/variables.json', { deploy_token: 'x' })

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Your tools need a secret that local-env does not support yet: deploy_token (Deploy).',
    )
    expect(result.questions).toEqual([])
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('leaves out an optional secret, and runs', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['deploy'], {
      'ansible/deploy/meta/argument_specs.yml':
        'argument_specs:\n  main:\n    options:\n      deploy_token: { no_log: true }\n',
    })
    cli.home.seedPickedTools(['acme/deploy'])
    cli.home.writeJson('volumes/tools/variables.json', { deploy_token: 'x' })

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(extraVarsSent(cli)).toBeNull()
  })

  test('lists the inputs with --dry-run, and runs, asks and writes nothing', async () => {
    await using cli = await createInstallCli()
    await sourceWithInputs(cli)
    cli.home.seedPickedTools(['acme/git'])
    cli.home.writeJson('volumes/tools/variables.json', { git_sign: true })

    const result = await cli.run(['install', '--dry-run'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Would install 1 tool')
    expect(result.output).toContain(
      'git_email (Git): missing: install asks for it',
    )
    expect(result.output).toContain(
      'git_editor (Git): the role\'s default, "vim"',
    )
    expect(result.output).toContain('git_sign (Git): true, saved')
    expect(result.questions).toEqual([])
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
    expect(existsSync(cli.home.path('volumes/tools/installed.json'))).toBe(
      false,
    )
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

  test('a line for each item of a loop, as Ansible shows them', async () => {
    await using cli = await createInstallCli()
    await sourceWithRoles(cli, ['hello'])
    cli.home.seedPickedTools(['acme/hello'])
    cli.bin.on('ansible-playbook', [], {
      exitCode: 2,
      stdout: playbookEvents([
        {
          role: 'hello',
          task: 'Say hello',
          result: 'ok',
          msg: 'All items completed',
          items: [
            { label: 1, result: 'ok', msg: 'Hello, Ana!' },
            { label: 2, result: 'ok', msg: 'Hello, Ana!' },
          ],
        },
        {
          role: 'hello',
          task: 'Install the packages',
          result: 'failed',
          msg: 'One or more items failed',
          items: [
            { label: 'git', result: 'ok' },
            // A command's empty message is none
            { label: 'jq', result: 'changed', msg: '' },
            { label: { name: 'old' }, result: 'skipped' },
            {
              label: 'nope',
              result: 'failed',
              msg: 'No available formula with the name "nope"',
            },
          ],
        },
      ]),
    })

    const result = await cli.run(['install'])

    expect(result.output).toMatchSnapshot()
  })
})
