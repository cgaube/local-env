// The tools catalog: the Ansible roles of every source, the ones picked in the
// dashboard and the ones `local-env install` installed. Shared by the
// dashboard (server.ts) and the CLI, which see the same folders:
//   <sources>/<source>/ansible/<collection>/roles/<role>/
//                                       -> the roles of a collection, named
//                                          <namespace>.<collection>.<role>
//   <sources>/<source>/ansible/<role>/  -> a plain role, named <role>
//   <tools>/picked.json                 -> the picked roles, by id:
//                                          written by the dashboard, read by
//                                          `local-env install`
//   <tools>/installed.json              -> what the last installs ran,
//                                          written by the CLI
//   <tools>/profile.json                -> the profile: written by the
//                                          dashboard and `local-env install`
//   <tools>/stacks.json                 -> the stacks `local-env install`
//                                          deployed for the roles
//   <tools>/variables.json              -> the values of the roles' inputs
//                                          (meta/argument_specs.yml), by
//                                          name: written by the dashboard
//                                          and `local-env install`
//   <tools>/collections/                -> the Galaxy collections
//                                          `local-env install` installed
// A role's id is <source>/<name>, so two sources can have a role of the same
// name.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import {
  type GalaxyRole,
  type GraphRole,
  isInputValue,
  type RoleInput,
  titleize,
  wantedInputs,
} from './role-graph.js'

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
  // The collections its collection needs that no source has (galaxy.yml
  // `dependencies`), by name or URL: their version ranges, `*` for any.
  // `local-env install` installs them from Galaxy.
  galaxy: Record<string, string>
  // The values it takes: meta/argument_specs.yml, entry point `main`
  inputs: RoleInput[]
  // The logins of the source manifests it needs (local-env.yml), as written:
  // <login>, or <source>/<login>. For a role that runs the vendor's CLI.
  logins: string[]
  // The secrets it reads (local-env.yml), by name, as written: the CLI checks
  // each entry (apps/cli/src/logins/secrets.ts)
  secrets: Record<string, unknown>
}

export type InstalledRole = {
  revision: string
  installedAt: string
  // The values of its inputs the install passed (roleValues): a change
  // makes it changed. Absent before inputs existed: none.
  values?: Record<string, unknown>
}
export type Installed = Record<string, InstalledRole>

export const PICKED_FILE = 'picked.json'
export const INSTALLED_FILE = 'installed.json'
export const PROFILE_FILE = 'profile.json'
export const STACKS_FILE = 'stacks.json'
export const VARIABLES_FILE = 'variables.json'
// Where `local-env install` installs the Galaxy collections, in the tools
// folder
export const GALAXY_FOLDER = 'collections'
// Beside meta/: what local-env reads of a role that Ansible doesn't
export const ROLE_SETTINGS_FILE = 'local-env.yml'

export const PROFILE_TAG = 'profile'

// <source>/<name>
const ROLE_ID = /^[a-z0-9][a-z0-9-]*\/[^/.][^/]*$/
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

