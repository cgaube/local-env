// Serves each source's docker/templates.json (a Portainer template list) to
// Dockhand: /<source>/templates.json -> volumes/sources/<source>/docker
// Stack templates whose compose file is in the source (docker/<folder>/<file>)
// are pointed at this server instead of the git repo. Other entries are
// passed through unchanged. A template without a `name` gets the compose
// `name:` as its default stack name.
//
// Compose files are served as template-compose.ts prepares them: relative
// build contexts pointed at the source's build-context repo, which this server
// also serves to Docker's builder (/<source>.git/...), and ${HOST_HOME} set to
// the Mac home folder. Each compose version served is
// saved in /snapshots/<source>/<folder>/<hash>.yml: `local-env update` uses it
// as the merge base, to apply later template changes to a stack without
// undoing the user's own edits. Same layout as
// src/providers/docker/template-link.ts.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { prepareTemplateCompose } from './template-compose.js'

const SOURCES_ROOT = '/sources'
const SNAPSHOTS_DIR = '/snapshots'
const BUILD_CONTEXTS_DIR = '/build-contexts'
// The Mac home folder, for ${HOST_HOME} in templates
const HOST_HOME = process.env.HOST_HOME ?? ''
// Where Docker's builder reaches this server, for template build folders
const BUILD_PORT = Number(process.env.BUILD_PORT ?? 17080)
const PORT = 8080
const BASE_URL = `http://catalog-server:${PORT}`
const COMPOSE_FILES = [
  // Docker's order of preference, for a folder with several
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
]

const resolveRoot = (source: string) =>
  /^[a-z0-9][a-z0-9-]*$/.test(source)
    ? join(SOURCES_ROOT, source, 'docker')
    : null

// The top-level `name:` of a compose file: local-env links deployed stacks to
// their template with it, so it also makes a good default stack name
const readComposeName = async (path: string) => {
  try {
    const parsed = Bun.YAML.parse(await Bun.file(path).text()) as {
      name?: unknown
    } | null
    return typeof parsed?.name === 'string' && !parsed.name.startsWith('${')
      ? parsed.name
      : null
  } catch {
    return null
  }
}

type Template = {
  type?: unknown
  title?: unknown
  name?: unknown
  repository?: { url?: unknown; stackfile?: unknown }
}

// docker/<folder>/<file> -> [folder, file] when the file is in the source
const localStackfile = async (root: string, stackfile: unknown) => {
  if (typeof stackfile !== 'string') return null
  const [docker, folder, file, ...rest] = stackfile.split('/')
  if (docker !== 'docker' || !folder || !file || rest.length > 0) return null
  if (folder.startsWith('.') || !COMPOSE_FILES.includes(file)) return null
  return (await Bun.file(join(root, folder, file)).exists())
    ? ([folder, file] as const)
    : null
}

const buildTemplates = async (root: string, source: string) => {
  const file = Bun.file(join(root, 'templates.json'))
  // A source may hold only ansible roles
  if (!(await file.exists())) return { version: '3', templates: [] }

  let list: { templates?: unknown }
  try {
    list = await file.json()
  } catch (error) {
    console.error(`Invalid ${source}/docker/templates.json:`, error)
    return { version: '3', templates: [] }
  }
  const entries = Array.isArray(list.templates) ? list.templates : []

  const templates = await Promise.all(
    entries.map(async (template: Template) => {
      const local =
        template.type === 3
          ? await localStackfile(root, template.repository?.stackfile)
          : null
      if (!local) return template
      const [folder, stackfile] = local
      const name =
        template.name ?? (await readComposeName(join(root, folder, stackfile)))
      return {
        ...template,
        ...(name ? { name } : {}),
        repository: {
          url: `${BASE_URL}/${source}`,
          stackfile: `${folder}/${stackfile}`,
        },
      }
    }),
  )
  return { ...list, templates }
}

const notFound = () => new Response('Not found', { status: 404 })

const hashTemplate = (content: string) =>
  createHash('sha256').update(content).digest('hex').slice(0, 12)

