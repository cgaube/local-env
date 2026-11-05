import { execa } from 'execa'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import type { ExternalRole } from '#services/dashboard/role-graph.js'
import { readRoleDir, type Role } from '#services/dashboard/tools.js'
import { HOME_DIR } from '#cli/core/paths.js'
import { spinner } from '@clack/prompts'
import { styleText } from 'node:util'
import { logger } from '#cli/utils/logger.js'

// The collections that the collections of the sources need (galaxy.yml
// `dependencies`), installed from Galaxy by `local-env install`. A lasting
// folder: each one downloads once, and stays until `local-env update`
// upgrades it.
export const GALAXY_DIR = resolve(HOME_DIR, 'volumes/tools/collections')

// local-env's only collections folder for Ansible, beside the links to the
// sources: not the user's own (~/.ansible/collections, their
// ANSIBLE_COLLECTIONS_PATH), so every Mac runs the same versions. Ansible
// still sees the collections of the ansible package, the same on every Mac
// with the same Ansible.

// A collection to install, with every range asked for it: the resolver of
// ansible-galaxy picks a version that meets them all
export type Requirement = {
  // <namespace>.<name>, or a git URL or a path
  name: string
  versions: string[]
  // The galaxy.yml files that ask for it, from the sources folder
  askedBy: string[]
}

// What the collections of the roles that run need, and no source has
export const galaxyRequirements = (run: Role[]): Requirement[] => {
  const requirements = new Map<string, Requirement>()
  for (const role of run) {
    if (!role.collection) continue
    const galaxyFile = join(
      role.source,
      'ansible',
      role.folder.split('/roles/')[0]!,
      'galaxy.yml',
    )
    for (const [name, version] of Object.entries(role.galaxy)) {
      const requirement = requirements.get(name) ?? {
        name,
        versions: [],
        askedBy: [],
      }
      if (!requirement.versions.includes(version)) {
        requirement.versions.push(version)
      }
      if (!requirement.askedBy.includes(galaxyFile)) {
        requirement.askedBy.push(galaxyFile)
      }
      requirements.set(name, requirement)
    }
  }
  return [...requirements.values()]
}

// One requirements file for all of them, so the resolver sees every range
// together: an entry per range, none for `*` (any version)
export const requirementsOf = (requirements: Requirement[]) =>
  [
    'collections:',
    ...requirements.flatMap(({ name, versions }) => {
      const ranges = versions.filter((version) => version !== '*')
      return (ranges.length > 0 ? ranges : [null]).map((version) =>
        [
          `  - name: ${JSON.stringify(name)}`,
          ...(version === null
            ? []
            : [`    version: ${JSON.stringify(version)}`]),
        ].join('\n'),
      )
    }),
    '',
  ].join('\n')

const describe = ({ name, versions, askedBy }: Requirement) => {
  const ranges = versions.filter((version) => version !== '*')
  return `${name}${ranges.length > 0 ? ` ${ranges.join(', ')}` : ''} (${askedBy.join(', ')})`
}

// Installs them with ansible-galaxy, into GALAXY_DIR. One already there, or
// anywhere Ansible looks, is skipped, unless upgrade (`local-env update`).
// The requirements file goes in the run's folder. What it installed, as
// "<name> <version>".
export const installGalaxyCollections = async (
  requirements: Requirement[],
  runFolder: string,
  {
    upgrade = false,
    verbose = false,
  }: { upgrade?: boolean; verbose?: boolean },
) => {
  if (requirements.length === 0) return []
  const file = join(runFolder, 'requirements.yml')
  writeFileSync(file, requirementsOf(requirements), { mode: 0o600 })
  const args = [
    'collection',
    'install',
    '-r',
    file,
    ...(upgrade ? ['--upgrade'] : []),
  ]
  // In the path, not with -p: ansible-galaxy warns that a -p folder is not
  // where Ansible looks. Only ours: one of the ansible package counts as
  // installed, one in ~/.ansible doesn't.
  const env = { ANSIBLE_COLLECTIONS_PATH: GALAXY_DIR }
  const failed = () =>
    new Error(
      [
        'Could not install the collections your tools need from Galaxy:',
        ...requirements.map((requirement) => `  ${describe(requirement)}`),
        'Check your network, and that these versions exist.',
      ].join('\n'),
    )
  if (verbose) {
    const { exitCode } = await execa('ansible-galaxy', args, {
      stdio: 'inherit',
      reject: false,
      env,
    })
    if (exitCode !== 0) throw failed()
    return []
  }
  // Its own group, a spinner under it, then a line per collection, like the
  // playbook's tasks (playbook-output.ts)
  logger.group('Collections from Galaxy')
  const progress = canRedraw() ? spinner({ withGuide: false }) : null
  progress?.start(
    `Installing ${requirements.map(({ name }) => name).join(', ')}`,
  )
  const child = execa('ansible-galaxy', args, { all: true, reject: false, env })
  const output: string[] = []
  for await (const line of child.iterable({ from: 'all' })) output.push(line)
  const { exitCode } = await child
  progress?.clear()

  if (exitCode !== 0) {
    logger.log(`${styleText('red', '✗')} ${styleText('red', 'Install')}`)
    logger.log(styleText('red', output.slice(-FAILURE_TAIL).join('\n')))
    throw failed()
  }
  const installed: string[] = []
  for (const result of galaxyResults(requirements, output)) {
    const { name } = result
    const version = result.version ?? installedVersion(name)
    if (result.installed) {
      installed.push(`${name}${version ? ` ${version}` : ''}`)
    }
    logger.log(galaxyLine(name, version, result.installed))
  }
  return installed
}

