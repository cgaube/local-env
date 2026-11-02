import { existsSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = fileURLToPath(import.meta.url)

// A compiled binary runs from Bun's virtual /$bunfs
export const IS_COMPILED = here.startsWith('/$bunfs/')

// The root of a repo checkout: what LOCAL_ENV_HOME points at to run the
// working tree in place
export const isCheckout = (dir: string) =>
  existsSync(join(dir, 'apps/cli/src/main.ts'))

// The repo checkout the CLI was started from, if any: the source tree under
// `bun run local-env`, or the folder of a `./local-env` built by
// `bun install`. Older versions kept their state there.
export const CHECKOUT_DIR = IS_COMPILED
  ? isCheckout(dirname(process.execPath))
    ? dirname(process.execPath)
    : null
  : resolve(dirname(here), '../../../..')

// `bun test` without tests/setup.ts, which gives every test a temporary home:
// Bun reads bunfig.toml only from the folder it runs in. The tests would
// write to ~/.local-env.
if (
  process.env.NODE_ENV === 'test' &&
  process.versions.bun &&
  !IS_COMPILED &&
  !process.env.LOCAL_ENV_HOME
) {
  throw new Error(
    'LOCAL_ENV_HOME is not set: run the tests from the repo root, where bunfig.toml preloads apps/cli/tests/setup.ts',
  )
}

// Holds the compose file, services, templates and all runtime state. Point
// LOCAL_ENV_HOME at a checkout to run its files in place while developing.
export const HOME_DIR = process.env.LOCAL_ENV_HOME
  ? resolve(process.env.LOCAL_ENV_HOME)
  : join(homedir(), '.local-env')

export const COMPOSE_FILE = resolve(HOME_DIR, 'compose.yaml')
