// The tools catalog: the Ansible roles of every source, the ones picked in the
// dashboard and the ones `local-env install` installed. Shared by the
// dashboard (server.ts) and the CLI, which see the same folders:
//   <sources>/<source>/ansible/<collection>/roles/<role>/
//                                       -> the roles of a collection, named
//                                          <namespace>.<collection>.<role>
//   <sources>/<source>/ansible/<role>/  -> a plain role, named <role>
//   <tools>/playbook.yml                -> the picked roles, a plain playbook:
//                                          written by the dashboard, run by
//                                          `local-env install`
//   <tools>/installed.json              -> what the last installs ran,
//                                          written by the CLI
//   <tools>/profile.json                -> the profile: written by the
//                                          dashboard and `local-env install`
//   <tools>/stacks.json                 -> the stacks `local-env install`
//                                          deployed for the roles
// The playbook names each role by its path, ../sources/<source>/ansible/<folder>,
// so two sources can have a role of the same name.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { type GraphRole, titleize } from './role-graph.js'

export type Role = GraphRole & {
  source: string
  // Its folder in the source's ansible/: <collection>/roles/<role>, or
  // <role>
  folder: string
  // The name to show: `label` of local-env.yml, else the role's folder,
  // title-cased
  label: string
  description: string | null
  tags: string[]
  // Tagged `profile` (galaxy_tags): a set of roles, picked as a whole
  isProfile: boolean
  // Hash of the role's files: a change means installing it again
  revision: string
  // A task runs with sudo: the install asks for your password
  needsSudo: boolean
}

export type InstalledRole = { revision: string; installedAt: string }
export type Installed = Record<string, InstalledRole>

export const PLAYBOOK_FILE = 'playbook.yml'
export const INSTALLED_FILE = 'installed.json'
export const PROFILE_FILE = 'profile.json'
export const STACKS_FILE = 'stacks.json'
// Beside meta/: what local-env reads of a role that Ansible doesn't
export const ROLE_SETTINGS_FILE = 'local-env.yml'

export const PROFILE_TAG = 'profile'

const ROLE_ID = /^[a-z0-9][a-z0-9-]*\/[^/.][^/]*$/
// ../sources/<source>/ansible/<role> or <collection>/roles/<role>
const ROLE_PATH =
  /^\.\.\/sources\/([a-z0-9][a-z0-9-]*)\/ansible\/((?:[^/.][^/]*\/roles\/)?[^/.][^/]*)$/
// A collection's namespace and name (galaxy.yml): Ansible allows only these
const COLLECTION_PART = /^[a-z0-9_]+$/

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

// A stack template: docker/<folder> of the role's source, or <source>/<folder>
const STACK = /^(?:([a-z0-9][a-z0-9-]*)\/)?([a-z0-9][a-z0-9._-]*)$/i

const readYaml = (path: string): unknown => {
  try {
    return Bun.YAML.parse(readFileSync(path, 'utf8'))
  } catch {
    // None, or not valid YAML
    return null
  }
}

// What local-env.yml says: its label, and its stacks as <source>/<folder>. A
// stack that names no folder (a path, not a string) is left out.
const readSettings = (dir: string, source: string) => {
  const settings = readYaml(join(dir, ROLE_SETTINGS_FILE)) as {
    label?: unknown
    stacks?: unknown
  } | null
  const label =
    typeof settings?.label === 'string' && settings.label.trim()
      ? settings.label.trim()
      : null
  const stacks = Array.isArray(settings?.stacks) ? settings.stacks : []
  return {
    label,
    stacks: [
      ...new Set(
        stacks.flatMap((entry) => {
          const match = typeof entry === 'string' ? STACK.exec(entry) : null
          return match ? [`${match[1] ?? source}/${match[2]}`] : []
        }),
      ),
    ],
  }
}

// A collection of the source: its folder in ansible/ and its full name,
// <namespace>.<name>, from galaxy.yml
export type Collection = { folder: string; name: string }

// The folder holds a galaxy.yml: a collection, with its roles in roles/.
// One without a valid namespace and name is left out, as Ansible can't load
// it.
const readCollection = (ansibleDir: string, folder: string) => {
  const path = join(ansibleDir, folder, 'galaxy.yml')
  if (!existsSync(path)) return undefined
  const galaxy = readYaml(path) as {
    namespace?: unknown
    name?: unknown
  } | null
  const { namespace, name } = galaxy ?? {}
  return typeof namespace === 'string' &&
    typeof name === 'string' &&
    COLLECTION_PART.test(namespace) &&
    COLLECTION_PART.test(name)
    ? { folder, name: `${namespace}.${name}` }
    : null
}

// The collections of a source's ansible/ folder
export const listCollections = (ansibleDir: string): Collection[] =>
  subfolders(ansibleDir).flatMap(
    (folder) => readCollection(ansibleDir, folder) ?? [],
  )

// The roles of a source's ansible/ folder: those of each collection
// (<collection>/roles/<role>), named <namespace>.<collection>.<role>, and the
// plain roles (<role>), named by their folder
export type RoleFolder = {
  folder: string
  name: string
  collection: string | null
}

