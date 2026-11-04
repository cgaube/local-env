import { Glob } from 'bun'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import packageJson from '#package.json' with { type: 'json' }
import { fakeFormula } from '#cli-tests/support/fake-formula.js'
import { createCli } from '#cli-tests/support/run-cli.js'

// The core stack the CLI ships, at the repo root
const REPO = resolve(import.meta.dir, '../../../../..')

describe.concurrent('local-env', () => {
  test('--version prints the package version', async () => {
    await using cli = await createCli()

    const result = await cli.run(['--version'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe(packageJson.version)
  })

  test('--help lists every command', async () => {
    await using cli = await createCli()

    const result = await cli.run(['--help'])

    expect(result.exitCode).toBe(0)
    for (const command of [
      'setup',
      'start',
      'stop',
      'status',
      'config',
      'update',
      'sources',
      'proxy',
      'doctor',
      'reset',
    ]) {
      expect(result.stdout).toContain(`  ${command}`)
    }
  })

  test('--version and --help leave the home folder alone', async () => {
    await using cli = await createCli()

    await cli.run(['--version'])
    await cli.run(['--help'])

    expect(cli.home.exists('compose.yaml')).toBe(false)
  })

  test('a command writes the shipped files to the home folder', async () => {
    await using cli = await createCli()

    await cli.run(['config', 'get'])

    expect(cli.home.exists('compose.yaml')).toBe(true)
    expect(cli.home.exists('services/proxy-connector/connector.ts')).toBe(true)
  })

  test('writes every shipped file byte for byte', async () => {
    await using cli = await createCli()

    await cli.run(['config', 'get'])

    // Includes the dashboard's build when it exists, with its binary fonts
    const shipped = [
      ...new Glob('services/**/*').scanSync({ cwd: REPO }),
    ].filter((path) => !path.startsWith('services/proxy/certs/'))
    const different = shipped.filter(
      (path) =>
        !readFileSync(cli.home.path(path)).equals(
          readFileSync(join(REPO, path)),
        ),
    )
    expect(shipped.length).toBeGreaterThan(0)
    expect(different).toEqual([])
  })

  test('rejects an unknown command', async () => {
    await using cli = await createCli()

    const result = await cli.run(['deploy'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("unknown command 'deploy'")
  })
})

describe.concurrent('local-env, when a new version is out', () => {
  test('says so, with how to upgrade', async () => {
    await using cli = await createCli()
    using formula = fakeFormula('99.0.0')

    const result = await cli.run(['config', 'get'], { env: formula.env })

    expect(result.output).toContain('A new version is available')
    expect(result.output).toContain(
      'local-env 99.0.0 is out. Run `local-env update` to get it.',
    )
  })

  test('reads the formula once a day', async () => {
    await using cli = await createCli()
    using formula = fakeFormula('99.0.0')

    await cli.run(['config', 'get'], { env: formula.env })
    const second = await cli.run(['config', 'get'], { env: formula.env })

    expect(formula.requests()).toBe(1)
    // From the answer it kept
    expect(second.output).toContain('local-env 99.0.0 is out')
  })

  test('asks again once the last answer is a day old', async () => {
    await using cli = await createCli()
    using formula = fakeFormula('99.0.0')
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    cli.home.writeJson('update-check.json', {
      checkedAt: twoDaysAgo.toISOString(),
      latest: packageJson.version,
    })

    const result = await cli.run(['config', 'get'], { env: formula.env })

    expect(formula.requests()).toBe(1)
    expect(result.output).toContain('local-env 99.0.0 is out')
  })

  test('keeps what it knew when the formula is out of reach', async () => {
    await using cli = await createCli()
    cli.home.writeJson('update-check.json', {
      checkedAt: new Date(0).toISOString(),
      latest: '99.0.0',
    })

    // The default formula URL of the tests: nothing listens there
    const result = await cli.run(['config', 'get'])

    expect(result.output).toContain('local-env 99.0.0 is out')
  })

  test('says nothing when this is the latest version', async () => {
    await using cli = await createCli()
    using formula = fakeFormula(packageJson.version)

    const result = await cli.run(['config', 'get'], { env: formula.env })

    expect(formula.requests()).toBe(1)
    expect(result.output).not.toContain('A new version is available')
  })

  test('leaves --version alone', async () => {
    await using cli = await createCli()
    using formula = fakeFormula('99.0.0')

    await cli.run(['--version'], { env: formula.env })

    expect(formula.requests()).toBe(0)
  })
})
