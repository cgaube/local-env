import { execa } from 'execa'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  type Installed,
  listRoles,
  PLAYBOOK_FILE,
  readInstalled,
  readSelection,
  type Role,
  writeInstalled,
  writeSelection,
} from '#services/dashboard/tools.js'
import { SOURCES_DIR } from '../sources/sources.js'
import { logger } from '../utils/logger.js'
import { askPassword } from '../utils/prompt.js'
import { HOME_DIR } from './paths.js'
import { type PlaybookSummary, renderPlaybook } from './playbook-output.js'

// The tools picked in the dashboard (volumes/tools/playbook.yml) and the
// installs that ran: services/dashboard/tools.ts
export const TOOLS_DIR = resolve(HOME_DIR, 'volumes/tools')

export type PickedTools = {
  roles: Role[]
  // Picked, but no longer in any source
  missing: string[]
}

export const readPickedTools = (): PickedTools => {
  const catalog = new Map(listRoles(SOURCES_DIR).map((role) => [role.id, role]))
  const picked = readSelection(TOOLS_DIR)
  return {
    roles: picked.flatMap((id) => catalog.get(id) ?? []),
    missing: picked.filter((id) => !catalog.has(id)),
  }
}

// Drops picks whose role left the sources: Ansible would stop on their path
export const unpickTools = (ids: string[]) =>
  writeSelection(
    TOOLS_DIR,
    readSelection(TOOLS_DIR).filter((id) => !ids.includes(id)),
  )

// Tools no longer picked, nor included by a pick, stay on the Mac: local-env
// doesn't uninstall. Forgets them, so the dashboard no longer lists them as
// installed. Their ids.
export const forgetUnpicked = (roles: Role[]) => {
  const wanted = new Set(withDependencies(roles).map(({ id }) => id))
  const installed = readInstalled(TOOLS_DIR)
  const forgotten = Object.keys(installed).filter((id) => !wanted.has(id))
  if (forgotten.length > 0) {
    for (const id of forgotten) delete installed[id]
    writeInstalled(TOOLS_DIR, installed)
  }
  return forgotten
}

// The roles and those they depend on, by name, in any source
const withDependencies = (roles: Role[]) => {
  const all = listRoles(SOURCES_DIR)
  const found = new Map(roles.map((role) => [role.id, role]))
  const queue = [...roles]
  for (let role = queue.shift(); role; role = queue.shift()) {
    for (const name of role.dependencies) {
      for (const dependency of all.filter((other) => other.name === name)) {
        if (found.has(dependency.id)) continue
        found.set(dependency.id, dependency)
        queue.push(dependency)
      }
    }
  }
  return [...found.values()]
}

// Runs the playbook on this Mac, as you, drawn like the rest of the CLI
// (playbook-output.ts), or with Ansible's own output when verbose. A role
// that uses sudo makes local-env ask for your password first: Ansible reads
// it from a file only you can read, removed once the run ends. Records what
// ran, for the dashboard.
export const runPlaybook = async (
  roles: Role[],
  { verbose = false }: { verbose?: boolean } = {},
): Promise<PlaybookSummary | null> => {
  const args = ['--inventory', 'localhost,', join(TOOLS_DIR, PLAYBOOK_FILE)]
  // What Ansible runs: the picked roles and the ones they include
  const run = withDependencies(roles)
  const sudo = run.filter((role) => role.needsSudo)
  const password =
    sudo.length > 0
      ? await askPassword(
          `Your password, for sudo (${sudo.map(({ name }) => name).join(', ')})`,
        )
      : null

  const secrets = password ? mkdtempSync(join(tmpdir(), 'local-env-')) : null
  // null with Ansible's own output, which has its recap
  let summary: PlaybookSummary | null = null
  try {
    const env: Record<string, string> = {
      // Dependencies are named, not paths: every source's roles
      ANSIBLE_ROLES_PATH: [
        ...new Set(
          listRoles(SOURCES_DIR).map(({ source }) =>
            join(SOURCES_DIR, source, 'ansible'),
          ),
        ),
      ].join(':'),
      // The Python that runs Ansible, without the discovery warning
      ANSIBLE_PYTHON_INTERPRETER: 'auto_silent',
      ANSIBLE_LOCALHOST_WARNING: 'false',
    }
    if (secrets && password) {
      const file = join(secrets, 'become')
      // Not executable: Ansible would run it to get the password
      writeFileSync(file, `${password}\n`, { mode: 0o600 })
      env.ANSIBLE_BECOME_PASSWORD_FILE = file
    }

    if (verbose) {
      await execa('ansible-playbook', args, { stdio: 'inherit', env })
    } else {
      const child = execa('ansible-playbook', args, {
        stdin: 'ignore',
        reject: false,
        env: { ...env, ANSIBLE_STDOUT_CALLBACK: 'ansible.posix.jsonl' },
      })
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
  } finally {
    if (secrets) rmSync(secrets, { recursive: true, force: true })
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
