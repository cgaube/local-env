import { existsSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = fileURLToPath(import.meta.url)

// A compiled binary runs from Bun's virtual /$bunfs
export const IS_COMPILED = here.startsWith('/$bunfs/')

export const isCheckout = (dir: string) => existsSync(join(dir, 'src/main.ts'))

// The repo checkout the CLI was started from, if any: the source tree under
// `bun run dev`, or the folder of a `./local-env` built by `bun install`.
// Older versions kept their state there.
export const CHECKOUT_DIR = IS_COMPILED
  ? isCheckout(dirname(process.execPath))
    ? dirname(process.execPath)
    : null
  : resolve(dirname(here), '../..')

// Holds the compose file, services, templates and all runtime state. Point
// LOCAL_ENV_HOME at a checkout to run its files in place while developing.
export const HOME_DIR = process.env.LOCAL_ENV_HOME
  ? resolve(process.env.LOCAL_ENV_HOME)
  : join(homedir(), '.local-env')

export const COMPOSE_FILE = resolve(HOME_DIR, 'compose.yaml')
