import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAgentServer } from '#cli/agent/server.js'
import type {
  AgentCommand,
  AgentEvent,
  ServerMessage,
} from '#services/dashboard/agent-protocol.js'

const TOKEN = 'secret-token'

// A command that prints, reads a line and exits with a code: what a prompt
// of `local-env install` does through the pty
const SCRIPTS: Record<AgentCommand, string> = {
  install: 'printf "ready\\n"; read answer; echo "answer:$answer"; exit 3',
  update: 'printf "updating %s %s\\n" "$TERM" "$COLORTERM"; sleep 0.2; exit 0',
  deploy: 'printf "deploying %s\\n" "$*"; exit 0',
}

const startServer = (onRunExit?: () => void) =>
  startAgentServer({
    port: 0,
    token: TOKEN,
    version: '1.2.3',
    argv: (command, args) => ['sh', '-c', SCRIPTS[command], command, ...args],
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
      await new Promise((resolve) => setTimeout(resolve, 10))
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

// GET /events, read line by line as they come
const listen = async (port: number) => {
  const controller = new AbortController()
  const response = await fetch(`http://127.0.0.1:${port}/events`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: controller.signal,
  })
  const events: AgentEvent[] = []
  const decoder = new TextDecoder()
  let buffer = ''
  void (async () => {
    try {
      for await (const chunk of response.body!) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        events.push(
          ...lines
            .filter((line) => line !== '')
            .map((line) => JSON.parse(line) as AgentEvent),
        )
      }
    } catch {
      // Aborted
    }
  })()
  const waitFor = async (check: () => boolean) => {
    const deadline = Date.now() + 5000
    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out: ${JSON.stringify(events)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  return {
    status: response.status,
    events,
    waitFor,
    close: () => controller.abort(),
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

  test('gives the logins, checked on each request', async () => {
    let checks = 0
    const server = startAgentServer({
      port: 0,
      token: TOKEN,
      version: '1.2.3',
      argv: (command, args) => ['sh', '-c', SCRIPTS[command], command, ...args],
      logins: async () => {
        checks++
        return { logins: [] }
      },
    })
    try {
      const get = () =>
        fetch(`http://127.0.0.1:${server.port}/logins`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        })
      expect(await (await get()).json()).toEqual({ logins: [] })
      await get()
      expect(checks).toBe(2)
      const anonymous = await fetch(`http://127.0.0.1:${server.port}/logins`)
      expect(anonymous.status).toBe(401)
    } finally {
      await server.stop()
    }
  })

  test('reports the changes of the folders it watches, once per burst', async () => {
    const tools = mkdtempSync(join(tmpdir(), 'agent-tools-'))
    const sources = mkdtempSync(join(tmpdir(), 'agent-sources-'))
    const server = startAgentServer({
      port: 0,
      token: TOKEN,
      version: '1.2.3',
      argv: (command, args) => ['sh', '-c', SCRIPTS[command], command, ...args],
      watched: { tools, sources },
    })
    const listener = await listen(server.port)
    try {
      expect(listener.status).toBe(200)
      // macOS starts a watch asynchronously: a write made at once can be
      // missed, under load. Write until the first event, then start over.
      // Slower than a burst (100 ms), or the burst never ends
      const probe = setInterval(
        () => writeFileSync(join(tools, 'probe'), String(Date.now())),
        200,
      )
      await listener.waitFor(() => listener.events.length > 0)
      clearInterval(probe)
      await new Promise((resolve) => setTimeout(resolve, 300))
      listener.events.length = 0

      writeFileSync(join(tools, 'installed.json'), '{}')
      writeFileSync(join(tools, 'stacks.json'), '{}')
      await listener.waitFor(() => listener.events.length > 0)
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(listener.events).toEqual([{ topic: 'tools' }])

      writeFileSync(join(sources, 'HEAD'), 'ref')
      await listener.waitFor(() => listener.events.length > 1)
      expect(listener.events.at(-1)).toEqual({ topic: 'sources' })
    } finally {
      listener.close()
      await server.stop()
    }
  })

  test('reports when a run starts and ends', async () => {
    const server = startServer()
    const listener = await listen(server.port)
    const client = await connect(server.port)
    try {
      client.send({ type: 'start', command: 'update' })
      await client.waitFor(() => lastState(client)?.run?.status === 'exited')
      await listener.waitFor(() => listener.events.length === 2)
      expect(listener.events).toEqual([{ topic: 'run' }, { topic: 'run' }])
    } finally {
      client.close()
      listener.close()
      await server.stop()
    }
  })

  test('refuses the events without the token', async () => {
    const server = startServer()
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/events`)
      expect(response.status).toBe(401)
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

  test('deploys the template it is given, without asking first', async () => {
    const server = startServer()
    const client = await connect(server.port)
    try {
      client.send({ type: 'start', command: 'deploy', template: 'acme/mail' })
      await client.waitFor(() => lastState(client)?.run?.status === 'exited')
      expect(client.output()).toContain('deploying acme/mail --yes')
      expect(lastState(client)?.run).toMatchObject({
        command: 'deploy',
        template: 'acme/mail',
      })
    } finally {
      client.close()
      await server.stop()
    }
  })

  test.each([
    { command: 'deploy' },
    { command: 'deploy', template: 'acme/mail; rm -rf ~' },
    { command: 'deploy', template: '--help' },
    { command: 'install', template: 'acme/mail' },
  ])('refuses a run with other arguments: %p', async (message) => {
    const server = startServer()
    const client = await connect(server.port)
    try {
      client.send({ type: 'start', ...message })
      await client.waitFor(() =>
        client.messages.some((sent) => sent.type === 'error'),
      )
      expect(client.messages).toContainEqual({
        type: 'error',
        message: `Not a run of local-env ${message.command}`,
      })
      expect(server.isBusy()).toBe(false)
    } finally {
      client.close()
      await server.stop()
    }
  })
})