// A login a role names: <login>, or <source>/<login>
const LOGIN_REF = /^(?:[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9-]*$/

// What local-env.yml says: its label, its stacks as <source>/<folder>, the
// logins it needs and its secrets. A stack that names no folder (a path, not
// a string), or a login that is not a name, is left out.
const readSettings = (dir: string, source: string) => {
  const settings = readYaml(join(dir, ROLE_SETTINGS_FILE)) as {
    label?: unknown
    stacks?: unknown
    logins?: unknown
    secrets?: unknown
  } | null
  const label =
    typeof settings?.label === 'string' && settings.label.trim()
      ? settings.label.trim()
      : null
  const stacks = Array.isArray(settings?.stacks) ? settings.stacks : []
  const logins = Array.isArray(settings?.logins) ? settings.logins : []
  const secrets = settings?.secrets
  return {
    label,
    secrets:
      typeof secrets === 'object' && secrets !== null && !Array.isArray(secrets)
        ? (secrets as Record<string, unknown>)
        : {},
    logins: [
      ...new Set(
        logins.filter(
          (entry): entry is string =>
            typeof entry === 'string' && LOGIN_REF.test(entry),
        ),
      ),
    ],
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

// A collection of the source: its folder in ansible/, its full name,
// <namespace>.<name>, and the collections it needs, from galaxy.yml
export type Collection = {
  folder: string
  name: string
  // By name, or a git URL or a path, as Ansible allows: a version range
  dependencies: Record<string, string>
}

// galaxy.yml `dependencies`: a map of collections to version ranges. An entry
// that isn't one is left out.
const readGalaxyDependencies = (value: unknown): Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([name, version]) =>
          typeof version === 'string' || typeof version === 'number'
            ? [[name, String(version)]]
            : version === null
              ? [[name, '*']]
              : [],
        ),
      )
    : {}

// The folder holds a galaxy.yml: a collection, with its roles in roles/.
// One without a valid namespace and name is left out, as Ansible can't load
// it.
const readCollection = (ansibleDir: string, folder: string) => {
  const path = join(ansibleDir, folder, 'galaxy.yml')
  if (!existsSync(path)) return undefined
  const galaxy = readYaml(path) as {
    namespace?: unknown
    name?: unknown
    dependencies?: unknown
  } | null
  const { namespace, name } = galaxy ?? {}
  return typeof namespace === 'string' &&
    typeof name === 'string' &&
    COLLECTION_PART.test(namespace) &&
    COLLECTION_PART.test(name)
    ? {
        folder,
        name: `${namespace}.${name}`,
        dependencies: readGalaxyDependencies(galaxy?.dependencies),
      }
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
  // galaxy.yml `dependencies` of its collection
  collectionDependencies: Record<string, string>
}

export const listRoleFolders = (ansibleDir: string): RoleFolder[] =>
  subfolders(ansibleDir).flatMap((folder): RoleFolder[] => {
    const collection = readCollection(ansibleDir, folder)
    if (collection === undefined) {
      return [
        { folder, name: folder, collection: null, collectionDependencies: {} },
      ]
    }
    if (collection === null) return []
    return subfolders(join(ansibleDir, folder, 'roles')).map((role) => ({
      folder: `${folder}/roles/${role}`,
      name: `${collection.name}.${role}`,
      collection: collection.name,
      collectionDependencies: collection.dependencies,
    }))
  })

// What local-env reads of a role's folder that Ansible would run: whether a
// task uses sudo, the roles it depends on (meta/main.yml) and its inputs
// (meta/argument_specs.yml). For the roles of Galaxy collections too,
// installed by `local-env install`.
export const readRoleDir = (dir: string) => {
  const meta = readMeta(dir)
  return {
    needsSudo: listFiles(dir).some(
      (file) =>
        /\.ya?ml$/.test(file) && BECOME.test(readFileSync(file, 'utf8')),
    ),
    ...readDependencyEntries(meta),
    inputs: readInputs(dir, meta),
  }
}

type Meta = {
  galaxy_info?: { description?: unknown; galaxy_tags?: unknown }
  dependencies?: unknown
  argument_specs?: unknown
}

// A name Ansible accepts for a variable
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// The variables of the role's defaults/main.yml: a value there is a default
// too, which Ansible accepts for a required option
const readRoleDefaults = (dir: string): Record<string, unknown> => {
  const file = ['main.yml', 'main.yaml']
    .map((name) => join(dir, 'defaults', name))
    .find((path) => existsSync(path))
  const defaults = file ? readYaml(file) : null
  return isMap(defaults) ? defaults : {}
}

// One option of an entry point. Its description can be a list of lines. Its
// default is the spec's, else the value of the role's defaults/main.yml.
const readInput = (
  name: string,
  option: unknown,
  roleDefaults: Record<string, unknown>,
): RoleInput[] => {
  if (!VARIABLE.test(name) || !isMap(option)) return []
  const description = Array.isArray(option.description)
    ? option.description.filter((line) => typeof line === 'string').join(' ')
    : option.description
  const choices = Array.isArray(option.choices)
    ? option.choices.filter((choice): choice is string | number | boolean =>
        ['string', 'number', 'boolean'].includes(typeof choice),
      )
    : []
  // null is no default, as for Ansible
  const fallback =
    option.default !== undefined && option.default !== null
      ? option.default
      : roleDefaults[name]
  const hasDefault = fallback !== undefined && fallback !== null
  return [
    {
      name,
      type: typeof option.type === 'string' ? option.type : 'str',
      required: option.required === true && !hasDefault,
      ...(hasDefault ? { default: fallback } : {}),
      choices: choices.length > 0 ? choices : null,
      description:
        typeof description === 'string' && description.trim()
          ? description.trim()
          : null,
      secret: option.no_log === true,
    },
  ]
}

// The options of the `main` entry point: meta/argument_specs.yml, else the
// `argument_specs` of meta/main.yml, as Ansible reads them. None, or not
// valid: no inputs, and the role still installs.
const readInputs = (dir: string, meta: Meta): RoleInput[] => {
  const file = ['argument_specs.yml', 'argument_specs.yaml']
    .map((name) => join(dir, 'meta', name))
    .find((path) => existsSync(path))
  const specs = file
    ? (readYaml(file) as { argument_specs?: unknown } | null)?.argument_specs
    : meta.argument_specs
  const main = isMap(specs) ? specs.main : null
  const options = isMap(main) ? main.options : null
  if (!isMap(options)) return []
  const roleDefaults = readRoleDefaults(dir)
  return Object.entries(options).flatMap(([name, option]) =>
    readInput(name, option, roleDefaults),
  )
}

// Galaxy's own fields, so roles stay plain Ansible roles
const readMeta = (dir: string): Meta => {
  const parsed = readYaml(join(dir, 'meta/main.yml'))
  // No meta/main.yml, or not valid YAML: the role still installs
  return typeof parsed === 'object' && parsed !== null ? parsed : {}
}

// The keys of a dependency entry that are not variables it passes: the
// others are role parameters, as `vars:` is
const DEPENDENCY_KEYWORDS = new Set([
  'role',
  'name',
  'src',
  'scm',
  'version',
  'vars',
  'when',
  'tags',
  'become',
  'become_user',
  'become_method',
  'become_flags',
  'ignore_errors',
  'delegate_to',
  'environment',
  'connection',
  'no_log',
  'run_once',
  'apply',
  'public',
  'allow_duplicates',
])

// The roles it depends on, by name, and the variables it passes to each
// (`vars:` of the entry, or its role parameters) with their values as
// written, in the same order
const readDependencyEntries = (meta: Meta) => {
  const entries = (
    Array.isArray(meta.dependencies) ? meta.dependencies : []
  ).flatMap((dependency: unknown) => {
    if (typeof dependency === 'string') return [{ name: dependency, vars: {} }]
    if (!isMap(dependency)) return []
    const name = dependency.role ?? dependency.name
    if (typeof name !== 'string') return []
    const vars = Object.fromEntries(
      [
        ...Object.entries(isMap(dependency.vars) ? dependency.vars : {}),
        ...Object.entries(dependency).filter(
          ([key]) => !DEPENDENCY_KEYWORDS.has(key),
        ),
      ].filter(([key]) => VARIABLE.test(key)),
    )
    return [{ name, vars }]
  })
  return {
    dependencies: entries.map(({ name }) => name),
    dependencyVars: entries.map(({ vars }) => vars),
  }
}

// A JSON of the map, by key: the same map gives the same text
const sortedJson = (map: Record<string, string>) =>
  JSON.stringify(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))

