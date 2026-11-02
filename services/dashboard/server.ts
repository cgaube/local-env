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
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { join, normalize } from 'node:path'

const ROUTES_FILE = '/routes/routes.json'
const SERVICES_FILE = '/routes/services.json'
const SOURCES_DIR = '/sources'
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
        ansible: subfolders(join(dir, 'ansible')).length,
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

const readers = {
  routes: () => readList(ROUTES_FILE),
  services: () => readList(SERVICES_FILE),
  sources: async () => JSON.stringify(listSources()),
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
watch(SOURCES_DIR, { recursive: true }, () => publish('sources'))

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

const PUBLIC_DIR = join(import.meta.dir, 'public')
const app = Bun.file(join(PUBLIC_DIR, 'index.html'))

// A file of the built app, never one outside public/
const staticFile = (pathname: string) => {
  const path = normalize(join(PUBLIC_DIR, pathname))
  if (!path.startsWith(`${PUBLIC_DIR}/`)) return null
  return existsSync(path) && statSync(path).isFile() ? Bun.file(path) : null
}

Bun.serve({
  port: PORT,
  // Event streams stay open with nothing to send
  idleTimeout: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/events') return events()
    if (pathname === '/api/config') return Response.json({ domain: DOMAIN })
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
})

console.log(`dashboard listening on :${PORT}`)
