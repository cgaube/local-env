import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { logger } from '../utils/logger.js'
import { runTask } from '../utils/task.js'
import {
  CONFIG_PATH,
  isValidDomain,
  normalizeDomain,
  writeConfig,
} from './config.js'
import { CHECKOUT_DIR, HOME_DIR, isCheckout } from './paths.js'
import { readShippedFiles } from './shipped-files.js' with { type: 'macro' }

// Lists the files written by the last sync, so removed ones get cleaned up
const MANIFEST = '.shipped.json'

type Manifest = { hash: string; files: string[] }

// Runtime state, never shipped: moved over from a checkout on first run
const STATE_PATHS = ['.env', 'services/proxy/certs']
const VOLUMES_DIR = 'volumes'

const readManifest = (): Manifest | null => {
  try {
    return JSON.parse(readFileSync(join(HOME_DIR, MANIFEST), 'utf8'))
  } catch {
    return null
  }
}

// Writes the files embedded in this build into the home folder when they
// differ from the last sync
const syncShippedFiles = () => {
  const files = readShippedFiles()
  const hash = Bun.hash(JSON.stringify(files)).toString(16)
  const previous = readManifest()
  if (previous?.hash === hash) return

  for (const stale of previous?.files ?? []) {
    if (!(stale in files)) removeWithEmptyParents(join(HOME_DIR, stale))
  }
  for (const [path, content] of Object.entries(files)) {
    const target = join(HOME_DIR, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const manifest: Manifest = { hash, files: Object.keys(files) }
  writeFileSync(join(HOME_DIR, MANIFEST), JSON.stringify(manifest, null, 2))
}

const removeWithEmptyParents = (file: string) => {
  rmSync(file, { force: true })
  let dir = dirname(file)
  while (dir.startsWith(`${HOME_DIR}/`) && readdirSync(dir).length === 0) {
    rmdirSync(dir)
    dir = dirname(dir)
  }
}

const move = (from: string, to: string) => {
  mkdirSync(dirname(to), { recursive: true })
  try {
    renameSync(from, to)
  } catch {
    // Different disks: rename can't cross them
    cpSync(from, to, { recursive: true })
    rmSync(from, { recursive: true, force: true })
  }
}

// Older versions kept .env, certificates and volumes in the checkout
const migrateFromCheckout = async (checkout: string) => {
  const moves = STATE_PATHS.map((path) => ({
    from: join(checkout, path),
    to: join(HOME_DIR, path),
  }))
  const volumes = join(checkout, VOLUMES_DIR)
  if (existsSync(volumes)) {
    for (const name of readdirSync(volumes)) {
      // .keep stays: it's tracked by git
      if (name === '.keep') continue
      moves.push({
        from: join(volumes, name),
        to: join(HOME_DIR, VOLUMES_DIR, name),
      })
    }
  }

  const pending = moves.filter(
    ({ from, to }) => existsSync(from) && !existsSync(to),
  )
  if (pending.length === 0) return

  logger.info(`Moving local-env data from ${checkout} to ${HOME_DIR}...`)
  // The running containers mount the old folders, and Dockhand holds its
  // database open. A failure here means Docker isn't running: nothing to stop.
  await runTask('Stopping the old stack', 'docker', [
    'compose',
    '-f',
    join(checkout, 'docker-compose.yml'),
    'down',
  ]).catch(() => {})
  for (const { from, to } of pending) move(from, to)
  logger.success(
    `Moved ${pending.length} item(s). Run \`local-env start\` to start from ${HOME_DIR}.`,
  )
}

// Template repos became sources, which hold docker/ and ansible/ folders
const renameLegacyVolumes = () => {
  const legacy = join(HOME_DIR, VOLUMES_DIR, 'templates')
  const sources = join(HOME_DIR, VOLUMES_DIR, 'sources')
  if (!existsSync(legacy) || existsSync(sources)) return

  renameSync(legacy, sources)
  if (readdirSync(sources).length > 0) {
    logger.warn(
      `Moved template repos to ${sources}. Sources keep their templates in a docker/ folder: move them there.`,
    )
  }
}

// The domain moved from .env (DOMAIN=.dev.test) to config.json
const migrateEnvToConfig = () => {
  const envPath = join(HOME_DIR, '.env')
  if (!existsSync(envPath) || existsSync(CONFIG_PATH)) return

  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('DOMAIN='))
  const domain = normalizeDomain(line?.slice('DOMAIN='.length) ?? '')
  writeConfig(isValidDomain(domain) ? { domain } : {})
  rmSync(envPath)
  logger.info(`Moved settings from .env to ${CONFIG_PATH}`)
}

// Bind-mounted by compose.yaml. Created up front, so Docker doesn't
// create them itself
const RUNTIME_DIRS = [
  'volumes/dockhand',
  'volumes/sources',
  'volumes/proxy',
  'volumes/template-snapshots',
  'volumes/build-contexts',
]

export const ensureRuntimeDirs = () => {
  for (const dir of RUNTIME_DIRS) {
    mkdirSync(join(HOME_DIR, dir), { recursive: true })
  }
}

// Run before any command: makes sure the home folder holds the files this
// build ships and the state an older version left in the checkout. Whether
// the running core services are older: src/core/outdated.ts.
export const prepareHome = async () => {
  // A checkout is used in place, as the development setup
  if (isCheckout(HOME_DIR)) return

  mkdirSync(HOME_DIR, { recursive: true })
  if (CHECKOUT_DIR && !process.env.LOCAL_ENV_HOME) {
    await migrateFromCheckout(CHECKOUT_DIR)
  }
  renameLegacyVolumes()
  migrateEnvToConfig()
  syncShippedFiles()
}
