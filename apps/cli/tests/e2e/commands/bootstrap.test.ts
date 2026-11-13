import { basename } from 'path'
import { provisionedDockhand } from '#cli-tests/support/factories/dockhand.js'
import { machineReady } from '#cli-tests/support/machine.js'
import { COMPILED, createCli, type Cli } from '#cli-tests/support/run-cli.js'

const NO_TTY = { FAKE_PROMPTS_NO_TTY: '1' }

// A Mac where sources add, install and login go through
const createBootstrapCli = async () => {
  const cli = await createCli({ dockhand: provisionedDockhand() })
  cli.home.seedConfig()
  machineReady(cli)
  cli.bin.on('which', ['ansible-playbook'])
  cli.bin.on('ansible-playbook', [])
  return cli
}

// A source whose bootstrap is granted, which includes aws_cli, and a backend
// profile made of git
const bootstrapSource = (cli: Cli, files: Record<string, string> = {}) => {
  const acme = cli.createSource('acme', {
    roles: ['granted', 'aws_cli', 'git', 'backend'],
  })
  acme.commit({
    'local-env.yml': 'name: acme\nbootstrap: [granted]\n',
    'ansible/granted/meta/main.yml': 'dependencies: [aws_cli]\n',
    'ansible/backend/meta/main.yml':
      'galaxy_info:\n  galaxy_tags: [profile]\ndependencies: [git]\n',
    ...files,
  })
  return acme
}

// The roles each ansible-playbook call ran, by folder
const playbooksRun = (cli: Cli) =>
  cli.bin.calls('ansible-playbook').map((call) => {
    const playbook = call.args.at(-1) ?? ''
    const plays = Bun.YAML.parse(call.inputs[playbook] ?? '[]') as {
      roles: { role: string }[]
    }[]
    return plays.flatMap(({ roles }) => roles.map(({ role }) => basename(role)))
  })

const addWithoutTerminal = async (cli: Cli, dir: string) => {
  const added = await cli.run(['sources', 'add', dir], { env: NO_TTY })
  expect(added.exitCode).toBe(0)
  return added
}

describe.concurrent('local-env sources add, bootstrap', () => {
  test.skipIf(COMPILED)('asks to run the bootstrap, then runs it', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli)

    const result = await cli.run(['sources', 'add', acme.dir], {
      answers: [
        { ask: 'acme has a bootstrap (Granted). Run it now?', answer: true },
      ],
    })

    expect(result.exitCode).toBe(0)
    expect(playbooksRun(cli)).toEqual([['granted']])
    expect(result.output).toContain('Bootstrapped acme')
    expect(cli.home.readJson('volumes/tools/bootstrap.json')).toEqual({
      acme: { revision: expect.any(String), ranAt: expect.any(String) },
    })
    // Its roles count as installed, their dependencies too
    expect(
      Object.keys(cli.home.readJson('volumes/tools/installed.json')!).sort(),
    ).toEqual(['acme/aws_cli', 'acme/granted'])
  })

  test.skipIf(COMPILED)('runs nothing when declined', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli)

    const result = await cli.run(['sources', 'add', acme.dir], {
      answers: [{ ask: 'Run it now?', answer: false }],
    })

    expect(result.exitCode).toBe(0)
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
    expect(result.output).toContain(
      '`local-env install` and `local-env login` run it first',
    )
  })

  test('without a terminal, says what to run', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli)

    const result = await addWithoutTerminal(cli, acme.dir)

    expect(cli.bin.calls('ansible-playbook')).toEqual([])
    expect(result.output).toContain('local-env sources bootstrap acme')
  })

  test('refuses a bootstrap role that gets a secret', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli, {
      'ansible/granted/local-env.yml': 'secrets: [npm_token]\n',
    })

    const result = await cli.run(['sources', 'add', acme.dir], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Granted gets secrets (npm_token): a bootstrap runs before the logins',
    )
    expect(cli.home.exists('volumes/sources/acme')).toBe(false)
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('refuses a dependency of a bootstrap role that names a login', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli, {
      'ansible/aws_cli/local-env.yml': 'logins: [acme-dev]\n',
    })

    const result = await cli.run(['sources', 'add', acme.dir], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Aws Cli (included by Granted) names logins (acme-dev)',
    )
    expect(cli.home.exists('volumes/sources/acme')).toBe(false)
  })

  test('refuses a bootstrap role that no source has', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli, {
      'local-env.yml': 'name: acme\nbootstrap: [vpn]\n',
    })

    const result = await cli.run(['sources', 'add', acme.dir], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'bootstrap names vpn, a role that no source has',
    )
  })
})

