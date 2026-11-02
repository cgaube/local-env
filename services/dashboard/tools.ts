// The tools catalog: the Ansible roles of every source, the ones picked in the
// dashboard and the ones `local-env install` installed. Shared by the
// dashboard (server.ts) and the CLI, which see the same folders:
//   <sources>/<source>/ansible/<role>/  -> the roles
//   <tools>/playbook.yml                -> the picked roles, a plain playbook:
//                                          written by the dashboard, run by
//                                          `local-env install`
//   <tools>/installed.json              -> what the last installs ran,
//                                          written by the CLI
// The playbook names each role by its path, ../sources/<source>/ansible/<role>,
// so two sources can have a role of the same name.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export type Role = {
  // <source>/<role>
  id: string
  source: string
  name: string
  description: string | null
  tags: string[]
  // Roles it needs (meta/main.yml), by name
  dependencies: string[]
  // Hash of the role's files: a change means installing it again
  revision: string
  // A task runs with sudo: the install asks for your password
  needsSudo: boolean
}

export type InstalledRole = { revision: string; installedAt: string }
export type Installed = Record<string, InstalledRole>

export const PLAYBOOK_FILE = 'playbook.yml'
export const INSTALLED_FILE = 'installed.json'

const ROLE_PATH = /^\.\.\/sources\/([a-z0-9][a-z0-9-]*)\/ansible\/([^/]+)$/

const subfolders = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort()
    : []

// Every file of the folder, sorted, without dot files (.git, .DS_Store)
const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return listFiles(path)
      return entry.isFile() ? [path] : []
    })

const BECOME = /^\s*become:\s*(true|yes)\s*$/m

const readRole = (sourcesDir: string, source: string, name: string): Role => {
  const dir = join(sourcesDir, source, 'ansible', name)
  const files = listFiles(dir)
  const hasher = new Bun.CryptoHasher('sha256')
  let needsSudo = false
  for (const file of files) {
    const content = readFileSync(file)
    hasher.update(relative(dir, file))
    hasher.update(content)
    if (/\.ya?ml$/.test(file) && BECOME.test(content.toString())) {
      needsSudo = true
    }
  }

  // Galaxy's own fields, so roles stay plain Ansible roles
  let meta: {
    galaxy_info?: { description?: unknown; galaxy_tags?: unknown }
    dependencies?: unknown
  } = {}
  try {
    const parsed = Bun.YAML.parse(
      readFileSync(join(dir, 'meta/main.yml'), 'utf8'),
    )
    if (typeof parsed === 'object' && parsed !== null) meta = parsed
  } catch {
    // No meta/main.yml, or not valid YAML: the role still installs
  }
  const info = meta.galaxy_info ?? {}
  const tags = Array.isArray(info.galaxy_tags) ? info.galaxy_tags : []
  const dependencies = Array.isArray(meta.dependencies) ? meta.dependencies : []

  return {
    id: `${source}/${name}`,
    source,
    name,
    description:
      typeof info.description === 'string' ? info.description.trim() : null,
    tags: tags.filter((tag): tag is string => typeof tag === 'string'),
    dependencies: dependencies.flatMap((dependency) => {
      const role =
        typeof dependency === 'string' ? dependency : dependency?.role
      return typeof role === 'string' ? [role] : []
    }),
    revision: hasher.digest('hex').slice(0, 12),
    needsSudo,
  }
}

// The roles of every source, by source then name
export const listRoles = (sourcesDir: string): Role[] =>
  subfolders(sourcesDir).flatMap((source) =>
    subfolders(join(sourcesDir, source, 'ansible')).map((name) =>
      readRole(sourcesDir, source, name),
    ),
  )

// The playbook's path to a role, from the tools folder
export const rolePath = (id: string) => {
  const [source, name] = id.split('/')
  return `../sources/${source}/ansible/${name}`
}

// The ids of the roles in the playbook. One that isn't ours (edited by hand)
// is left out.
export const readSelection = (toolsDir: string): string[] => {
  try {
    const plays = Bun.YAML.parse(
      readFileSync(join(toolsDir, PLAYBOOK_FILE), 'utf8'),
    )
    if (!Array.isArray(plays)) return []
    return plays.flatMap((play) =>
      Array.isArray(play?.roles)
        ? play.roles.flatMap((entry: unknown) => {
            const path =
              typeof entry === 'string'
                ? entry
                : (entry as { role?: unknown } | null)?.role
            const match = typeof path === 'string' ? ROLE_PATH.exec(path) : null
            return match ? [`${match[1]}/${match[2]}`] : []
          })
        : [],
    )
  } catch {
    return []
  }
}

export const writeSelection = (toolsDir: string, ids: string[]) => {
  const roles = ids.map((id) => `    - role: ${rolePath(id)}\n`).join('')
  writeFileSync(
    join(toolsDir, PLAYBOOK_FILE),
    [
      '# The tools picked in the local-env dashboard (Tools), which',
      '# rewrites this file. `local-env install` runs it.',
      '- name: local-env tools',
      '  hosts: localhost',
      '  connection: local',
      `  roles:${roles ? `\n${roles}` : ' []\n'}`,
    ].join('\n'),
  )
}

export const readInstalled = (toolsDir: string): Installed => {
  try {
    const installed = JSON.parse(
      readFileSync(join(toolsDir, INSTALLED_FILE), 'utf8'),
    )
    return typeof installed === 'object' && installed !== null ? installed : {}
  } catch {
    return {}
  }
}

export const writeInstalled = (toolsDir: string, installed: Installed) =>
  writeFileSync(
    join(toolsDir, INSTALLED_FILE),
    `${JSON.stringify(installed, null, 2)}\n`,
  )
