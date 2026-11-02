import { buildRoute } from '../../support/factories/docker.js'
import { dockerRunning, dockerStopped } from '../../support/machine.js'
import { createCli, type Cli } from '../../support/run-cli.js'

const proxyRunning = (cli: Cli) => {
  dockerRunning(cli.bin)
  cli.bin.on(
    'docker',
    ['compose', 'ps', '--status', 'running', 'nginx-proxy'],
    {
      stdout: 'nginx-proxy\n',
    },
  )
}

describe('local-env proxy routes', () => {
  test('lists the routes of the running containers', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    proxyRunning(cli)
    cli.home.seedRoutes([
      buildRoute({ host: 'mail', port: '8025' }),
      {
        ...buildRoute({ host: 'shop' }),
        hosts: ['shop.local-env-e2e.test', 'www.shop.local-env-e2e.test'],
      },
    ])

    const result = await cli.run(['proxy', 'routes'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toMatchSnapshot()
  })

  test('says how to add a route when there is none', async () => {
    await using cli = await createCli()
    proxyRunning(cli)
    cli.home.seedRoutes([])

    const result = await cli.run(['proxy', 'routes'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('No active routes')
  })

  test('warns when the proxy is stopped', async () => {
    await using cli = await createCli()
    dockerRunning(cli.bin)
    cli.home.seedRoutes([buildRoute()])

    const result = await cli.run(['proxy', 'routes'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('The proxy is not running')
  })

  test('fails when Docker is not running', async () => {
    await using cli = await createCli()
    dockerStopped(cli.bin)

    const result = await cli.run(['proxy', 'routes'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Docker is not running')
  })
})
