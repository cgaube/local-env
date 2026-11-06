import { startAgentServer } from '#cli/agent/server.js'
import type {
  AgentCommand,
  ServerMessage,
} from '#services/dashboard/agent-protocol.js'

const TOKEN = 'secret-token'

// A command that prints, reads a line and exits with a code: what a prompt
// of `local-env install` does through the pty
const SCRIPTS: Record<AgentCommand, string> = {
  install: 'printf "ready\\n"; read answer; echo "answer:$answer"; exit 3',
  update: 'printf "updating %s %s\\n" "$TERM" "$COLORTERM"; sleep 0.2; exit 0',
}

const startServer = (onRunExit?: () => void) =>
  startAgentServer({
    port: 0,
    token: TOKEN,
    version: '1.2.3',
    argv: (command) => ['sh', '-c', SCRIPTS[command]],
    onRunExit,
  })

type Client = {
  messages: ServerMessage[]
  output: () => string
  send: (message: unknown) => void
  waitFor: (check: () => boolean) => Promise<void>
  close: () => void
}

const connect = async (port: number): Promise<Client> => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  } as unknown as string[])
  ws.binaryType = 'arraybuffer'
  const messages: ServerMessage[] = []
  let output = ''
  const decoder = new TextDecoder()
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') messages.push(JSON.parse(event.data))
    else output += decoder.decode(event.data as ArrayBuffer)
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const waitFor = async (check: () => boolean) => {
    const deadline = Date.now() + 5000
    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out: ${JSON.stringify({ messages, output })}`)
      }
      await Bun.sleep(10)
    }
  }
  return {
    messages,
    output: () => output,
    send: (message) => ws.send(JSON.stringify(message)),
    waitFor,
    close: () => ws.close(),
  }
}

const lastState = (client: Client) =>
  client.messages.findLast((message) => message.type === 'state')

describe('agent server', () => {
  test('refuses a request without the token', async () => {
    const server = startServer()
    try {
      const none = await fetch(`http://127.0.0.1:${server.port}/status`)
      const wrong = await fetch(`http://127.0.0.1:${server.port}/status`, {
        headers: { Authorization: 'Bearer nope' },
      })
      expect(none.status).toBe(401)
      expect(wrong.status).toBe(401)
    } finally {
      await server.stop()
    }
  })

  test('gives its version and no run before the first', async () => {
    const server = startServer()
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      expect(await response.json()).toEqual({ version: '1.2.3', run: null })
    } finally {
      await server.stop()
    }
  })

  test('runs a command in a pty, with input, and reports its exit', async () => {
    let exited = 0
    const server = startServer(() => exited++)
    const client = await connect(server.port)
    try {
      await client.waitFor(() => client.messages.length > 0)
      expect(client.messages[0]).toEqual({
        type: 'state',
        run: null,
        replay: true,
      })

      client.send({ type: 'start', command: 'install', cols: 80, rows: 24 })
      await client.waitFor(() => client.output().includes('ready'))
      expect(server.isBusy()).toBe(true)

      client.send({ type: 'input', data: 'yes\r' })
      await client.waitFor(() => lastState(client)?.run?.status === 'exited')

      expect(client.output()).toContain('answer:yes')
      expect(lastState(client)?.run).toMatchObject({
        command: 'install',
        exitCode: 3,
      })
      expect(exited).toBe(1)
      expect(server.isBusy()).toBe(false)
    } finally {
      client.close()
      await server.stop()
    }
  })

  test('replays the run to a client that attaches later', async () => {
    const server = startServer()
    const first = await connect(server.port)
    try {
      first.send({ type: 'start', command: 'install' })
      await first.waitFor(() => first.output().includes('ready'))

      const second = await connect(server.port)
      await second.waitFor(() => second.output().includes('ready'))
      expect(second.messages[0]).toMatchObject({
        type: 'state',
        replay: true,
        run: { command: 'install', status: 'running' },
      })

      // Either client answers the prompt
      second.send({ type: 'input', data: 'from-second\r' })
      await first.waitFor(() => first.output().includes('answer:from-second'))
      second.close()
    } finally {
      first.close()
      await server.stop()
    }
  })

  test('refuses a second run while one is going', async () => {
    const server = startServer()
    const client = await connect(server.port)
    try {
      client.send({ type: 'start', command: 'install' })
      await client.waitFor(() => client.output().includes('ready'))
      client.send({ type: 'start', command: 'update' })
      await client.waitFor(() =>
        client.messages.some((message) => message.type === 'error'),
      )
      expect(client.messages).toContainEqual({
        type: 'error',
        message: 'local-env install is already running',
      })
      expect(client.output()).not.toContain('updating')
    } finally {
      client.close()
      await server.stop()
    }
  })

  test('tells the command what xterm.js draws: 24-bit colors too', async () => {
    const server = startServer()
    const client = await connect(server.port)
    try {
      client.send({ type: 'start', command: 'update' })
      await client.waitFor(() => lastState(client)?.run?.status === 'exited')
      expect(client.output()).toContain('updating xterm-256color truecolor')
    } finally {
      client.close()
      await server.stop()
    }
  })

  test('refuses any other command', async () => {
    const server = startServer()
    const client = await connect(server.port)
    try {
      client.send({ type: 'start', command: 'reset' })
      await client.waitFor(() =>
        client.messages.some((message) => message.type === 'error'),
      )
      expect(client.messages).toContainEqual({
        type: 'error',
        message: 'Unknown command',
      })
      expect(server.isBusy()).toBe(false)
    } finally {
      client.close()
      await server.stop()
    }
  })
})
