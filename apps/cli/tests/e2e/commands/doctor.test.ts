import { TEST_DOMAIN } from '../../support/factories/config.js'
import { provisionedDockhand } from '../../support/factories/dockhand.js'
import { buildTemplate } from '../../support/factories/template.js'
import { machineReady } from '../../support/machine.js'
import { createCli, type Cli } from '../../support/run-cli.js'

// dnsmasq answers, the proxy runs and macOS resolves the probe host
const dnsWorking = (cli: Cli) => {
  machineReady(cli)
  cli.bin.on('dig', [], { stdout: '127.0.0.1\n' })
  cli.bin.on('dscacheutil', [], { stdout: 'ip_address: 127.0.0.1\n' })
  cli.bin.on('docker', ['compose', 'ps', '--services', 'nginx-proxy'], {
    stdout: 'nginx-proxy\n',
  })
}

describe.concurrent('local-env doctor', () => {
  test('passes the certificate, DNS and proxy checks', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    cli.home.seedCertificate()
    dnsWorking(cli)

    const result = await cli.run(['doctor'])

    expect(result.output).toContain(`Domain ${TEST_DOMAIN}, probe host doctor.`)
    expect(result.output).toContain(`*.${TEST_DOMAIN} valid until 2126`)
    expect(result.output).toContain('dnsmasq config is valid.')
    expect(result.output).toContain(`dnsmasq resolves doctor.${TEST_DOMAIN}`)
    expect(result.output).toContain('nginx-proxy container is running.')
    expect(result.output).toMatch(/\d+ passed, \d+ warning\(s\), \d+ failed/)
  })

  test('fails on a missing certificate', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    dnsWorking(cli)

    const result = await cli.run(['doctor'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      `✗ No certificate for *.${TEST_DOMAIN}. Run \`local-env start\``,
    )
  })

  test('fails when dnsmasq does not answer', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    cli.home.seedCertificate()
    dnsWorking(cli)
    cli.bin.on('dig', [], { stdout: '' })

    const result = await cli.run(['doctor'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      `✗ dnsmasq did not return 127.0.0.1 for doctor.${TEST_DOMAIN}`,
    )
  })

  test('checks that every source is shown in Dockhand', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    dnsWorking(cli)
    const acme = cli.createSource('acme')
    const team = cli.createSource('team')
    await cli.run(['sources', 'add', acme.dir])
    await cli.run(['sources', 'add', team.dir])
    // Removed from Dockhand by hand
    cli.dockhand.state.templateSources =
      cli.dockhand.state.templateSources.filter(({ name }) => name !== 'team')

    const result = await cli.run(['doctor'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('acme: no new commits')
    expect(result.output).toContain('acme: shown in Dockhand')
    expect(result.output).toContain(
      '✗ team: not shown in Dockhand. Run `local-env start`.',
    )
  })

  test('warns about a source with new commits', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    dnsWorking(cli)
    const acme = cli.createSource('acme')
    await cli.run(['sources', 'add', acme.dir])
    acme.commit({ 'docker/hello/README.md': 'hello\n' })

    const result = await cli.run(['doctor'])

    expect(result.output).toContain(
      '▲ acme: new commits available. Run `local-env update`.',
    )
  })

  test('warns about a Mac folder a template mounts but does not exist', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    dnsWorking(cli)
    const acme = cli.createSource('acme', {
      templates: [
        buildTemplate({
          folder: 'php',
          compose: [
            'name: php',
            'services:',
            '  php:',
            '    image: php:8',
            '    volumes:',
            '      - ${HOST_HOME}/dev/php:/var/www',
            '',
          ].join('\n'),
        }),
      ],
    })
    await cli.run(['sources', 'add', acme.dir])

    const result = await cli.run(['doctor'])

    expect(result.output).toContain(
      "▲ acme/php mounts ~/dev/php, which doesn't exist",
    )
  })

  test('rejects an invalid --domain', async () => {
    await using cli = await createCli()

    const result = await cli.run(['doctor', '--domain', 'not a domain'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Invalid domain "not a domain"')
  })
})
