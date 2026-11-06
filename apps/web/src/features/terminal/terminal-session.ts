// The page's end of /api/terminal: one WebSocket to the dashboard agent,
// through the dashboard server, while the terminal sheet is open. The run
// lives in the agent: closing the sheet, a reload or the dashboard restarting
// during `update` only drops this socket. The next one gets the run's output
// so far, so the terminal shows it again.
import type {
  AgentCommand,
  ClientMessage,
  RunState,
  ServerMessage,
} from '#services/dashboard/agent-protocol.ts'

export type SessionState = {
  connection: 'idle' | 'connecting' | 'open' | 'reconnecting'
  run: RunState | null
  // The agent refused the last command (one already runs)
  error: string | null
}

// Output for the terminal: reset clears it, for a new run or a replay
export type OutputEvent = { reset: true } | { reset: false; chunk: Uint8Array }

const RETRY_MS = [500, 1000, 2000, 5000]

const terminalUrl = () =>
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/terminal`

export const createTerminalSession = (
  connect: () => WebSocket = () => new WebSocket(terminalUrl()),
) => {
  let state: SessionState = { connection: 'idle', run: null, error: null }
  const listeners = new Set<() => void>()
  const outputListeners = new Set<(event: OutputEvent) => void>()
  // The current run's output, for a terminal that mounts after it arrived
  let output: Uint8Array[] = []
  let socket: WebSocket | null = null
  let wanted = false
  let retries = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  // Sent once the agent said what runs: it may already run this command
  let pendingStart: AgentCommand | null = null
  let size = { cols: 100, rows: 30 }

  const update = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  const emit = (event: OutputEvent) => {
    if (event.reset) output = []
    else output.push(event.chunk)
    for (const listener of outputListeners) listener(event)
  }

  const send = (message: ClientMessage) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }

  const sendStart = (command: AgentCommand) => {
    pendingStart = null
    if (state.run?.status === 'running') {
      // Attached to it: the same command is what the user asked for
      if (state.run.command !== command) {
        update({ error: `local-env ${state.run.command} is already running` })
      }
      return
    }
    update({ error: null })
    send({ type: 'start', command, ...size })
  }

  const onMessage = (event: MessageEvent) => {
    if (typeof event.data !== 'string') {
      emit({ reset: false, chunk: new Uint8Array(event.data as ArrayBuffer) })
      return
    }
    const message = JSON.parse(event.data) as ServerMessage
    if (message.type === 'error') {
      update({ error: message.message })
      return
    }
    const fresh =
      message.replay || message.run?.startedAt !== state.run?.startedAt
    if (fresh) emit({ reset: true })
    update({ run: message.run })
    if (message.replay && pendingStart) sendStart(pendingStart)
  }

  const open = () => {
    wanted = true
    if (socket) return
    update({ connection: retries > 0 ? 'reconnecting' : 'connecting' })
    const ws = connect()
    ws.binaryType = 'arraybuffer'
    socket = ws
    ws.onopen = () => {
      retries = 0
      update({ connection: 'open' })
    }
    ws.onmessage = onMessage
    ws.onclose = () => {
      if (socket !== ws) return
      socket = null
      if (!wanted) {
        update({ connection: 'idle' })
        return
      }
      // The dashboard restarts during `update`: try again
      const delay = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]
      retries++
      update({ connection: 'reconnecting' })
      retryTimer = setTimeout(open, delay)
    }
  }

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    // The output so far, then each chunk
    onOutput: (listener: (event: OutputEvent) => void) => {
      outputListeners.add(listener)
      return () => {
        outputListeners.delete(listener)
      }
    },
    output: () => output,
    open,
    // The run goes on in the agent
    close: () => {
      wanted = false
      pendingStart = null
      clearTimeout(retryTimer)
      retries = 0
      const ws = socket
      socket = null
      ws?.close()
      update({ connection: 'idle' })
    },
    start: (command: AgentCommand) => {
      open()
      if (
        state.connection === 'open' &&
        socket?.readyState === WebSocket.OPEN
      ) {
        sendStart(command)
      } else {
        pendingStart = command
      }
    },
    input: (data: string) => send({ type: 'input', data }),
    resize: (cols: number, rows: number) => {
      size = { cols, rows }
      send({ type: 'resize', cols, rows })
    },
  }
}

export type TerminalSession = ReturnType<typeof createTerminalSession>