// docker/<folder>/<compose file>: served as Dockhand needs it, and kept as a
// snapshot
const serveCompose = async (path: string, source: string, folder: string) => {
  const content = prepareTemplateCompose(await Bun.file(path).text(), {
    source,
    folder,
    buildPort: BUILD_PORT,
    hostHome: HOST_HOME,
  })
  const snapshot = Bun.file(
    join(SNAPSHOTS_DIR, source, folder, `${hashTemplate(content)}.yml`),
  )
  if (!(await snapshot.exists())) await Bun.write(snapshot, content)
  return new Response(content, { headers: { 'Content-Type': 'text/yaml' } })
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

// /: what this server serves, to check what Dockhand gets. Not a catalog:
// Dockhand is where templates are browsed and deployed.
const serveIndex = async () => {
  const sources = existsSync(SOURCES_ROOT)
    ? readdirSync(SOURCES_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && resolveRoot(entry.name))
        .map((entry) => entry.name)
        .sort()
    : []

  const sections = await Promise.all(
    sources.map(async (source) => {
      const { templates } = await buildTemplates(resolveRoot(source)!, source)
      const items = (templates as Template[]).map((template) => {
        const title = escapeHtml(String(template.title ?? template.name ?? '?'))
        const { url, stackfile } = template.repository ?? {}
        const local = url === `${BASE_URL}/${source}`
        const href = local
          ? `/${source}/${stackfile}`
          : typeof url === 'string' && /^https?:/.test(url)
            ? url
            : null
        const label = escapeHtml(String(stackfile ?? 'container template'))
        return href
          ? `<li>${title}: <a href="${escapeHtml(href)}">${label}</a>${local ? '' : ' (elsewhere)'}</li>`
          : `<li>${title}: ${label}</li>`
      })
      return `<h2>${escapeHtml(source)}</h2>
<p><a href="/${source}/templates.json">templates.json</a> · ${templates.length} template(s)</p>
<ul>${items.join('')}</ul>`
    }),
  )

  return new Response(
    `<!doctype html><meta charset="utf-8"><title>catalog-server</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px}a{color:#0b6e99}h2{margin-bottom:0}</style>
<h1>catalog-server</h1>
<p>The template lists and compose files Dockhand gets from local-env. Compose files are shown as Dockhand receives them, with build folders pointed at this server.</p>
${sections.join('') || '<p>No sources. Add one with <code>local-env sources add &lt;repo&gt;</code>.</p>'}`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

// What git's plain HTTP protocol reads: nothing else of the repo is served
const GIT_FILE =
  /^(HEAD|info\/refs|objects\/info\/(packs|alternates|http-alternates)|objects\/[0-9a-f]{2}\/[0-9a-f]{38}|objects\/pack\/pack-[0-9a-f]{40}\.(pack|idx))$/

// /<source>.git/<file> -> the source's build-context repo
const serveGit = async (source: string, file: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(source) || !GIT_FILE.test(file)) {
    return notFound()
  }
  const path = Bun.file(join(BUILD_CONTEXTS_DIR, `${source}.git`, file))
  return (await path.exists()) ? new Response(path) : notFound()
}

Bun.serve({
  port: PORT,
  fetch: async (request) => {
    let segments: string[]
    try {
      segments = decodeURIComponent(new URL(request.url).pathname)
        .split('/')
        .filter(Boolean)
    } catch {
      return notFound()
    }

    // Blocks ".." traversal and hidden files such as .git/config
    if (segments.some((segment) => segment.startsWith('.'))) return notFound()

    if (segments.length === 0) return serveIndex()
    const [source, ...rest] = segments
    if (source?.endsWith('.git')) {
      return serveGit(source.slice(0, -'.git'.length), rest.join('/'))
    }
    const root = source ? resolveRoot(source) : null
    if (!root || rest.length === 0) return notFound()

    try {
      if (rest.length === 1 && rest[0] === 'templates.json') {
        return Response.json(await buildTemplates(root, source))
      }

      const path = join(root, ...rest)
      const file = Bun.file(path)
      if (!(await file.exists())) return notFound()
      const [folder, name] = rest
      if (rest.length === 2 && COMPOSE_FILES.includes(name!)) {
        return serveCompose(path, source, folder!)
      }
      return new Response(file)
    } catch {
      return notFound()
    }
  },
})

console.log(`Serving templates on ${BASE_URL}/<source>/templates.json`)
