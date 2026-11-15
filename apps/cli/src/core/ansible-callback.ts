import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import source from '#cli/core/ansible-callback/local_env.py' with { type: 'text' }

// local-env's own stdout callback (ansible-callback/local_env.py): the
// events that playbook-output.ts draws, as JSON lines. Shipped in the
// binary and written into the run folder for each run, so ansible-core
// alone is enough: no collection gives local-env its output.

export const CALLBACK_NAME = 'local_env'

// Writes it into the run folder, removed with it. The folder, for
// ANSIBLE_CALLBACK_PLUGINS.
export const writeCallback = (runFolder: string) => {
  const folder = join(runFolder, 'callbacks')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, `${CALLBACK_NAME}.py`), source, { mode: 0o600 })
  return folder
}