const readRole = (
  sourcesDir: string,
  source: string,
  { folder, name, collection, collectionDependencies }: RoleFolder,
  provided: Set<string>,
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
  // A new range of a collection it needs installs it again
  hasher.update(sortedJson(collectionDependencies))

  const meta = readMeta(dir)
  const info = meta.galaxy_info ?? {}
  const tags = (Array.isArray(info.galaxy_tags) ? info.galaxy_tags : []).filter(
    (tag): tag is string => typeof tag === 'string',
  )
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
    ...readDependencyEntries(meta),
    stacks: settings.stacks,
    logins: settings.logins,
    secrets: settings.secrets,
    revision: hasher.digest('hex').slice(0, 12),
    needsSudo,
    // A collection of a source is linked, not installed: ansible-galaxy
    // would look for it on Galaxy and fail
    galaxy: Object.fromEntries(
      Object.entries(collectionDependencies).filter(
        ([dependency]) => !provided.has(dependency),
      ),
    ),
    // Its file is one of the files above: a change is a new revision
    inputs: readInputs(dir, meta),
  }
}

// The roles of the Galaxy collections that `local-env install` installed
// (<tools>/collections/ansible_collections/<namespace>/<name>/roles/<role>):
// their dependencies, by full name, and their inputs
export const listGalaxyRoles = (collectionsDir: string): GalaxyRole[] => {
  const root = join(collectionsDir, 'ansible_collections')
  return subfolders(root).flatMap((namespace) =>
    subfolders(join(root, namespace)).flatMap((collection) =>
      subfolders(join(root, namespace, collection, 'roles')).map((role) => {
        const dir = join(root, namespace, collection, 'roles', role)
        const meta = readMeta(dir)
        const { dependencies, dependencyVars } = readDependencyEntries(meta)
        return {
          name: `${namespace}.${collection}.${role}`,
          // A short name is a role of the same collection
          dependencies: dependencies.map((dependency) =>
            dependency.includes('.')
              ? dependency
              : `${namespace}.${collection}.${dependency}`,
          ),
          dependencyVars,
          inputs: readInputs(dir, meta),
        }
      }),
    ),
  )
}