// A collection's line: a green ✓ when it was installed now, dimmed when it
// was there already, like the playbook's tasks
export const galaxyLine = (
  name: string,
  version: string | null,
  installed: boolean,
) => {
  const named = `${name}${version ? ` ${version}` : ''}`
  return installed
    ? `${styleText('green', '✓')} ${named}  ${styleText('dim', 'installed')}`
    : `${styleText('dim', '✓')} ${styleText('dim', named)}  ${styleText('dim', 'already installed')}`
}

const INSTALLED = /^(\S+?):(\S+) was installed successfully/
const PRESENT = /^'(\S+?):(\S+)' is already installed, skipping/

// What ansible-galaxy did for each collection, from its output: the asked
// ones first, then those it brought as their dependencies. Without a line
// ("Nothing to do"), one was there already.
export const galaxyResults = (
  requirements: Requirement[],
  output: string[],
) => {
  const found = new Map<string, { version: string; installed: boolean }>()
  for (const line of output) {
    const match = INSTALLED.exec(line.trim()) ?? PRESENT.exec(line.trim())
    if (match) {
      found.set(match[1]!, {
        version: match[2]!,
        installed: INSTALLED.test(line.trim()),
      })
    }
  }
  const asked = requirements.map(({ name }) => name)
  return [
    ...asked.map((name) => ({
      name,
      version: found.get(name)?.version ?? null,
      installed: found.get(name)?.installed ?? false,
    })),
    // Brought by those: shown when they are new
    ...[...found]
      .filter(([name, { installed }]) => installed && !asked.includes(name))
      .map(([name, { version }]) => ({ name, version, installed: true })),
  ]
}

// Same check as utils/task.ts: clack can't redraw without a terminal width
const canRedraw = () =>
  process.stdout.isTTY === true && (process.stdout.columns ?? 0) > 0

// Lines of output shown when the install fails
const FAILURE_TAIL = 20

// The version of a collection installed in GALAXY_DIR (MANIFEST.json): null
// for one of the ansible package, or a URL
const installedVersion = (name: string) => {
  const [namespace, collection, ...rest] = name.split('.')
  if (!namespace || !collection || rest.length > 0) return null
  try {
    const manifest = JSON.parse(
      readFileSync(
        join(
          GALAXY_DIR,
          'ansible_collections',
          namespace,
          collection,
          'MANIFEST.json',
        ),
        'utf8',
      ),
    )
    const version = manifest?.collection_info?.version
    return typeof version === 'string' ? version : null
  } catch {
    // Not installed there
    return null
  }
}

// The folder of a Galaxy role installed in GALAXY_DIR
const findGalaxyRole = (name: string) => {
  const [namespace, collection, role, ...rest] = name.split('.')
  if (!namespace || !collection || !role || rest.length > 0) return null
  const dir = join(
    GALAXY_DIR,
    'ansible_collections',
    namespace,
    collection,
    'roles',
    role,
  )
  return existsSync(dir) ? dir : null
}

// The Galaxy roles the run includes, and those they include, whose tasks use
// sudo: read once installed. Their names.
export const galaxyRolesNeedingSudo = (external: ExternalRole[]) => {
  const sudo: string[] = []
  const seen = new Set<string>()
  const queue = external
    .filter(({ kind }) => kind === 'galaxy')
    .map(({ name }) => name)
  for (let name = queue.shift(); name; name = queue.shift()) {
    if (seen.has(name)) continue
    seen.add(name)
    const dir = findGalaxyRole(name)
    if (!dir) continue
    const { needsSudo, dependencies } = readRoleDir(dir)
    if (needsSudo) sudo.push(name)
    const collection = name.split('.').slice(0, 2).join('.')
    // A short name is a role of the same collection
    queue.push(
      ...dependencies.map((dependency) =>
        dependency.includes('.') ? dependency : `${collection}.${dependency}`,
      ),
    )
  }
  return sudo
}
