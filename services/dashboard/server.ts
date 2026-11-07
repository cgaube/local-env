// The local-env dashboard, served behind the proxy itself: the web app built
// from apps/web into public/, and the data it shows. proxy-connector
// writes the routes.
//   /api/...     -> the data below
//   /assets/...  -> the app's files, cached for good (their names change)
//   any other    -> public/index.html: the app routes itself (/docker/routes)
//   /api/events  -> a Server-Sent Events stream: the current routes, services
//                   and sources on connect, then each of them again when it
//                   changes (watched files, no polling)
//   /api/config  -> the domain, for the help section
//   PUT /api/tools/picked -> the tools picked in the catalog: written to
//                   picked.json, which `local-env install` reads (tools.ts)
//   PUT /api/tools/profile -> the profile, picked in the sidebar: written to
//                   profile.json, which `local-env install` reads
//   PATCH /api/tools/variables -> values of the roles' inputs to set, or
//                   to remove (null): merged into variables.json, which
//                   `local-env install` passes to Ansible
//   /api/terminal -> a WebSocket to the dashboard agent, the process on the
//                   Mac that runs `local-env install` and `update` in a pty
//                   (apps/cli/src/agent/server.ts). Only this server has its
//                   token, and only the dashboard's own pages can connect.
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { join, normalize } from 'node:path'
import {
  GALAXY_FOLDER,
  isProfileChoice,
  applyVariablesChange,
  isVariablesChange,
  listGalaxyRoles,
  listRoleFolders,
  listRoles,
  readDeployedStacks,
  readInstalled,
  readProfile,
  readSelection,
  readVariables,
  writeProfile,
  writeSelection,
  writeVariables,
} from './tools.js'

const ROUTES_FILE = '/routes/routes.json'
const SERVICES_FILE = '/routes/services.json'
const SOURCES_DIR = '/sources'
const TOOLS_DIR = '/tools'
const GALAXY_DIR = join(TOOLS_DIR, GALAXY_FOLDER)
// The agent's token, mounted read-only: written by the agent when it starts
const AGENT_DIR = '/agent'
const AGENT_URL = process.env.AGENT_URL ?? 'http://host.docker.internal:17081'
const DOMAIN = process.env.DOMAIN ?? 'dev.test'
const PORT = 80

const subfolders = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort()
    : []

