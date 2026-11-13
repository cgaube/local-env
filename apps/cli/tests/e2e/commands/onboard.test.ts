import { TEST_DOMAIN } from '#cli-tests/support/factories/config.js'
import { machineReady } from '#cli-tests/support/machine.js'
import { COMPILED, createCli, type Cli } from '#cli-tests/support/run-cli.js'

const composeUp = (args: string[]) =>
  args.includes('up') && args.includes('--remove-orphans')

// A Mac where setup, start and install go through
const createOnboardCli = async () => {
  const cli = await createCli()
  machineReady(cli)
  cli.bin.on('which', ['ansible-playbook'])
  cli.bin.on('ansible-playbook', [])
  return cli
}

// The team's source: a backend profile, made of git
const teamSource = (cli: Cli) => {
  const acme = cli.createSource('acme', { roles: ['git', 'backend'] })
  acme.commit({
    'ansible/backend/meta/main.yml':
      'galaxy_info:\n  galaxy_tags: [profile]\ndependencies: [git]\n',
  })
  return acme
}

describe.concurrent('local-env onboard', () => {
  test('sets up, adds the source, starts and installs the profile', async () => {
    await using cli = await createOnboardCli()
    const acme = teamSource(cli)

    const result = await cli.run([
      'onboard',
      acme.dir,
      '--domain',
      TEST_DOMAIN,
      '--profile',
      'backend',
    ])

    expect(result.exitCode).toBe(0)
    expect(cli.home.readJson('config.json')).toMatchObject({
      domain: TEST_DOMAIN,
    })
    expect(cli.home.exists('volumes/sources/acme/.git')).toBe(true)
    expect(cli.bin.calls('docker').some((call) => composeUp(call.args))).toBe(
      true,
    )
    // Dockhand provisioned by the start
    expect(cli.dockhand.state.environments).toHaveLength(1)
    expect(cli.home.readJson('volumes/tools/profile.json')).toEqual({
      profile: 'acme/backend',
    })
    expect(cli.bin.calls('ansible-playbook')).toHaveLength(1)
    // One summary at the end, not start's
    expect(result.output).toContain('local-env is ready')
    expect(result.output).toContain('Installed the Backend profile')
    expect(result.output).toContain(
      `Dashboard: https://local-env.${TEST_DOMAIN}`,
    )
    expect(result.output).not.toContain('local-env is running')
  })

  test('runs the bootstrap after the start, before the logins and the install', async () => {
    await using cli = await createOnboardCli()
    const acme = teamSource(cli)
    acme.commit({
      'local-env.yml': 'name: acme\nbootstrap: [granted]\n',
      'ansible/granted/tasks/main.yml': '- debug: msg=granted\n',
    })

    const result = await cli.run([
      'onboard',
      acme.dir,
      '--domain',
      TEST_DOMAIN,
      '--profile',
      'backend',
    ])

    expect(result.exitCode).toBe(0)
    // Two playbooks: the bootstrap, then the profile
    const playbooks = cli.bin
      .calls('ansible-playbook')
      .map((call) => call.inputs[call.args.at(-1) ?? ''] ?? '')
    expect(playbooks).toHaveLength(2)
    expect(playbooks[0]).toContain('/ansible/granted')
    expect(playbooks[0]).not.toContain('/ansible/backend')
    expect(playbooks[1]).toContain('/ansible/backend')
    // Asked nothing: the install runs it anyway
    const output = result.output
    expect(output).toContain('Services started')
    expect(output).toContain('Bootstrapped acme')
    expect(output.indexOf('Services started')).toBeLessThan(
      output.indexOf('Bootstrapped acme'),
    )
    expect(output.indexOf('Bootstrapped acme')).toBeLessThan(
      output.indexOf('Installed the Backend profile'),
    )
  })

  test.skipIf(COMPILED)('asks for the profile when none is given', async () => {
    await using cli = await createOnboardCli()
    const acme = teamSource(cli)

    const result = await cli.run(
      ['onboard', acme.dir, '--domain', TEST_DOMAIN],
      { answers: [{ ask: 'Pick your profile', answer: 'acme/backend' }] },
    )

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Installed the Backend profile')
  })

  test('runs again: keeps the domain and the source, installs the saved profile', async () => {
    await using cli = await createOnboardCli()
    const acme = teamSource(cli)
    await cli.run([
      'onboard',
      acme.dir,
      '--domain',
      TEST_DOMAIN,
      '--profile',
      'backend',
    ])

    const again = await cli.run(['onboard', acme.dir, '--domain', 'other.test'])

    expect(again.exitCode).toBe(0)
    expect(again.output).toContain(`Keeps your domain, ${TEST_DOMAIN}`)
    expect(cli.home.readJson('config.json')).toMatchObject({
      domain: TEST_DOMAIN,
    })
    expect(again.output).toContain('A source named "acme" is already added')
    expect(again.output).toContain('Installed the Backend profile')
    expect(cli.bin.calls('ansible-playbook')).toHaveLength(2)
  })

  test('stops before the install when the source cannot be cloned', async () => {
    await using cli = await createOnboardCli()

    const result = await cli.run([
      'onboard',
      '/nowhere/acme',
      '--domain',
      TEST_DOMAIN,
    ])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Onboarding failed')
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('is hidden from --help', async () => {
    await using cli = await createCli()

    const result = await cli.run(['--help'])

    expect(result.output).not.toContain('onboard')
  })
})
