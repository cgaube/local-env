import { TEST_DOMAIN } from '../../support/factories/config.js'
import { provisionedDockhand } from '../../support/factories/dockhand.js'
import { machineReady } from '../../support/machine.js'
import { COMPILED, createCli } from '../../support/run-cli.js'

const composeUp = (args: string[]) =>
  args.includes('up') && args.includes('--remove-orphans')

describe.concurrent('local-env start', () => {
  test('starts the core stack and provisions Dockhand', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(`*.${TEST_DOMAIN} valid until 2126`)
    expect(result.output).toContain(
      `local-env is running: https://local-env.${TEST_DOMAIN}`,
    )
    const up = cli.bin.calls('docker').find((call) => composeUp(call.args))
    expect(up?.args).not.toContain('--build')
    // Bind mounts, created before compose
    expect(cli.home.exists('volumes/dockhand')).toBe(true)
    // A fresh Dockhand is provisioned
    expect(cli.dockhand.state.environments).toHaveLength(1)
    expect(cli.dockhand.state.exposure.dismissed).toBe(true)
    expect(cli.dockhand.state.updateChecks[1]).toMatchObject({
      enabled: true,
      autoUpdate: true,
    })
  })

  test('changes nothing in a provisioned Dockhand', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Configuration up to date')
    const writes = cli.dockhand.requests.filter(
      (request) => request.method !== 'GET',
    )
    expect(writes).toEqual([])
  })

  test('renews an expired certificate and reloads the proxy', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate('expired')
    machineReady(cli)

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(`*.${TEST_DOMAIN} expired on 2021-01-01`)
    expect(result.output).toContain(
      `Created a certificate for *.${TEST_DOMAIN}`,
    )
    expect(
      cli.bin
        .calls('docker')
        .some((call) => call.args.join(' ').includes('kill --signal HUP')),
    ).toBe(true)
  })

  test('--build rebuilds the local images', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)

    await cli.run(['start', '--build'])

    const up = cli.bin.calls('docker').find((call) => composeUp(call.args))
    expect(up?.args).toContain('--build')
  })

  test('fails when compose cannot start the services', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)
    cli.bin.on('docker', ['compose', 'up', '--remove-orphans'], {
      stderr: 'port 443 is already allocated\n',
      exitCode: 1,
    })

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('port 443 is already allocated')
    expect(result.output).toContain('Error starting services')
  })

  test.skipIf(COMPILED)('stops when setup is declined', async () => {
    await using cli = await createCli()
    machineReady(cli)

    const result = await cli.run(['start'], {
      answers: [{ ask: 'Run setup now?', answer: false }],
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Run `local-env setup` first.')
    expect(cli.bin.calls('docker').some((call) => composeUp(call.args))).toBe(
      false,
    )
  })

  test.skipIf(COMPILED)('runs setup first when accepted', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    machineReady(cli)

    const result = await cli.run(['start'], {
      answers: [
        { ask: 'Run setup now?', answer: true },
        { ask: 'Domain for local services', answer: TEST_DOMAIN },
        { ask: 'Port for template builds', answer: '47080' },
      ],
    })

    expect(result.exitCode).toBe(0)
    expect(cli.home.readJson('config.json')).toEqual({
      domain: TEST_DOMAIN,
      buildPort: 47080,
    })
    expect(result.output).toContain('local-env is running')
  })
})
