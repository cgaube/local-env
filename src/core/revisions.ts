import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { COMPOSE_FILE, HOME_DIR } from './paths.js'

// A core service is recreated when its code changes. Each services/<folder>
// gets a hash of its files, passed to compose as LOCAL_ENV_REVISION_<FOLDER>
// and set as the service's `local-env.revision` label in compose.yaml:
// a different label makes `compose up` recreate the container.

const SERVICES_DIR = join(HOME_DIR, 'services')
// Runtime state kept next to the code, not part of it
const IGNORED = new Set(['certs'])

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED.has(entry.name) || entry.name.startsWith('.')) return []
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })

const hashFolder = (dir: string) => {
  const hash = createHash('sha256')
  for (const file of listFiles(dir).sort()) {
    hash.update(relative(dir, file))
    hash.update(readFileSync(file))
  }
  return hash.digest('hex').slice(0, 12)
}

export const revisionVariable = (folder: string) =>
  `LOCAL_ENV_REVISION_${folder.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

// { LOCAL_ENV_REVISION_PROXY: "3f2a…", … } for every services/<folder>
export const readRevisions = (): Record<string, string> => {
  let folders: string[]
  try {
    folders = readdirSync(SERVICES_DIR).filter((name) =>
      statSync(join(SERVICES_DIR, name)).isDirectory(),
    )
  } catch {
    return {}
  }
  return Object.fromEntries(
    folders.map((folder) => [
      revisionVariable(folder),
      hashFolder(join(SERVICES_DIR, folder)),
    ]),
  )
}

// Core services built from services/<folder>, by compose service name
export const listBuiltServices = () => {
  try {
    const compose = Bun.YAML.parse(readFileSync(COMPOSE_FILE, 'utf8')) as {
      services?: Record<string, { build?: unknown }>
    }
    return Object.entries(compose.services ?? {}).flatMap(([name, service]) => {
      const build = service.build
      const context =
        typeof build === 'string'
          ? build
          : (build as { context?: unknown } | undefined)?.context
      const folder =
        typeof context === 'string'
          ? /^(?:\.\/)?services\/([^/]+)\/?$/.exec(context)?.[1]
          : undefined
      return folder ? [{ service: name, folder }] : []
    })
  } catch {
    return []
  }
}