// The image has no git: read the origin from the clone's config
const readOrigin = (dir: string) => {
  try {
    const config = readFileSync(join(dir, '.git/config'), 'utf8')
    const url = /\[remote "origin"\][^[]*?url = (.+)/.exec(config)?.[1]?.trim()
    // Local sources are cloned through file:// to honour --depth
    return url?.replace(/^file:\/\//, '') ?? null
  } catch {
    return null
  }
}

// Stack templates in docker/templates.json whose compose file is in the
// source, like `local-env sources list`
const countTemplates = (dir: string) => {
  try {
    const list = JSON.parse(
      readFileSync(join(dir, 'docker/templates.json'), 'utf8'),
    )
    const templates: {
      type?: unknown
      repository?: { stackfile?: unknown }
    }[] = Array.isArray(list?.templates) ? list.templates : []
    return templates.filter(({ type, repository }) =>
      // Stack templates with their compose file in the source, and container
      // templates (Swarm ones are left out, like Dockhand does)
      type === 3
        ? typeof repository?.stackfile === 'string' &&
          repository.stackfile.startsWith('docker/') &&
          !repository.stackfile.includes('..') &&
          existsSync(join(dir, repository.stackfile))
        : type !== 2,
    ).length
  } catch {
    return 0
  }
}

const listSources = () =>
  subfolders(SOURCES_DIR)
    .filter((name) => existsSync(join(SOURCES_DIR, name, '.git')))
    .map((name) => {
      const dir = join(SOURCES_DIR, name)
      return {
        name,
        origin: readOrigin(dir),
        docker: countTemplates(dir),
        ansible: listRoleFolders(join(dir, 'ansible')).length,
      }
    })

// proxy-connector's files, as one line of JSON. Not written yet: it is still
// starting.
const readList = async (path: string) => {
  try {
    return JSON.stringify(JSON.parse(await Bun.file(path).text()))
  } catch {
    return '[]'
  }
}

const readAgentToken = () => {
  try {
    return readFileSync(join(AGENT_DIR, 'token'), 'utf8').trim()
  } catch {
    return null
  }
}

// Whether the agent answers, and its current or last run. Not running: the
// page shows the command to run instead.
const readAgent = async () => {
  const token = readAgentToken()
  if (token) {
    try {
      const response = await fetch(`${AGENT_URL}/status`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        const { version, run } = await response.json()
        return JSON.stringify({ available: true, version, run })
      }
    } catch {
      // Stopped, or killed without removing its token
    }
  }
  return JSON.stringify({ available: false, version: null, run: null })
}

const readers = {
  routes: () => readList(ROUTES_FILE),
  services: () => readList(SERVICES_FILE),
  sources: async () => JSON.stringify(listSources()),
  tools: async () => {
    const roles = listRoles(SOURCES_DIR)
    return JSON.stringify({
      roles,
      picked: readSelection(TOOLS_DIR),
      installed: readInstalled(TOOLS_DIR),
      profile: readProfile(TOOLS_DIR),
      // The stacks `local-env install` deployed for the roles
      stacks: readDeployedStacks(TOOLS_DIR),
      // The values of the inputs, and the installed Galaxy roles, for the
      // inputs of the roles they include
      variables: readVariables(TOOLS_DIR),
      galaxyRoles: listGalaxyRoles(GALAXY_DIR),
    })
  },
  agent: readAgent,
}
type Topic = keyof typeof readers

type Client = ReadableStreamDefaultController<Uint8Array>
const clients = new Set<Client>()
const encoder = new TextEncoder()

const send = (client: Client, topic: Topic, data: string) => {
  try {
    client.enqueue(encoder.encode(`event: ${topic}\ndata: ${data}\n\n`))
  } catch {
    clients.delete(client)
  }
}

// A sync rewrites several files and a git pull touches many: one message per
// burst of changes
const pending = new Map<Topic, ReturnType<typeof setTimeout>>()
const publish = (topic: Topic) => {
  clearTimeout(pending.get(topic))
  pending.set(
    topic,
    setTimeout(async () => {
      const data = await readers[topic]()
      for (const client of clients) send(client, topic, data)
    }, 200),
  )
}

watch('/routes', (_event, file) => {
  if (file === 'routes.json') publish('routes')
  if (file === 'services.json') publish('services')
})
watch(SOURCES_DIR, { recursive: true }, () => {
  publish('sources')
  publish('tools')
})
// picked.json, profile.json and variables.json, written below and by
// `local-env install`, and installed.json, by `local-env install`
watch(TOOLS_DIR, () => publish('tools'))
// The agent writes its token when it starts and removes it when it stops
watch(AGENT_DIR, () => publish('agent'))

// A run starts and ends without a file changing here: ask the agent while
// pages are open, and tell them only what changed
let lastAgent = ''
setInterval(async () => {
  if (clients.size === 0) return
  const data = await readAgent()
  if (data === lastAgent) return
  lastAgent = data
  for (const client of clients) send(client, 'agent', data)
}, 3000)

// A PUT of JSON, or the response that refuses it. JSON only: another site
// can't send it without a CORS preflight, which this server never allows.
const readPut = async (
  request: Request,
  method = 'PUT',
): Promise<{ body: Record<string, unknown> } | Response> => {
  if (request.method !== method) {
    return new Response('Method not allowed', { status: 405 })
  }
  if (request.headers.get('Content-Type') !== 'application/json') {
    return new Response('Expected JSON', { status: 415 })
  }
  const body: unknown = await request.json().catch(() => null)
  return {
    body:
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)
        : {},
  }
}

// Only roles of the catalog, or ones picked before and gone since (to unpick
// them)
const pickTools = async (request: Request) => {
  const put = await readPut(request)
  if (put instanceof Response) return put
  const catalog = listRoles(SOURCES_DIR)
  const known = new Set([
    ...catalog.map(({ id }) => id),
    ...readSelection(TOOLS_DIR),
  ])
  const { roles } = put.body
  if (
    !Array.isArray(roles) ||
    !roles.every((id) => typeof id === 'string' && known.has(id))
  ) {
    return new Response('Unknown roles', { status: 400 })
  }
  writeSelection(TOOLS_DIR, roles as string[])
  return new Response(null, { status: 204 })
}

// A profile of the catalog, or null for none
const chooseProfile = async (request: Request) => {
  const put = await readPut(request)
  if (put instanceof Response) return put
  const { profile } = put.body
  if (!isProfileChoice(listRoles(SOURCES_DIR), profile)) {
    return new Response('Unknown profile', { status: 400 })
  }
  writeProfile(TOOLS_DIR, profile)
  return new Response(null, { status: 204 })
}

// The values of the inputs that change, checked against the roles
// (isVariablesChange), merged into the file as it is now: a value that
// `local-env install` saved meanwhile stays
const saveVariables = async (request: Request) => {
  const put = await readPut(request, 'PATCH')
  if (put instanceof Response) return put
  const { variables } = put.body
  const saved = readVariables(TOOLS_DIR)
  if (
    !isVariablesChange(
      listRoles(SOURCES_DIR),
      listGalaxyRoles(GALAXY_DIR),
      saved,
      variables,
    )
  ) {
    return new Response('Unknown variables, or values of another type', {
      status: 400,
    })
  }
  writeVariables(TOOLS_DIR, applyVariablesChange(saved, variables))
  return new Response(null, { status: 204 })
}

const events = () => {
  let client: Client
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      client = controller
      clients.add(client)
      for (const topic of Object.keys(readers) as Topic[]) {
        send(client, topic, await readers[topic]())
      }
    },
    cancel() {
      clients.delete(client)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      // Through nginx as it is written, not once a buffer fills
      'X-Accel-Buffering': 'no',
    },
  })
}

