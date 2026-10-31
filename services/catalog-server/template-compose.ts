// How a template's compose file is changed before Dockhand gets it. Shared by
// catalog-server and the CLI, which must change template versions the same way
// to compare them with deployed stacks.
//
// 1. Build contexts. Dockhand only downloads the compose file, so a relative
// `build:` would point at nothing.
// The compose file served to Dockhand points each relative build context at
// the source's build-context repo instead, which catalog-server serves to
// Docker's builder:
//
//   build: ./site
//   -> build: http://host.docker.internal:<port>/acme.git#main:docker/hello/site
//
// The builder runs outside the local-env network, so it reaches catalog-server
// through a port on the host: `buildPort` in config.json, 17080 by default. The build-context repo (volumes/build-contexts/
// <source>.git) holds the source's current files as a single commit: the
// clones are shallow, and git's plain HTTP protocol needs every parent.
//
// 2. ${HOST_HOME}: the Mac home folder, for files mounted from the Mac.
// Compose runs inside Dockhand, where ~ is /home/dockhand, and Dockhand gives
// compose only each stack's own variables:
//
//   - ${HOST_HOME}/dev/app.ini:/etc/app.ini -> - /Users/me/dev/app.ini:...
//
// Outside local-env, HOST_HOME is an ordinary variable to set.
import { join, normalize } from 'node:path'

export const BUILD_CONTEXTS_BRANCH = 'main'

type ComposeBuild = string | { context?: unknown }

// Relative paths only: absolute paths and URLs (git, http) are left alone
const isRelative = (path: string) =>
  !path.startsWith('/') &&
  !path.startsWith('~') &&
  !/^[a-z][a-z0-9+.-]*:/i.test(path)

// The relative build contexts of a compose file, as written
export const findBuildContexts = (compose: string) => {
  let services: Record<string, { build?: ComposeBuild }> | undefined
  try {
    const parsed = Bun.YAML.parse(compose) as {
      services?: typeof services
    } | null
    services = parsed?.services
  } catch {
    return []
  }
  const contexts = new Set<string>()
  for (const service of Object.values(services ?? {})) {
    const build = service?.build
    if (build === undefined || build === null) continue
    // A build object without a context can't be rewritten: there is no line
    // to change
    const context = typeof build === 'string' ? build : build.context
    if (typeof context === 'string' && isRelative(context)) {
      contexts.add(context)
    }
  }
  return [...contexts]
}

// docker/<folder> + "./site" -> "docker/<folder>/site", or null when the
// path leaves the repo
export const contextPath = (folder: string, context: string) => {
  const path = normalize(join('docker', folder, context))
  return path === '..' || path.startsWith('../') ? null : path
}

// `build: ./site` and `context: ./site` lines -> the git URL. Only the value
// changes, so comments and layout survive and the update merge stays line
// based.
export const rewriteBuildContexts = (
  compose: string,
  {
    source,
    folder,
    buildPort,
  }: { source: string; folder: string; buildPort: number },
) => {
  const contexts = new Set(findBuildContexts(compose))
  if (contexts.size === 0) return compose

  const line =
    /^(\s*(?:-\s+)?(?:build|context):\s*)(['"]?)([^'"\s#]+)\2(\s*(?:#.*)?)$/
  const lines = compose.split('\n').map((text) => {
    const match = line.exec(text)
    const value = match?.[3]
    if (!match || !value || !contexts.has(value)) return text
    const path = contextPath(folder, value)
    if (!path) return text
    const url = `http://host.docker.internal:${buildPort}/${source}.git#${BUILD_CONTEXTS_BRANCH}:${path}`
    return `${match[1]}${url}${match[4]}`
  })
  return lines.join('\n')
}

// ${HOST_HOME}, $HOST_HOME and ${HOST_HOME:-...} -> the Mac home folder
const HOST_HOME = /\$\{HOST_HOME(?::?[-?][^}]*)?\}|\$HOST_HOME\b/g

export const replaceHostHome = (compose: string, hostHome: string) =>
  hostHome ? compose.replace(HOST_HOME, hostHome) : compose

// The compose file of docker/<folder> in a source, as Dockhand gets it
export const prepareTemplateCompose = (
  compose: string,
  options: {
    source: string
    folder: string
    buildPort: number
    hostHome: string
  },
) => replaceHostHome(rewriteBuildContexts(compose, options), options.hostHome)
