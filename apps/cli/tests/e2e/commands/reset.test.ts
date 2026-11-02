import {
  dockerRunning,
  dockerStopped,
  machineReady,
} from '../../support/machine.js'
import { COMPILED, createCli, type Cli } from '../../support/run-cli.js'

// A stack Dockhand deployed, and a container of another project that
// proxy-connector attached to the local-env network
const withDeployments = (cli: Cli) => {
  machineReady(cli)
  cli.bin.on('docker', ['ps', '--all', '--format'], {
    stdout: [
      'local-env\t/Users/me/.local-env',
      'mail\t/app/data/stacks/mail',
      'shop\t/Users/me/shop',
    ].join('\n'),
  })
  cli.bin.on('docker', ['ps', '--all', '--filter', 'network=local-env'], {
    stdout: ['local-env-dashboard-1\tlocal-env', 'shop-web-1\tshop'].join('\n'),
  })
  cli.bin.on('docker', ['image', 'inspect', 'fnsys/dockhand'])
  cli.bin.on('docker', ['image', 'rm'])
  cli.bin.on('docker', ['network'])
}

const commands = (cli: Cli) =>
  cli.bin.calls('docker').map((call) => call.args.join(' '))

describe.concurrent('local-env reset', () => {
  test('--dry-run shows the plan and removes nothing', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    withDeployments(cli)

    const result = await cli.run(['reset', '--dry-run'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'Stack mail, with its volumes (data is lost) and built images',
    )
    expect(result.output).toContain(
      'shop-web-1: disconnected from local-env, not removed',
    )
    expect(result.output).toContain('Images: fnsys/dockhand')
    expect(cli.home.exists('config.json')).toBe(true)
    expect(commands(cli).some((command) => command.includes('down'))).toBe(
      false,
    )
  })

  test('--yes removes the stacks, the core stack and the home folder', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    withDeployments(cli)

    const result = await cli.run(['reset', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('local-env was reset')
    expect(commands(cli)).toEqual(
      expect.arrayContaining([
        'compose -p mail down --volumes --remove-orphans --rmi local',
        'network disconnect -f local-env shop-web-1',
        'compose -p local-env down --volumes --remove-orphans',
        'image rm fnsys/dockhand',
      ]),
    )
    // The shop project isn't Dockhand's: only disconnected
    expect(commands(cli)).not.toContain(
      'compose -p shop down --volumes --remove-orphans --rmi local',
    )
    expect(cli.home.exists('')).toBe(false)
    // --yes keeps the mkcert CA
    expect(cli.bin.calls('mkcert')).toEqual([])
  })

  test('skips Docker when it is not running', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    machineReady(cli)
    dockerStopped(cli.bin)

    const result = await cli.run(['reset', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'Docker is not running: containers and images are skipped',
    )
    expect(cli.home.exists('')).toBe(false)
  })

  test.skipIf(COMPILED)('keeps everything when not confirmed', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    withDeployments(cli)

    const result = await cli.run(['reset'], {
      answers: [{ ask: 'Remove all of this?', answer: false }],
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Nothing was removed')
    expect(cli.home.exists('config.json')).toBe(true)
  })

  test.skipIf(COMPILED)('removes the mkcert CA on request', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    dockerRunning(cli.bin)
    machineReady(cli)

    const result = await cli.run(['reset'], {
      answers: [
        { ask: 'Remove all of this?', answer: true },
        { ask: "Also remove mkcert's CA", answer: true },
      ],
    })

    expect(result.exitCode).toBe(0)
    expect(cli.bin.calls('mkcert').map((call) => call.args)).toEqual([
      ['-uninstall'],
    ])
  })

  test.skipIf(COMPILED)(
    'Ctrl-C on the confirmation removes nothing',
    async () => {
      await using cli = await createCli()
      cli.home.seedConfig()
      withDeployments(cli)

      const result = await cli.run(['reset'], {
        answers: [{ ask: 'Remove all of this?', cancel: true }],
      })

      expect(result.exitCode).toBe(130)
      expect(cli.home.exists('config.json')).toBe(true)
    },
  )
})
