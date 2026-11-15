import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { HOME_DIR } from '#cli/core/paths.js'
import { hasCommand } from '#cli/utils/brew.js'
import { runTask } from '#cli/utils/task.js'

// local-env's own Ansible: ansible-core, pinned, installed with uv into the
// home folder. Not Homebrew's `ansible` (about 600 MB of collections local-env
// doesn't use), and never the user's own: every Mac runs the version that
// `bun run test:ansible` tests. The roles' collections come from Galaxy
// (galaxy-collections.ts). docs/3-how-it-works/tools-and-profiles.md says
// why.

// Bump with tests/support/ansible-samples.ts (test:ansible), which tests it
export const ANSIBLE_CORE_VERSION = '2.22.0'
// The Python uv installs for it: its own, never the Mac's
export const ANSIBLE_PYTHON_VERSION = '3.13'

export const ANSIBLE_DIR = join(HOME_DIR, 'volumes/ansible')
const TOOLS_DIR = join(ANSIBLE_DIR, 'tools')
const BIN_DIR = join(ANSIBLE_DIR, 'bin')
const PYTHON_DIR = join(ANSIBLE_DIR, 'python')
// What the last install installed: compared with the pins
export const ANSIBLE_VERSION_FILE = join(ANSIBLE_DIR, 'version')

export const ANSIBLE_PIN = `${ANSIBLE_CORE_VERSION} python ${ANSIBLE_PYTHON_VERSION}`

// The path of one of its commands: ansible-playbook, ansible-galaxy
export const ansibleBin = (command: string) => join(BIN_DIR, command)

// Its own Python, for the tasks on this Mac too: no interpreter discovery,
// which finds whatever python3 the Mac has (or a stub that asks to install
// the Command Line Tools)
export const ANSIBLE_PYTHON = join(TOOLS_DIR, 'ansible-core/bin/python')

export type AnsibleState = 'ready' | 'missing' | 'outdated'

export const ansibleState = (): AnsibleState => {
  if (
    !existsSync(ansibleBin('ansible-playbook')) ||
    !existsSync(ANSIBLE_VERSION_FILE)
  )
    return 'missing'
  return readFileSync(ANSIBLE_VERSION_FILE, 'utf8').trim() === ANSIBLE_PIN
    ? 'ready'
    : 'outdated'
}

const uvEnv = () => ({
  UV_TOOL_DIR: TOOLS_DIR,
  UV_TOOL_BIN_DIR: BIN_DIR,
  UV_PYTHON_INSTALL_DIR: PYTHON_DIR,
  // Its own Python, the same on every Mac
  UV_PYTHON_PREFERENCE: 'only-managed',
})

// Installs the pinned ansible-core when it is missing or another version.
// setup, update, install and the bootstraps call it: a new local-env that
// pins another version moves to it at the next one of them. Its state
// before: 'ready' when it did nothing.
export const ensureAnsible = async (): Promise<AnsibleState> => {
  const state = ansibleState()
  if (state === 'ready') return state
  if (!(await hasCommand('uv'))) {
    throw new Error(
      'local-env installs Ansible with uv, which is missing. Run `brew install uv`, or `local-env setup`.',
    )
  }
  mkdirSync(ANSIBLE_DIR, { recursive: true })
  await runTask(
    state === 'missing'
      ? `Installing ansible-core ${ANSIBLE_CORE_VERSION}`
      : `Updating ansible-core to ${ANSIBLE_CORE_VERSION}`,
    'uv',
    [
      'tool',
      'install',
      '--python',
      ANSIBLE_PYTHON_VERSION,
      `ansible-core==${ANSIBLE_CORE_VERSION}`,
    ],
    { done: `ansible-core ${ANSIBLE_CORE_VERSION} installed`, env: uvEnv() },
  )
  writeFileSync(ANSIBLE_VERSION_FILE, `${ANSIBLE_PIN}\n`)
  return state
}

// For doctor: whether install can run, without installing anything
export const describeAnsible = () => {
  switch (ansibleState()) {
    case 'ready':
      return {
        ok: true,
        message: `ansible-core ${ANSIBLE_CORE_VERSION} installed`,
      }
    case 'outdated':
      return {
        ok: false,
        message: `ansible-core is not ${ANSIBLE_CORE_VERSION}: \`local-env update\` updates it`,
      }
    case 'missing':
      return {
        ok: false,
        message:
          'ansible-core is not installed: `local-env setup` or `local-env update` installs it',
      }
  }
}
