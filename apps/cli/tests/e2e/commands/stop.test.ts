import { createCli } from '../../support/run-cli.js'

describe.concurrent('local-env stop', () => {
  test('stops the core stack with the home compose file', async () => {
    await using cli = await createCli()
    cli.home.seedConfig({ domain: 'acme.test' })
    cli.bin.on('docker', ['compose', 'down'])

    const result = await cli.run(['stop'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Services stopped')
    const down = cli.bin
      .calls('docker')
      .find((call) => call.args.includes('down'))
    expect(down?.args).toEqual([
      'compose',
      '-f',
      cli.home.path('compose.yaml'),
      'down',
    ])
    // compose.yaml reads the domain from the environment
    expect(down?.env.LOCAL_ENV_DOMAIN).toBe('acme.test')
  })

  test('is also available as `down`', async () => {
    await using cli = await createCli()
    cli.bin.on('docker', ['compose', 'down'])

    const result = await cli.run(['down'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Services stopped')
  })

  test('fails with the end of the compose output', async () => {
    await using cli = await createCli()
    cli.bin.on('docker', ['compose', 'down'], {
      stderr: 'Cannot connect to the Docker daemon\n',
      exitCode: 1,
    })

    const result = await cli.run(['stop'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Cannot connect to the Docker daemon')
    expect(result.output).toContain('Error stopping services')
  })
})