export const listRoleFolders = (ansibleDir: string): RoleFolder[] =>
  subfolders(ansibleDir).flatMap((folder): RoleFolder[] => {
    const collection = readCollection(ansibleDir, folder)
    if (collection === undefined) {
      return [{ folder, name: folder, collection: null }]
    }
    if (collection === null) return []
    return subfolders(join(ansibleDir, folder, 'roles')).map((role) => ({
      folder: `${folder}/roles/${role}`,
      name: `${collection.name}.${role}`,
      collection: collection.name,
    }))
  })

const readRole = (
  sourcesDir: string,
  source: string,
  { folder, name, collection }: RoleFolder,
): Role => {
  const dir = join(sourcesDir, source, 'ansible', folder)
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
  const tags = (Array.isArray(info.galaxy_tags) ? info.galaxy_tags : []).filter(
    (tag): tag is string => typeof tag === 'string',
  )
  const dependencies = Array.isArray(meta.dependencies) ? meta.dependencies : []
  const settings = readSettings(dir, source)

  return {
    id: `${source}/${name}`,
    source,
    folder,
    name,
    collection,
    label: settings.label ?? titleize(basename(folder)),
    description:
      typeof info.description === 'string' ? info.description.trim() : null,
    tags,
    isProfile: tags.includes(PROFILE_TAG),
    dependencies: dependencies.flatMap((dependency) => {
      const role =
        typeof dependency === 'string'
          ? dependency
          : (dependency?.role ?? dependency?.name)
      return typeof role === 'string' ? [role] : []
    }),
    stacks: settings.stacks,
    revision: hasher.digest('hex').slice(0, 12),
    needsSudo,
  }
}

// The roles of every source, by source then folder
export const listRoles = (sourcesDir: string): Role[] =>
  subfolders(sourcesDir).flatMap((source) =>
    listRoleFolders(join(sourcesDir, source, 'ansible')).map((role) =>
      readRole(sourcesDir, source, role),
    ),
  )

// The ids of the roles in the playbook, found by path in the catalog. One
// gone from the sources keeps its path as its id, <source>/<folder>, so it
// can be unpicked. One that isn't ours (edited by hand) is left out.
export const readSelection = (toolsDir: string, roles: Role[]): string[] => {
  const byPath = new Map(
    roles.map((role) => [`${role.source}/${role.folder}`, role.id]),
  )
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
            if (!match) return []
            const found = `${match[1]}/${match[2]}`
            return [byPath.get(found) ?? found]
          })
        : [],
    )
  } catch {
    return []
  }
}

// A playbook that runs these roles, named by path, on this Mac
export const playbookOf = (paths: string[]) => {
  const roles = paths.map((path) => `    - role: ${path}\n`).join('')
  return [
    '- name: local-env tools',
    '  hosts: localhost',
    '  connection: local',
    `  roles:${roles ? `\n${roles}` : ' []\n'}`,
  ].join('\n')
}

// The playbook's path to a role, from the tools folder. One gone from the
// sources has its path as its id (readSelection).
const selectionPath = (roles: Role[], id: string) => {
  const role = roles.find((other) => other.id === id)
  const [source, ...folder] = role ? [role.source, role.folder] : id.split('/')
  return `../sources/${source}/ansible/${folder.join('/')}`
}

export const writeSelection = (
  toolsDir: string,
  roles: Role[],
  ids: string[],
) =>
  writeFileSync(
    join(toolsDir, PLAYBOOK_FILE),
    [
      '# The tools picked in the local-env dashboard (Tools), which',
      '# rewrites this file. `local-env install` runs them, with your',
      '# profile (profile.json).',
      playbookOf(ids.map((id) => selectionPath(roles, id))),
    ].join('\n'),
  )

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

// The id of the profile, or null without one. Whether it is still in a
// source is for the reader to check.
export const readProfile = (toolsDir: string): string | null => {
  try {
    const { profile } = JSON.parse(
      readFileSync(join(toolsDir, PROFILE_FILE), 'utf8'),
    )
    return typeof profile === 'string' && ROLE_ID.test(profile) ? profile : null
  } catch {
    return null
  }
}

// What the dashboard may save as the profile: a profile of the catalog, or
// null for none
export const isProfileChoice = (
  roles: Role[],
  value: unknown,
): value is string | null =>
  value === null ||
  (typeof value === 'string' &&
    roles.some((role) => role.id === value && role.isProfile))

export const writeProfile = (toolsDir: string, profile: string | null) =>
  writeFileSync(
    join(toolsDir, PROFILE_FILE),
    `${JSON.stringify({ profile }, null, 2)}\n`,
  )

// A stack `local-env install` deployed because a role needs it, by template
// (<source>/<folder>). Deployed once: one the user removed since stays
// removed.
export type DeployedStack = {
  // The Dockhand stack
  stack: string
  // The role that needed it, by id
  by: string
  deployedAt: string
}

export const readDeployedStacks = (
  toolsDir: string,
): Record<string, DeployedStack> => {
  try {
    const stacks = JSON.parse(readFileSync(join(toolsDir, STACKS_FILE), 'utf8'))
    return typeof stacks === 'object' && stacks !== null ? stacks : {}
  } catch {
    return {}
  }
}

export const writeDeployedStacks = (
  toolsDir: string,
  stacks: Record<string, DeployedStack>,
) =>
  writeFileSync(
    join(toolsDir, STACKS_FILE),
    `${JSON.stringify(stacks, null, 2)}\n`,
  )
