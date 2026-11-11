// The dashboard agent: a process on the Mac that runs `local-env install` and
// `local-env update` for the dashboard (src/agent/server.ts). `local-env start`
// spawns it, detached, beside the core services; `stop` and `reset` end it.
// Nothing restarts it, like the core services: after a reboot, `start` brings
// both back. docs/3-how-it-works/dashboard-terminal.md explains why.
//   volumes/agent/agent.json -> { pid, port, version, build } of the running
//                               agent
//   volumes/agent/token      -> what the dashboard sends it (mounted there)
//   volumes/agent/agent.log  -> its output
import { spawn } from 'node:child_process'
import {
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import packageJson from '#package.json' with { type: 'json' }
import type { AgentStatus } from '#services/dashboard/agent-protocol.js'
import { CHECKOUT_DIR, HOME_DIR, IS_COMPILED } from '#cli/core/paths.js'

export const AGENT_DIR = join(HOME_DIR, 'volumes/agent')
export const AGENT_INFO = join(AGENT_DIR, 'agent.json')
export const AGENT_TOKEN = join(AGENT_DIR, 'token')
export const AGENT_LOG = join(AGENT_DIR, 'agent.log')

const DEFAULT_PORT = 17081

// Tests give each CLI its own
export const agentPort = () =>
  Number(process.env.LOCAL_ENV_AGENT_PORT ?? DEFAULT_PORT)

export type AgentInfo = {
  pid: number
  port: number
  version: string
  // Which program it runs (agentBuild): absent for an agent older than this
  build?: string
}

// <prefix>/Cellar/local-env/<version>/bin/local-env
const HOMEBREW_CELLAR = /\/Cellar\/local-env\/[^/]+\/bin\/local-env$/

// local-env itself, to run a command: this binary, or this checkout. For a
// Homebrew install, its link in <prefix>/bin, not the Cellar path of this
// version: `brew upgrade` installs the next one there, and `brew cleanup`
// removes this one.
export const selfArgv = () => {
  if (!IS_COMPILED) {
    return [process.execPath, join(CHECKOUT_DIR!, 'apps/cli/src/main.ts')]
  }
  const path = process.execPath
  return [
    HOMEBREW_CELLAR.test(path)
      ? path.replace(HOMEBREW_CELLAR, '/bin/local-env')
      : path,
  ]
}

// The code a checkout runs: the CLI's source and the services it imports
const CHECKOUT_CODE = ['apps/cli/src', 'services/dashboard']

// The time of the newest file of a checkout's code: it changes with each edit
const checkoutStamp = () =>
  Math.round(
    Math.max(
      0,
      ...CHECKOUT_CODE.flatMap((folder) => {
        const dir = join(CHECKOUT_DIR!, folder)
        if (!existsSync(dir)) return []
        return readdirSync(dir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
          .map((entry) => statSync(join(entry.parentPath, entry.name)).mtimeMs)
      }),
    ),
  )

// Which program this is: the command that runs local-env, and for a binary,
// the size and the time of its file; for a checkout, the time of its newest
// source file. The version alone is not enough: a checkout and Homebrew have
// the same one until a release, and a binary built again keeps it.
export const agentBuild = () => {
  const command = selfArgv().join(' ')
  if (!IS_COMPILED) return `${command} ${checkoutStamp()}`
  const { size, mtimeMs } = statSync(process.execPath)
  return `${command} ${size}:${Math.round(mtimeMs)}`
}

export const readAgentInfo = (): AgentInfo | null => {
  try {
    const info = JSON.parse(readFileSync(AGENT_INFO, 'utf8'))
    return typeof info?.pid === 'number' && typeof info?.port === 'number'
      ? info
      : null
  } catch {
    return null
  }
}

const readToken = () => {
  try {
    return readFileSync(AGENT_TOKEN, 'utf8').trim()
  } catch {
    return null
  }
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// What the agent answers, or null when none answers with our token
export const fetchAgentStatus = async (
  info = readAgentInfo(),
): Promise<AgentStatus | null> => {
  const token = readToken()
  if (!info || !token) return null
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
    })
    return response.ok ? ((await response.json()) as AgentStatus) : null
  } catch {
    return null
  }
}

const waitFor = async (check: () => boolean | Promise<boolean>, ms: number) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return true
    await Bun.sleep(50)
  }
  return false
}

// Ends the agent, and its run if one is going. Its files go with it. Whether
// one was running.
export const stopAgent = async () => {
  const info = readAgentInfo()
  const running = info !== null && isAlive(info.pid)
  if (running) {
    process.kill(info.pid, 'SIGTERM')
    if (!(await waitFor(() => !isAlive(info.pid), 3000))) {
      process.kill(info.pid, 'SIGKILL')
    }
  }
  rmSync(AGENT_INFO, { force: true })
  rmSync(AGENT_TOKEN, { force: true })
  return running
}

// Detached, in its own session: it outlives this command and its terminal
export const spawnAgent = () => {
  const log = openSync(AGENT_LOG, 'a')
  const [command, ...args] = selfArgv()
  const child = spawn(command!, [...args, 'agent'], {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, LOCAL_ENV_AGENT_PORT: String(agentPort()) },
  })
  child.unref()
  return child.pid!
}

export type EnsureResult =
  | { state: 'running' | 'started' | 'restarted' }
  // An older agent busy with a run: replaced by the next `start`
  | { state: 'busy'; version: string }

// The agent of this program (agentBuild) on the configured port, running
export const ensureAgent = async (): Promise<EnsureResult> => {
  const info = readAgentInfo()
  const status = info && isAlive(info.pid) ? await fetchAgentStatus(info) : null
  if (
    status &&
    status.version === packageJson.version &&
    info!.build === agentBuild() &&
    info!.port === agentPort()
  ) {
    return { state: 'running' }
  }
  if (status?.run?.status === 'running') {
    return { state: 'busy', version: status.version }
  }

  const replaced = existsSync(AGENT_INFO)
  await stopAgent()
  const pid = spawnAgent()
  const ready = await waitFor(
    async () =>
      readAgentInfo()?.pid === pid && (await fetchAgentStatus()) !== null,
    10_000,
  )
  if (!ready) {
    throw new Error(`The dashboard agent didn't start: see ${AGENT_LOG}`)
  }
  return { state: replaced ? 'restarted' : 'started' }
}

// For `status` and `doctor`
export const describeAgent = async () => {
  const info = readAgentInfo()
  if (!info || !isAlive(info.pid)) return { running: false as const }
  const status = await fetchAgentStatus(info)
  return status
    ? { running: true as const, port: info.port, ...status }
    : { running: false as const }
}
