import { TEST_DOMAIN } from '#cli-tests/support/factories/config.js'
import {
  buildDockhandTemplateSource,
  provisionedDockhand,
} from '#cli-tests/support/factories/dockhand.js'
import { HIDDEN_SIDEBAR_ITEMS } from '#cli/providers/docker/steps/sidebar.js'
import { machineReady } from '#cli-tests/support/machine.js'
import { COMPILED, createCli } from '#cli-tests/support/run-cli.js'

const composeUp = (args: string[]) =>
  args.includes('up') && args.includes('--remove-orphans')

describe.concurrent('local-env start', () => {
  test('creates the proxy network when it is missing, outside compose', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)
    // The network doesn't exist yet: the last rule wins
    cli.bin.on('docker', ['network', 'inspect', 'local-env'], { exitCode: 1 })
    cli.bin.on('docker', ['network', 'create'])

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    const docker = cli.bin.calls('docker').map((call) => call.args)
    const create = docker.findIndex((args) => args[1] === 'create')
    expect(docker[create]).toEqual([
      'network',
      'create',
      '--driver',
      'bridge',
      '--label',
      'local-env=proxy',
      'local-env',
    ])
    // Before compose needs it
    expect(create).toBeLessThan(docker.findIndex(composeUp))
  })

  test('keeps the proxy network when it exists', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    expect(
      cli.bin.calls('docker').some((call) => call.args[1] === 'create'),
    ).toBe(false)
  })

  test('starts the core stack and provisions Dockhand', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(`*.${TEST_DOMAIN} valid until 2126`)
    expect(result.output).toContain('local-env is running')
    expect(result.output).toContain('Dockhand set up for local-env')
    expect(result.output).toContain(
      `Dashboard: https://local-env.${TEST_DOMAIN}`,
    )
    expect(result.output).toContain(`Dockhand:  https://docker.${TEST_DOMAIN}`)
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
    expect(cli.dockhand.state.sidebar).toEqual({
      order: [],
      hidden: HIDDEN_SIDEBAR_ITEMS,
    })
  })

  test("keeps the user's own Dockhand sidebar", async () => {
    const sidebar = { order: ['/stacks', '/?home'], hidden: ['/logs'] }
    await using cli = await createCli({
      dockhand: { ...provisionedDockhand(), sidebar },
    })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    expect(cli.dockhand.state.sidebar).toEqual(sidebar)
  })

  test("removes the template lists local-env registered in Dockhand, keeps the user's", async () => {
    const lissy = buildDockhandTemplateSource({
      id: 2,
      name: 'Lissy93',
      url: 'https://example.com/lissy93/templates.json',
    })
    await using cli = await createCli({
      dockhand: {
        ...provisionedDockhand(),
        templateSources: [
          buildDockhandTemplateSource({
            id: 1,
            url: 'http://catalog-server:8080/acme/templates.json?v=abc',
          }),
          lissy,
        ],
      },
    })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    expect(cli.dockhand.state.templateSources).toEqual([lissy])
  })

  test('changes nothing in a provisioned Dockhand', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    expect(result.output).not.toContain('Dockhand set up for local-env')
    const writes = cli.dockhand.requests.filter(
      (request) => request.method !== 'GET',
    )
    expect(writes).toEqual([])
  })

  test('says when another app answers on the Dockhand port', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)
    // A Rails app on the same port: its 404 page
    cli.dockhand.on(
      'GET /environments',
      () =>
        new Response('<!DOCTYPE html><title>Action Controller</title>', {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    )

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Another app answers on')
    expect(result.output).not.toContain('<!DOCTYPE html>')
  })

  test('renews an expired certificate and reloads the proxy', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate('expired')
    machineReady(cli)
    // The expired fixture is self-signed too: it is checked against no CA
    cli.bin.on('mkcert', ['-CAROOT'], { exitCode: 1 })

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
