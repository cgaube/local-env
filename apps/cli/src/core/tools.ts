import { execa } from 'execa'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import {
  type Installed,
  listCollections,
  listRoles,
  playbookOf,
  readInstalled,
  readProfile,
  readSelection,
  type Role,
  writeInstalled,
  writeProfile,
  writeSelection,
} from '#services/dashboard/tools.js'
import { playbookRoots, wantedRoles } from '#services/dashboard/role-graph.js'
import { SOURCES_DIR } from '#cli/sources/sources.js'
import { logger } from '#cli/utils/logger.js'
import { askPassword } from '#cli/utils/prompt.js'
import { HOME_DIR } from '#cli/core/paths.js'
import { createRunFolder } from '#cli/core/run-folder.js'
import {
  type PlaybookSummary,
  renderPlaybook,
} from '#cli/core/playbook-output.js'

// The tools picked in the dashboard (volumes/tools/playbook.yml), the profile
// (profile.json) and the installs that ran: services/dashboard/tools.ts
export const TOOLS_DIR = resolve(HOME_DIR, 'volumes/tools')

export type PickedTools = {
  roles: Role[]
  // Picked, but no longer in any source
  missing: string[]
}

export const readPickedTools = (catalog: Role[]): PickedTools => {
  const byId = new Map(catalog.map((role) => [role.id, role]))
  const picked = readSelection(TOOLS_DIR, catalog)
  return {
    roles: picked.flatMap((id) => byId.get(id) ?? []),
    missing: picked.filter((id) => !byId.has(id)),
  }
}

export const listCatalog = () => listRoles(SOURCES_DIR)

// Drops picks whose role left the sources: Ansible would stop on their path
export const unpickTools = (catalog: Role[], ids: string[]) =>
  writeSelection(
    TOOLS_DIR,
    catalog,
    readSelection(TOOLS_DIR, catalog).filter((id) => !ids.includes(id)),
  )

// The saved profile. One that left the sources is dropped, with the id it
// had, so the caller can say so.
export const readSavedProfile = (
  catalog: Role[],
): { profile: Role | null; gone: string | null } => {
  const id = readProfile(TOOLS_DIR)
  if (!id) return { profile: null, gone: null }
  const profile = catalog.find((role) => role.id === id && role.isProfile)
  if (profile) return { profile, gone: null }
  saveProfile(null)
  return { profile: null, gone: id }
}

export const saveProfile = (profile: Role | null) => {
  mkdirSync(TOOLS_DIR, { recursive: true })
  writeProfile(TOOLS_DIR, profile?.id ?? null)
}

export const listProfiles = (catalog: Role[]) =>
  catalog.filter((role) => role.isProfile)

// The name to type: a collection's role without its collection
export const shortName = (role: Role) => role.name.split('.').at(-1)!

// A profile by its name (backend, cgaube.profiles.backend) or its label, or
// by <source>/<name> when two sources have one
export const findProfile = (catalog: Role[], name: string): Role => {
  const matches = catalog.filter((role) =>
    name.includes('/')
      ? role.id === name
      : [role.name, shortName(role)].includes(name) ||
        role.label.toLowerCase() === name.toLowerCase(),
  )
  const profiles = matches.filter((role) => role.isProfile)
  if (profiles.length > 1) {
    throw new Error(
      `${name} is a profile in several sources: name one of ${profiles.map(({ id }) => id).join(', ')}.`,
    )
  }
  const [profile] = profiles
  if (profile) return profile
  if (matches.length > 0) {
    throw new Error(
      `${name} is a tool, not a profile: pick it in the dashboard (Tools).`,
    )
  }
  const known = listProfiles(catalog).map(shortName)
  throw new Error(
    known.length > 0
      ? `No profile named ${name}. Profiles: ${known.join(', ')}.`
      : `No profile named ${name}: your sources have no profile.`,
  )
}

// Tools no longer wanted (picked, in the profile, or included by those) stay
// on the Mac: local-env doesn't uninstall. Forgets them, so the dashboard no
// longer lists them as installed. Their ids.
export const forgetUnwanted = (catalog: Role[], roots: Role[]) => {
  const wanted = wantedRoles(
    catalog,
    roots.map(({ id }) => id),
  )
  const installed = readInstalled(TOOLS_DIR)
  const forgotten = Object.keys(installed).filter((id) => !wanted.has(id))
  if (forgotten.length > 0) {
    for (const id of forgotten) delete installed[id]
    writeInstalled(TOOLS_DIR, installed)
  }
  return forgotten
}

// The roots and the roles they include, in catalog order
const withDependencies = (catalog: Role[], roots: Role[]) => {
  const wanted = wantedRoles(
    catalog,
    roots.map(({ id }) => id),
  )
  return catalog.filter(({ id }) => wanted.has(id))
}