// The roles of every source, by source then folder
export const listRoles = (sourcesDir: string): Role[] => {
  const sources = subfolders(sourcesDir)
  const provided = new Set(
    sources.flatMap((source) =>
      listCollections(join(sourcesDir, source, 'ansible')).map(
        ({ name }) => name,
      ),
    ),
  )
  return sources.flatMap((source) =>
    listRoleFolders(join(sourcesDir, source, 'ansible')).map((role) =>
      readRole(sourcesDir, source, role, provided),
    ),
  )
}

// The ids of the picked roles. One gone from the sources stays, so it can be
// unpicked; one that is no id (edited by hand) is left out.
export const readSelection = (toolsDir: string): string[] => {
  try {
    const { picked } = JSON.parse(
      readFileSync(join(toolsDir, PICKED_FILE), 'utf8'),
    )
    return Array.isArray(picked)
      ? [
          ...new Set(
            picked.filter(
              (id): id is string => typeof id === 'string' && ROLE_ID.test(id),
            ),
          ),
        ]
      : []
  } catch {
    return []
  }
}

// A playbook that runs these roles, by name or path, on this Mac
export const playbookOf = (paths: string[]) => {
  const roles = paths.map((path) => `    - role: ${path}\n`).join('')
  return [
    '- name: local-env tools',
    '  hosts: localhost',
    '  connection: local',
    `  roles:${roles ? `\n${roles}` : ' []\n'}`,
  ].join('\n')
}

export const writeSelection = (toolsDir: string, ids: string[]) =>
  writeFileSync(
    join(toolsDir, PICKED_FILE),
    `${JSON.stringify({ picked: [...new Set(ids)] }, null, 2)}\n`,
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

// The values of the inputs, by variable name. A name Ansible would refuse,
// or a null, is left out.
export const readVariables = (toolsDir: string): Record<string, unknown> => {
  try {
    const variables: unknown = JSON.parse(
      readFileSync(join(toolsDir, VARIABLES_FILE), 'utf8'),
    )
    return isMap(variables)
      ? Object.fromEntries(
          Object.entries(variables).filter(
            ([name, value]) => VARIABLE.test(name) && value !== null,
          ),
        )
      : {}
  } catch {
    return {}
  }
}

// What the dashboard may change in the values: by name, a value of an input
// of a role of the catalog or of an installed Galaxy role, of its type, and
// no secret (no_log); one the file holds already, unchanged (its role left
// the sources); or null, which removes it. A name left out stays as it is.
export const isVariablesChange = (
  roles: Role[],
  galaxyRoles: GalaxyRole[],
  saved: Record<string, unknown>,
  value: unknown,
): value is Record<string, unknown> => {
  if (!isMap(value)) return false
  const inputs = new Map(
    wantedInputs(
      roles,
      roles.map(({ id }) => id),
      galaxyRoles,
    ).map((input) => [input.name, input]),
  )
  return Object.entries(value).every(([name, variable]) => {
    if (variable === null) return VARIABLE.test(name)
    const input = inputs.get(name)
    if (!input) return name in saved && Bun.deepEquals(saved[name], variable)
    return !input.secret && isInputValue(input, variable)
  })
}

// The values with a change applied: null removes a name
export const applyVariablesChange = (
  saved: Record<string, unknown>,
  change: Record<string, unknown>,
) =>
  Object.fromEntries(
    Object.entries({ ...saved, ...change }).filter(
      ([, value]) => value !== null,
    ),
  )

// By name, so the file reads the same after each save
export const writeVariables = (
  toolsDir: string,
  variables: Record<string, unknown>,
) =>
  writeFileSync(
    join(toolsDir, VARIABLES_FILE),
    `${JSON.stringify(
      Object.fromEntries(
        Object.entries(variables).sort(([a], [b]) => a.localeCompare(b)),
      ),
      null,
      2,
    )}\n`,
  )
