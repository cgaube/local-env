import { TEST_DOMAIN } from '../../support/factories/config.js'
import { machineReady } from '../../support/machine.js'
import { COMPILED, createCli } from '../../support/run-cli.js'

describe('local-env config get', () => {
  test('lists the defaults before setup', async () => {
    await using cli = await createCli()

    const result = await cli.run(['config', 'get'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toMatchSnapshot()
  })

  test('marks only the stored settings as set', async () => {
    await using cli = await createCli()
    cli.home.writeJson('config.json', { domain: 'acme.test' })

    const result = await cli.run(['config', 'get'])

    expect(result.output).toMatchSnapshot()
  })

  test('prints a bare value for scripts', async () => {
    await using cli = await createCli()
    cli.home.seedConfig({ domain: 'acme.test' })

    const result = await cli.run(['config', 'get', 'domain'])

    expect(result.stdout).toBe('acme.test\n')
  })

  test('rejects an unknown setting', async () => {
    await using cli = await createCli()

    const result = await cli.run(['config', 'get', 'colour'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Unknown setting "colour"')
  })
})

describe.concurrent('local-env config set', () => {
  test('saves a normalized domain without applying it', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()

    const result = await cli.run([
      'config',
      'set',
      'domain',
      ' .Acme.Test ',
      '--no-apply',
    ])

    expect(result.exitCode).toBe(0)
    expect(cli.home.readJson('config.json')).toMatchObject({
      domain: 'acme.test',
    })
    // --no-apply: no certificate, DNS or proxy change
    expect(cli.bin.calls('mkcert')).toEqual([])
    expect(cli.bin.calls('sudo')).toEqual([])
  })

  test('says when the value is already set', async () => {
    await using cli = await createCli()
    cli.home.seedConfig({ domain: 'acme.test' })

    const result = await cli.run([
      'config',
      'set',
      'domain',
      'acme.test',
      '--no-apply',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('domain is already acme.test')
  })

  test('rejects an invalid domain and keeps the config', async () => {
    await using cli = await createCli()
    cli.home.seedConfig({ domain: 'acme.test' })

    const result = await cli.run([
      'config',
      'set',
      'domain',
      'not a domain',
      '--no-apply',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Invalid domain "not a domain"')
    expect(cli.home.readJson('config.json')).toMatchObject({
      domain: 'acme.test',
    })
  })
})

describe.concurrent('local-env config set, applied', () => {
  test.skipIf(COMPILED)(
    'creates the certificate and keeps the previous one on request',
    async () => {
      await using cli = await createCli()
      machineReady(cli)
      cli.home.seedConfig({ domain: 'old-e2e.test' })
      cli.home.write('services/proxy/certs/old-e2e.test.crt', 'old')
      cli.home.write('services/proxy/certs/old-e2e.test.key', 'old')

      const result = await cli.run(['config', 'set', 'domain', TEST_DOMAIN], {
        answers: [
          { ask: 'Remove the DNS setup of old-e2e.test?', answer: false },
          { ask: 'Remove the certificate of *.old-e2e.test?', answer: false },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(
        `Created a certificate for *.${TEST_DOMAIN}`,
      )
      expect(cli.home.exists('services/proxy/certs/old-e2e.test.crt')).toBe(
        true,
      )
      expect(cli.bin.calls('sudo').map((call) => call.args[0])).not.toContain(
        'rm',
      )
    },
  )

  test('rejects a build port out of range', async () => {
    await using cli = await createCli()
    cli.home.seedConfig()

    const result = await cli.run(['config', 'set', 'buildPort', '80'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Invalid port "80"')
  })
})
