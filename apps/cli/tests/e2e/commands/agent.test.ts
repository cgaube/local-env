import { readFileSync } from 'fs'
import packageJson from '#package.json' with { type: 'json' }
import { provisionedDockhand } from '#cli-tests/support/factories/dockhand.js'
import { machineReady } from '#cli-tests/support/machine.js'
import { type Cli, createCli } from '#cli-tests/support/run-cli.js'

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const startedCli = async () => {
  const cli = await createCli({ dockhand: provisionedDockhand() })
  cli.home.seedConfig()
  cli.home.seedCertificate()
  machineReady(cli)
  return cli
}

const agentInfo = (cli: Cli) =>
  cli.home.readJson('volumes/agent/agent.json') as {
    pid: number
    port: number
    version: string
  }

const agentStatus = (cli: Cli, token?: string) =>
  fetch(`http://127.0.0.1:${cli.agentPort}/status`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

// `local-env agent` is started by `start`, detached: these tests go through
// it, as users do
describe.concurrent('local-env agent', () => {
  test('is started by `start`, with a token only the dashboard gets', async () => {
    await using cli = await startedCli()

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Dashboard agent started')
    const info = agentInfo(cli)
    expect(info).toMatchObject({
      port: cli.agentPort,
      version: packageJson.version,
    })
    expect(isAlive(info.pid)).toBe(true)

    const token = readFileSync(cli.home.path('volumes/agent/token'), 'utf8')
    expect((await agentStatus(cli)).status).toBe(401)
    const status = await agentStatus(cli, token)
    expect(await status.json()).toEqual({
      version: packageJson.version,
      run: null,
    })
  })

  test('keeps the running agent on the next `start`', async () => {
    await using cli = await startedCli()
    await cli.run(['start'])
    const { pid } = agentInfo(cli)

    const result = await cli.run(['start'])

    expect(result.output).toContain('Dashboard agent running')
    expect(agentInfo(cli).pid).toBe(pid)
  })

  test('is listed by `status`', async () => {
    await using cli = await startedCli()

    const before = await cli.run(['status', '--services'])
    await cli.run(['start'])
    const after = await cli.run(['status', '--services'])

    expect(before.output).toContain('Dashboard agent not running')
    expect(after.output).toContain(
      `Dashboard agent ${packageJson.version} on 127.0.0.1:${cli.agentPort}`,
    )
  })

  test('is stopped by `stop`, its files with it', async () => {
    await using cli = await startedCli()
    await cli.run(['start'])
    const { pid } = agentInfo(cli)

    const result = await cli.run(['stop'])

    expect(result.output).toContain('Dashboard agent stopped')
    expect(isAlive(pid)).toBe(false)
    expect(cli.home.exists('volumes/agent/agent.json')).toBe(false)
    expect(cli.home.exists('volumes/agent/token')).toBe(false)
  })
})
