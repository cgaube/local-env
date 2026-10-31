import packageJson from '../../../package.json' with { type: 'json' }
import { createCli } from '../../support/run-cli.js'

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

  test('rejects an unknown command', async () => {
    await using cli = await createCli()

    const result = await cli.run(['deploy'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("unknown command 'deploy'")
  })
})
