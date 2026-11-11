// The agent's server: runs `local-env install`, `update` or `deploy` in a pty
// for the dashboard, which can't run anything on the Mac itself. Only the
// dashboard holds the token (volumes/agent/token, mounted into it alone).
//   GET /status   -> the version and the current or last run
//   GET /terminal -> a WebSocket on that run. The client sends JSON:
//                    { type: 'start', command, template?, cols, rows }
//                    { type: 'input', data }
//                    { type: 'resize', cols, rows }
//                    and gets the pty's output as binary frames, and JSON
//                    { type: 'state', run, replay } on attach and on change.
// One run at a time: a client that connects during a run attaches to it and
// first gets its output so far (the dashboard restarts during `update`).
import type { ServerWebSocket, Subprocess } from 'bun'
import { timingSafeEqual } from 'node:crypto'
import {
  AGENT_COMMANDS,
  type AgentCommand,
  type AgentStatus,
  type LoginsReport,
  type RunState,
  runArguments,
  type ServerMessage,
} from '#services/dashboard/agent-protocol.js'

// Output kept for clients that attach later: the end of the run
const REPLAY_BYTES = 1024 * 1024

const isCommand = (value: unknown): value is AgentCommand =>
  AGENT_COMMANDS.includes(value as AgentCommand)

const size = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, 1000)
    : fallback

const sameToken = (given: string, expected: string) => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const startAgentServer = ({
  port,
  hostname = '127.0.0.1',
  token,
  version,
  argv,
  env = {},
  onRunExit,
  logins,
}: {
  port: number
  hostname?: string
  token: string
  version: string
  // The process for a command and its arguments: local-env itself, a script
  // in tests
  argv: (command: AgentCommand, args: string[]) => string[]
  env?: Record<string, string>
  onRunExit?: (run: RunState) => void
  // GET /logins: the logins of the sources and their state
  // (logins/report.ts), checked on each request
  logins?: () => Promise<LoginsReport>
}) => {
  let run: RunState | null = null
  let output: Uint8Array[] = []
  let outputBytes = 0
  let terminal: Bun.Terminal | null = null
  let child: Subprocess | null = null
  const clients = new Set<ServerWebSocket<unknown>>()

  const send = (ws: ServerWebSocket<unknown>, message: ServerMessage) =>
    ws.send(JSON.stringify(message))

  const broadcast = (message: ServerMessage) => {
    for (const ws of clients) send(ws, message)
  }

  const keep = (chunk: Uint8Array) => {
    output.push(chunk)
    outputBytes += chunk.byteLength
    while (outputBytes > REPLAY_BYTES && output.length > 1) {
      outputBytes -= output.shift()!.byteLength
    }
  }

  const start = (message: Record<string, unknown>) => {
    if (run?.status === 'running') {
      return { error: `local-env ${run.command} is already running` }
    }
    if (!isCommand(message.command)) return { error: 'Unknown command' }
    const command = message.command
    const args = runArguments(command, message.template)
    if (!args) return { error: `Not a run of local-env ${command}` }
    run = {
      command,
      template: command === 'deploy' ? args[0]! : null,
      status: 'running',
      exitCode: null,
      startedAt: new Date().toISOString(),
    }
    output = []
    outputBytes = 0
    // Clients clear their screen: a new run
    broadcast({ type: 'state', run, replay: false })

    const pty = new Bun.Terminal({
      cols: size(message.cols, 100),
      rows: size(message.rows, 30),
      data(_terminal, chunk) {
        const copy = new Uint8Array(chunk)
        keep(copy)
        for (const ws of clients) ws.sendBinary(copy)
      },
    })
    terminal = pty
    const proc = Bun.spawn(argv(command, args), {
      terminal: pty,
      // What xterm.js draws: 256 colors, and 24-bit ones, which the title's
      // gradient needs (utils/brand.ts)
      env: {
        ...process.env,
        ...env,
        // The run is in the dashboard, not in your terminal: it logs in to
        // nothing (logins/session.ts)
        LOCAL_ENV_FROM_DASHBOARD: '1',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    })
    child = proc
    const current = run
    void proc.exited.then((exitCode) => {
      // The pty may still hold the last output: let it arrive first
      setTimeout(() => {
        pty.close()
        if (terminal === pty) terminal = null
        if (child === proc) child = null
        current.status = 'exited'
        current.exitCode = exitCode
        broadcast({ type: 'state', run: current, replay: false })
        onRunExit?.(current)
      }, 50)
    })
    return { error: null }
  }

  const handle = (ws: ServerWebSocket<unknown>, raw: string | Buffer) => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (message.type === 'start') {
      const { error } = start(message)
      if (error) send(ws, { type: 'error', message: error })
    } else if (message.type === 'input') {
      if (terminal && typeof message.data === 'string') {
        terminal.write(message.data)
      }
    } else if (message.type === 'resize') {
      terminal?.resize(size(message.cols, 100), size(message.rows, 30))
    }
  }

  const server = Bun.serve({
    port,
    hostname,
    fetch(request, server) {
      const auth = request.headers.get('Authorization') ?? ''
      if (!sameToken(auth, `Bearer ${token}`)) {
        return new Response('Unauthorized', { status: 401 })
      }
      const { pathname } = new URL(request.url)
      if (pathname === '/status') {
        return Response.json({ version, run } satisfies AgentStatus)
      }
      if (pathname === '/logins' && logins) {
        return logins().then(
          (report) => Response.json(report),
          (error: unknown) =>
            Response.json(
              { error: error instanceof Error ? error.message : String(error) },
              { status: 500 },
            ),
        )
      }
      if (pathname === '/terminal') {
        if (server.upgrade(request, { data: null })) return undefined
        return new Response('Expected a WebSocket', { status: 426 })
      }
      return new Response('Not found', { status: 404 })
    },
    websocket: {
      open(ws) {
        clients.add(ws)
        send(ws, { type: 'state', run, replay: true })
        for (const chunk of output) ws.sendBinary(chunk)
      },
      message: handle,
      close(ws) {
        clients.delete(ws)
      },
    },
  })

  return {
    port: server.port!,
    isBusy: () => run?.status === 'running',
    // The run goes with the agent: its pty is gone
    stop: async () => {
      child?.kill('SIGHUP')
      terminal?.close()
      await server.stop(true)
    },
  }
}
