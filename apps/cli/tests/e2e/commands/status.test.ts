import {
  buildComposeService,
  buildRoute,
  jsonLines,
} from '../../support/factories/docker.js'
import { dockerRunning, dockerStopped } from '../../support/machine.js'
import { createCli, type Cli } from '../../support/run-cli.js'

const CORE_SERVICES = [
  buildComposeService({ service: 'dockhand', ports: [3000] }),
  buildComposeService({ service: 'nginx-proxy', ports: [80, 443] }),
  buildComposeService({ service: 'proxy-connector' }),
  buildComposeService({
    service: 'dashboard',
    name: 'local-env-dashboard-1',
    health: 'healthy',
  }),
]

const coreStackRunning = (cli: Cli) => {
  dockerRunning(cli.bin)
  cli.bin.on('docker', ['compose', 'ps', '--all', '--format', 'json'], {
    stdout: jsonLines(CORE_SERVICES),
  })
}

describe('local-env status', () => {
  test('shows the services, domain, sources and routes', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    cli.home.seedCertificate()
    coreStackRunning(cli)
    cli.home.seedRoutes([
      // A core service: listed with the services, not the routes
      buildRoute({
        host: 'local-env',
        container: 'local-env-dashboard-1',
        stack: 'local-env',
      }),
      buildRoute({ host: 'mail' }),
      buildRoute({ host: 'db-admin', status: 'restarting' }),
    ])
    // Containers without a route are only counted
    cli.bin.on('docker', ['ps', '--format'], {
      stdout: ['mail-mail-1\tmail', 'mail-db-1\tmail', 'redis\t'].join('\n'),
    })

    const result = await cli.run(['status'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toMatchSnapshot()
  })

  test('--services only shows the core services', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    coreStackRunning(cli)

    const result = await cli.run(['status', '--services'])

    expect(result.output).toContain('dockhand')
    expect(result.output).not.toContain('Domain')
    expect(result.output).not.toContain('Routes')
  })

  test('says what to run when nothing is set up', async () => {
    await using cli = await createCli()
    dockerStopped(cli.bin)

    const result = await cli.run(['status'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toMatchSnapshot()
  })

  test('warns when the certificate expired', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    cli.home.seedCertificate('expired')
    dockerRunning(cli.bin)

    const result = await cli.run(['status'])

    expect(result.output).toContain('Not started. Run `local-env start`.')
    expect(result.output).toContain(
      '▲ local-env-e2e.test: *.local-env-e2e.test expired on 2021-01-01',
    )
  })
})