// The dashboard's own pages: browsers don't apply CORS to WebSockets, so
// any site could otherwise open one to the agent
const DASHBOARD_ORIGIN = `https://local-env.${DOMAIN}`

type TerminalSocket = {
  upstream: WebSocket | null
  // What the page sent before the agent's socket opened: JSON, as text
  queue: string[]
}

// A WebSocket of the page, piped both ways to one of the agent
const openTerminal = (ws: Bun.ServerWebSocket<TerminalSocket>) => {
  const token = readAgentToken()
  if (!token) {
    ws.close(1011, 'The dashboard agent is not running')
    return
  }
  const upstream = new WebSocket(
    `${AGENT_URL.replace(/^http/, 'ws')}/terminal`,
    {
      headers: { Authorization: `Bearer ${token}` },
    } as unknown as string[],
  )
  upstream.binaryType = 'arraybuffer'
  ws.data.upstream = upstream
  upstream.onopen = () => {
    for (const message of ws.data.queue) upstream.send(message)
    ws.data.queue = []
  }
  upstream.onmessage = (event) => {
    if (typeof event.data === 'string') ws.send(event.data)
    else ws.sendBinary(new Uint8Array(event.data as ArrayBuffer))
  }
  upstream.onclose = () => ws.close(1011, 'The dashboard agent closed')
  upstream.onerror = () => ws.close(1011, 'The dashboard agent is not running')
}

const PUBLIC_DIR = join(import.meta.dir, 'public')
const app = Bun.file(join(PUBLIC_DIR, 'index.html'))

// A file of the built app, never one outside public/
const staticFile = (pathname: string) => {
  const path = normalize(join(PUBLIC_DIR, pathname))
  if (!path.startsWith(`${PUBLIC_DIR}/`)) return null
  return existsSync(path) && statSync(path).isFile() ? Bun.file(path) : null
}

Bun.serve<TerminalSocket>({
  port: PORT,
  // Event streams stay open with nothing to send
  idleTimeout: 0,
  async fetch(request, server) {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/events') return events()
    if (pathname === '/api/terminal') {
      if (request.headers.get('Origin') !== DASHBOARD_ORIGIN) {
        return new Response('Forbidden', { status: 403 })
      }
      if (server.upgrade(request, { data: { upstream: null, queue: [] } })) {
        return undefined
      }
      return new Response('Expected a WebSocket', { status: 426 })
    }
    if (pathname === '/api/config') return Response.json({ domain: DOMAIN })
    if (pathname === '/api/tools/picked') return pickTools(request)
    if (pathname === '/api/tools/profile') return chooseProfile(request)
    if (pathname === '/api/tools/variables') return saveVariables(request)
    if (pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 })
    }
    const file = staticFile(pathname)
    if (file) {
      return new Response(file, {
        headers: pathname.startsWith('/assets/')
          ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
          : {},
      })
    }
    // A missing file of the app is an error, not a page of it
    if (pathname.startsWith('/assets/')) {
      return new Response('Not found', { status: 404 })
    }
    return new Response(app, { headers: { 'Cache-Control': 'no-cache' } })
  },
  websocket: {
    // A terminal stays open while a long task prints nothing
    idleTimeout: 0,
    open: openTerminal,
    message(ws, message) {
      const text = String(message)
      const { upstream } = ws.data
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(text)
      else ws.data.queue.push(text)
    },
    close(ws) {
      ws.data.upstream?.close()
    },
  },
})

console.log(`dashboard listening on :${PORT}`)
