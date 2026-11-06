import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cancelFrame } from '#cli/utils/logger.js'

// A folder only you can read (mkdtemp makes it 0700), for the files of one
// Ansible run: its playbook, the links to the collections, a Galaxy
// requirements file. No secret: Ansible gets the sudo password on its stdin
// (tools.ts). Removed when the run ends, on Ctrl-C or a kill too, so runs
// leave nothing behind. A run killed with no chance to clean up (SIGKILL, a
// crash) leaves it: the next run removes the folders whose process is gone.

const PREFIX = 'local-env-install-'
const OWNER_FILE = 'pid'

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const
type Signal = keyof typeof SIGNAL_EXIT_CODES

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // It runs, as another user
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// The folders of runs whose process is gone. One of a run still going (two
// installs at once) stays.
export const removeStaleRunFolders = (parent = tmpdir()) => {
  for (const name of readdirSync(parent)) {
    if (!name.startsWith(PREFIX)) continue
    const dir = join(parent, name)
    const owner = join(dir, OWNER_FILE)
    const pid = existsSync(owner)
      ? Number(readFileSync(owner, 'utf8'))
      : Number.NaN
    if (Number.isInteger(pid) && pid !== process.pid && isRunning(pid)) {
      continue
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

export type RunFolder = {
  path: string
  // Called on a signal, before the folder goes: stops what uses it
  onSignal: (stop: (signal: Signal) => void) => void
  [Symbol.dispose]: () => void
}

// `using folder = createRunFolder()`: removed when the block ends, however
// it ends
export const createRunFolder = (): RunFolder => {
  removeStaleRunFolders()
  const path = mkdtempSync(join(tmpdir(), PREFIX))
  writeFileSync(join(path, OWNER_FILE), String(process.pid))

  let stop: (signal: Signal) => void = () => {}
  const remove = () => rmSync(path, { recursive: true, force: true })
  // A listener replaces the default, which exits at once: exits after
  const handlers = (Object.keys(SIGNAL_EXIT_CODES) as Signal[]).map(
    (signal) =>
      [
        signal,
        () => {
          stop(signal)
          remove()
          cancelFrame('Cancelled')
          process.exit(SIGNAL_EXIT_CODES[signal])
        },
      ] as const,
  )
  for (const [signal, handler] of handlers) process.on(signal, handler)

  return {
    path,
    onSignal: (callback) => {
      stop = callback
    },
    [Symbol.dispose]: () => {
      for (const [signal, handler] of handlers) process.off(signal, handler)
      remove()
    },
  }
}
