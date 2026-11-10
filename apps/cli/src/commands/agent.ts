import { Command } from 'commander'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execa } from 'execa'
import packageJson from '#package.json' with { type: 'json' }
import { startAgentServer } from '#cli/agent/server.js'
import { buildLoginsReport } from '#cli/logins/report.js'
import {
  AGENT_DIR,
  AGENT_INFO,
  AGENT_TOKEN,
  agentBuild,
  agentPort,
  readAgentInfo,
  selfArgv,
  spawnAgent,
} from '#cli/core/agent.js'

const log = (message: string) =>
  console.log(`${new Date().toISOString()} ${message}`)

// The version of local-env on disk: `brew upgrade`, run by an `update` from
// the dashboard, installs a new one under this agent
const installedVersion = async () => {
  const result = await execa(selfArgv()[0]!, [...selfArgv().slice(1), '-V'], {
    reject: false,
  })
  return result.exitCode === 0 ? result.stdout.trim() : null
}

// Started by `local-env start` (src/core/agent.ts), detached, with its output
// in volumes/agent/agent.log. Hidden from --help.
export const agentCommand = new Command('agent')
  .description('Run install and update for the dashboard (started by start)')
  .action(async () => {
    const port = agentPort()
    const token = randomBytes(32).toString('hex')
    mkdirSync(AGENT_DIR, { recursive: true })

    const ownFiles = () => {
      if (readAgentInfo()?.pid !== process.pid) return
      rmSync(AGENT_INFO, { force: true })
      rmSync(AGENT_TOKEN, { force: true })
    }

    let server: ReturnType<typeof startAgentServer>
    try {
      server = startAgentServer({
        port,
        token,
        version: packageJson.version,
        argv: (command) => [...selfArgv(), command],
        logins: buildLoginsReport,
        // Not when it is idle: a run that just ended is what upgraded it
        onRunExit: async (run) => {
          log(`local-env ${run.command} exited with ${run.exitCode}`)
          const installed = await installedVersion()
          if (!installed || installed === packageJson.version) return
          if (server.isBusy()) return
          log(`local-env ${installed} is installed: handing over to it`)
          await server.stop()
          ownFiles()
          spawnAgent()
          process.exit(0)
        },
      })
    } catch (error) {
      log(`Couldn't listen on 127.0.0.1:${port}: ${String(error)}`)
      process.exit(1)
    }

    writeFileSync(AGENT_TOKEN, token, { mode: 0o600 })
    writeFileSync(
      AGENT_INFO,
      JSON.stringify({
        pid: process.pid,
        port: server.port,
        version: packageJson.version,
        build: agentBuild(),
      }),
    )
    log(`local-env ${packageJson.version} agent on 127.0.0.1:${server.port}`)

    const shutdown = async (signal: string) => {
      log(`${signal}: stopping`)
      await server.stop()
      ownFiles()
      process.exit(0)
    }
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
      process.on(signal, () => void shutdown(signal))
    }
  })
