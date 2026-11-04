import { join } from 'path'
import { TEST_DOMAIN } from '#cli-tests/support/factories/config.js'
import {
  brewInstalled,
  dockerRunning,
  machineReady,
  mkcertInstalled,
} from '#cli-tests/support/machine.js'
import { COMPILED, createCli } from '#cli-tests/support/run-cli.js'

const IS_MAC = process.platform === 'darwin'

describe.concurrent('local-env setup', () => {
  test('--yes saves the settings and creates the certificate', async () => {
    await using cli = await createCli()
    machineReady(cli)

    const result = await cli.run(['setup', '--yes', '--domain', TEST_DOMAIN])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Setup complete')
    expect(cli.home.readJson('config.json')).toMatchObject({
      domain: TEST_DOMAIN,
    })
    expect(
      cli.bin
        .calls('mkcert')
        .filter((call) => call.args[0] !== '-CAROOT')
        .map((call) => `${call.args[0]} ${call.env.TRUST_STORES ?? 'all'}`),
    ).toEqual(['-install nss', '-cert-file all'])
    // Already trusted: no password dialog
    expect(cli.bin.calls('security').map((call) => call.args[0])).toEqual([
      'verify-cert',
    ])
    expect(cli.home.exists(`services/proxy/certs/${TEST_DOMAIN}.crt`)).toBe(
      true,
    )
  })

  test.skipIf(!IS_MAC)('--yes points the domain at dnsmasq', async () => {
    await using cli = await createCli()
    dockerRunning(cli.bin)
    mkcertInstalled(cli.bin)
    const { prefix } = brewInstalled(cli)

    await cli.run(['setup', '--yes', '--domain', TEST_DOMAIN])

    const config = await Bun.file(
      join(prefix, 'etc/dnsmasq.d/local-env.conf'),
    ).text()
    expect(config).toContain(`address=/${TEST_DOMAIN}/127.0.0.1`)
    expect(cli.bin.calls('sudo').map((call) => call.args)).toEqual([
      [join(prefix, 'bin/brew'), 'services', 'restart', 'dnsmasq'],
      ['mkdir', '-p', '/etc/resolver'],
      ['cp', expect.any(String), `/etc/resolver/${TEST_DOMAIN}`],
    ])
  })

  test.skipIf(!IS_MAC)(
    '--yes installs the missing Homebrew packages',
    async () => {
      await using cli = await createCli()
      dockerRunning(cli.bin)
      mkcertInstalled(cli.bin)
      brewInstalled(cli, { missing: ['nss'] })

      const result = await cli.run(['setup', '--yes', '--domain', TEST_DOMAIN])

      expect(result.exitCode).toBe(0)
      expect(
        cli.bin
          .calls('brew')
          .filter((call) => call.args[0] === 'install')
          .map((call) => call.args),
      ).toEqual([['install', 'nss']])
    },
  )

  test.skipIf(!IS_MAC || COMPILED)(
    'stops when the missing packages are declined',
    async () => {
      await using cli = await createCli()
      dockerRunning(cli.bin)
      mkcertInstalled(cli.bin)
      brewInstalled(cli, { missing: ['dnsmasq'] })

      const result = await cli.run(['setup'], {
        answers: [{ ask: 'Install them with Homebrew now?', answer: false }],
      })

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('Missing dnsmasq')
      expect(result.output).toContain('Setup needs these packages')
      expect(cli.home.exists('config.json')).toBe(false)
    },
  )

  test.skipIf(COMPILED)('asks for each setting', async () => {
    await using cli = await createCli()
    machineReady(cli)

    const result = await cli.run(['setup'], {
      answers: [
        { ask: 'Domain for local services', answer: ` .${TEST_DOMAIN} ` },
        { ask: 'Port for template builds', answer: '47081' },
      ],
    })

    expect(result.exitCode).toBe(0)
    expect(cli.home.readJson('config.json')).toEqual({
      domain: TEST_DOMAIN,
      buildPort: 47081,
    })
  })

  test.skipIf(COMPILED)(
    'offers to replace a valid certificate on review',
    async () => {
      await using cli = await createCli()
      machineReady(cli)
      cli.home.seedConfig()
      cli.home.seedCertificate()

      const result = await cli.run(['setup'], {
        answers: [
          { ask: 'Domain for local services', answer: TEST_DOMAIN },
          { ask: 'Port for template builds', answer: '47080' },
          { ask: 'is valid. Replace it anyway?', answer: true },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(
        `Created a certificate for *.${TEST_DOMAIN}`,
      )
    },
  )

  test.skipIf(COMPILED)(
    'cleans up the previous domain on approval',
    async () => {
      await using cli = await createCli()
      machineReady(cli)
      cli.home.seedConfig({ domain: 'old-e2e.test' })
      cli.home.write('services/proxy/certs/old-e2e.test.crt', 'old')
      cli.home.write('services/proxy/certs/old-e2e.test.key', 'old')

      const result = await cli.run(['setup', '--domain', TEST_DOMAIN], {
        answers: [
          { ask: 'Port for template builds', answer: '47080' },
          { ask: 'Remove the DNS setup of old-e2e.test?', answer: true },
          { ask: 'Remove the certificate of *.old-e2e.test?', answer: true },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(cli.home.exists('services/proxy/certs/old-e2e.test.crt')).toBe(
        false,
      )
    },
  )

  test('fails when mkcert cannot create its CA', async () => {
    await using cli = await createCli()
    machineReady(cli)
    cli.bin.on('mkcert', ['-CAROOT'], { stdout: `${cli.root}/no-ca\n` })
    cli.bin.on('mkcert', ['-install'], {
      env: { TRUST_STORES: 'nss' },
      stderr: 'ERROR: failed to create the CA\n',
      exitCode: 1,
    })

    const result = await cli.run(['setup', '--yes'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Setup failed')
    expect(cli.home.exists('config.json')).toBe(false)
  })

  test('trusts a new CA for the user, without sudo', async () => {
    await using cli = await createCli()
    machineReady(cli)
    cli.bin.on('security', ['verify-cert'], { exitCode: 1 })
    cli.bin.on('security', ['add-trusted-cert'])

    const result = await cli.run(['setup', '--yes', '--domain', TEST_DOMAIN])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Local certificate authority trusted')
    expect(cli.bin.calls('security').map((call) => call.args)).toEqual([
      ['verify-cert', '-c', expect.stringContaining('rootCA.pem')],
      [
        'add-trusted-cert',
        '-r',
        'trustRoot',
        expect.stringContaining('rootCA.pem'),
      ],
    ])
    expect(
      cli.bin.calls('sudo').filter((call) => call.args.includes('security')),
    ).toEqual([])
  })

  test('continues with the manual steps when the CA cannot be trusted', async () => {
    await using cli = await createCli()
    machineReady(cli)
    cli.bin.on('security', ['verify-cert'], { exitCode: 1 })
    cli.bin.on('security', ['add-trusted-cert'], {
      stderr:
        'SecTrustSettingsSetTrustSettings: The authorization was canceled by the user.\n',
      exitCode: 1,
    })

    const result = await cli.run(['setup', '--yes', '--domain', TEST_DOMAIN])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('not fully trusted')
    expect(result.output).toContain('security add-trusted-cert -r trustRoot')
    expect(cli.home.exists(`services/proxy/certs/${TEST_DOMAIN}.crt`)).toBe(
      true,
    )
  })
})