describe.concurrent('local-env sources bootstrap', () => {
  test('runs the bootstrap, again when it is done', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli)
    await addWithoutTerminal(cli, acme.dir)

    const first = await cli.run(['sources', 'bootstrap'])
    const again = await cli.run(['sources', 'bootstrap', 'acme'])

    expect(first.exitCode).toBe(0)
    expect(again.exitCode).toBe(0)
    expect(playbooksRun(cli)).toEqual([['granted'], ['granted']])
  })

  test('says when no source has one', async () => {
    await using cli = await createBootstrapCli()
    const acme = cli.createSource('acme', { roles: ['git'] })
    await addWithoutTerminal(cli, acme.dir)

    const result = await cli.run(['sources', 'bootstrap'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('No source has a bootstrap')
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('refuses a source that is not added', async () => {
    await using cli = await createBootstrapCli()

    const result = await cli.run(['sources', 'bootstrap', 'nope'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('No source named "nope"')
  })
})

describe.concurrent('local-env install, bootstrap', () => {
  test('runs the bootstrap first, once', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli)
    await addWithoutTerminal(cli, acme.dir)

    const first = await cli.run(['install', 'backend'])
    const again = await cli.run(['install'])

    expect(first.exitCode).toBe(0)
    expect(again.exitCode).toBe(0)
    expect(playbooksRun(cli)).toEqual([['granted'], ['backend'], ['backend']])
    // Not forgotten as no longer wanted
    expect(again.output).not.toContain('No longer wanted')
  })

  test('runs it again when its roles changed', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli)
    await addWithoutTerminal(cli, acme.dir)
    await cli.run(['install', 'backend'])

    // A dependency of the bootstrap changed in the source
    cli.home.write(
      'volumes/sources/acme/ansible/aws_cli/tasks/main.yml',
      '- debug: msg=changed\n',
    )
    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(playbooksRun(cli)).toEqual([
      ['granted'],
      ['backend'],
      ['granted'],
      ['backend'],
    ])
  })

  test.skipIf(COMPILED)(
    'asks for its inputs, then runs it again when a value changes',
    async () => {
      await using cli = await createBootstrapCli()
      const acme = bootstrapSource(cli, {
        'ansible/granted/meta/argument_specs.yml': [
          'argument_specs:',
          '  main:',
          '    options:',
          '      aws_role_name:',
          '        type: str',
          '        required: true',
          '',
        ].join('\n'),
      })
      await addWithoutTerminal(cli, acme.dir)

      const first = await cli.run(['install', 'backend'], {
        answers: [{ ask: 'aws_role_name, for Granted', answer: 'DevReadOnly' }],
      })
      // The value it saved is part of the hash: not run again
      const same = await cli.run(['install'])
      cli.home.writeJson('volumes/tools/variables.json', {
        aws_role_name: 'DevAdmin',
      })
      const changed = await cli.run(['install'])

      expect(first.exitCode).toBe(0)
      expect(same.exitCode).toBe(0)
      expect(changed.exitCode).toBe(0)
      expect(playbooksRun(cli)).toEqual([
        ['granted'],
        ['backend'],
        ['backend'],
        ['granted'],
        ['backend'],
      ])
    },
  )

  test('--dry-run says it would run the bootstrap, and runs nothing', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli)
    await addWithoutTerminal(cli, acme.dir)

    const result = await cli.run(['install', 'backend', '--dry-run'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'Would run the bootstrap of acme first (Granted)',
    )
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })
})

describe.concurrent('local-env login, bootstrap', () => {
  test('runs the bootstrap first, when it never ran', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli)
    await addWithoutTerminal(cli, acme.dir)

    const first = await cli.run(['login'])
    const again = await cli.run(['login'])

    expect(first.exitCode).toBe(0)
    expect(first.output).toContain('Bootstrapped acme')
    expect(again.output).not.toContain('Bootstrap')
    expect(playbooksRun(cli)).toEqual([['granted']])
  })

  test('stops when the bootstrap fails', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli)
    await addWithoutTerminal(cli, acme.dir)
    cli.bin.on('ansible-playbook', [], { exitCode: 2 })

    const result = await cli.run(['login'])

    expect(result.exitCode).toBe(1)
    expect(cli.home.exists('volumes/tools/bootstrap.json')).toBe(false)
  })
})

describe('local-env sources sync, bootstrap', () => {
  test('runs a changed bootstrap with --yes, not one that never ran', async () => {
    await using cli = await createBootstrapCli()
    const acme = bootstrapSource(cli)
    await addWithoutTerminal(cli, acme.dir)

    // Declined at add: sync doesn't ask for it
    await cli.run(['sources', 'sync', '--yes'])
    expect(cli.bin.calls('ansible-playbook')).toEqual([])

    await cli.run(['sources', 'bootstrap'])
    acme.commit({ 'ansible/granted/tasks/main.yml': '- debug: msg=v2\n' })
    const result = await cli.run(['sources', 'sync', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(playbooksRun(cli)).toEqual([['granted'], ['granted']])
  })
})