// Ansible finds a collection only at ansible_collections/<namespace>/<name>,
// and a source has it at ansible/<folder>: links each collection of the
// sources there, in this folder. Of two sources with the same collection, the
// first one is linked. The folder, for ANSIBLE_COLLECTIONS_PATH.
const linkCollections = (catalog: Role[], dir: string) => {
  for (const source of new Set(catalog.map((role) => role.source))) {
    const ansible = join(SOURCES_DIR, source, 'ansible')
    for (const { folder, name } of listCollections(ansible)) {
      const [namespace = '', collection = ''] = name.split('.')
      const link = join(dir, 'ansible_collections', namespace, collection)
      if (existsSync(link)) continue
      mkdirSync(join(dir, 'ansible_collections', namespace), {
        recursive: true,
      })
      symlinkSync(join(ansible, folder), link)
    }
  }
  return dir
}

// Runs the roots (the profile, then the picked roles) on this Mac, as you,
// drawn like the rest of the CLI (playbook-output.ts), or with Ansible's own
// output when verbose. Their playbook is written to a folder only you can
// read, removed once Ansible is done, or stopped (run-folder.ts). A role that
// uses sudo makes local-env ask for your password first: Ansible reads it
// from a file there. Records what ran, for the dashboard.
export const runPlaybook = async (
  catalog: Role[],
  roots: Role[],
  { verbose = false }: { verbose?: boolean } = {},
): Promise<PlaybookSummary | null> => {
  // What Ansible runs: the roots and the ones they include
  const run = withDependencies(catalog, roots)
  const sudo = run.filter((role) => role.needsSudo)
  const password =
    sudo.length > 0
      ? await askPassword(
          `Your password, for sudo (${sudo.map(({ label }) => label).join(', ')})`,
        )
      : null

  // Its playbook and the password, removed once Ansible is done, on Ctrl-C
  // too (run-folder.ts)
  using folder = createRunFolder()
  const collections = linkCollections(catalog, join(folder.path, 'collections'))
  const playbook = join(folder.path, 'playbook.yml')
  const args = ['--inventory', 'localhost,', playbook]
  writeFileSync(
    playbook,
    // Each role once: a pick the profile includes is not named again
    playbookOf(
      playbookRoots(
        catalog,
        roots.map(({ id }) => id),
      ).map((id) => {
        const role = catalog.find((other) => other.id === id)!
        // A collection's role by its name, so it runs in its collection; a
        // plain role by its path
        return role.collection
          ? role.name
          : join(SOURCES_DIR, role.source, 'ansible', role.folder)
      }),
    ),
    { mode: 0o600 },
  )
  const env: Record<string, string> = {
    // The collections of the sources first, then where Ansible looks anyway
    ANSIBLE_COLLECTIONS_PATH: [
      collections,
      process.env.ANSIBLE_COLLECTIONS_PATH ||
        `${join(homedir(), '.ansible/collections')}:/usr/share/ansible/collections`,
    ].join(':'),
    // Dependencies are named, not paths: every source's plain roles
    ANSIBLE_ROLES_PATH: [
      ...new Set(
        catalog.map(({ source }) => join(SOURCES_DIR, source, 'ansible')),
      ),
    ].join(':'),
    // The Python that runs Ansible, without the discovery warning
    ANSIBLE_PYTHON_INTERPRETER: 'auto_silent',
    ANSIBLE_LOCALHOST_WARNING: 'false',
  }
  if (password) {
    const file = join(folder.path, 'become')
    // Not executable: Ansible would run it to get the password
    writeFileSync(file, `${password}\n`, { mode: 0o600 })
    env.ANSIBLE_BECOME_PASSWORD_FILE = file
  }

  // null with Ansible's own output, which has its recap
  let summary: PlaybookSummary | null = null
  if (verbose) {
    const child = execa('ansible-playbook', args, { stdio: 'inherit', env })
    // A terminal's Ctrl-C reaches Ansible too, a kill doesn't
    folder.onSignal((signal) => child.kill(signal))
    await child
  } else {
    const child = execa('ansible-playbook', args, {
      stdin: 'ignore',
      reject: false,
      env: { ...env, ANSIBLE_STDOUT_CALLBACK: 'ansible.posix.jsonl' },
    })
    folder.onSignal((signal) => child.kill(signal))
    summary = await renderPlaybook(child.iterable({ from: 'stdout' }))
    const { exitCode, stderr } = await child
    if (exitCode !== 0) {
      // Ansible's own errors (a role it can't find, a YAML error) come
      // before any task: they are only in its stderr
      if (summary.failed === 0 && stderr) {
        logger.log(String(stderr).trim().split('\n').slice(-10).join('\n'))
      }
      throw new Error(`ansible-playbook exited with ${exitCode}`)
    }
  }

  const installedAt = new Date().toISOString()
  const installed: Installed = readInstalled(TOOLS_DIR)
  for (const { id, revision } of run) {
    installed[id] = { revision, installedAt }
  }
  mkdirSync(TOOLS_DIR, { recursive: true })
  writeInstalled(TOOLS_DIR, installed)
  return summary
}
