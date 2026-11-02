import { existsSync } from 'fs'
import { playbookEvents } from '../../support/factories/ansible.js'
import { TEST_DOMAIN } from '../../support/factories/config.js'
import { provisionedDockhand } from '../../support/factories/dockhand.js'
import { machineReady } from '../../support/machine.js'
import { COMPILED, createCli, type Cli } from '../../support/run-cli.js'

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
    expect(run?.args).toEqual([
      '--inventory',
      'localhost,',
      cli.home.path('volumes/tools/playbook.yml'),
    ])
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
      result.output.indexOf('Unpicked, still on this Mac'),
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
