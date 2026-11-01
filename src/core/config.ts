import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { HOME_DIR } from './paths.js'

export const CONFIG_PATH = join(HOME_DIR, 'config.json')

export type Config = {
  // Root domain of the proxied hosts, without a leading dot: `mail` is served
  // at https://mail.<domain>
  domain: string
  // Port on 127.0.0.1 where catalog-server serves template build folders to
  // Docker's builder. Written into stacks that build, so it stays put.
  buildPort: number
}

export const DEFAULT_CONFIG: Config = { domain: 'dev.test', buildPort: 17080 }

// Accepts "dev.test", ".dev.test" or " Dev.Test "
export const normalizeDomain = (value: string) =>
  value.trim().toLowerCase().replace(/^\.+/, '')

export const isValidDomain = (value: string) =>
  /^[a-z0-9]+([.-][a-z0-9]+)*$/.test(value)

export const parseDomain = (raw: string) => {
  const domain = normalizeDomain(raw)
  if (!isValidDomain(domain)) {
    throw new Error(`Invalid domain "${raw}". Expected one like "dev.test".`)
  }
  return domain
}

export const parseBuildPort = (raw: string) => {
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid port "${raw}". Use a number from 1024 to 65535.`)
  }
  return port
}

// Every value read from config.json goes through its parser: the domain
// names files (certificates, /etc/resolver/<domain>), so a hand-edited one
// must not reach them
const PARSERS: { [K in keyof Config]: (raw: string) => Config[K] } = {
  domain: parseDomain,
  buildPort: parseBuildPort,
}

const readStoredConfig = (): Record<string, unknown> => {
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    throw new Error(`${CONFIG_PATH} is not valid JSON`)
  }
}

export type ConfigError = { key: keyof Config; message: string }

// The config, each invalid value replaced by its default, and every error:
// for setup and `config set`, which repair the file
export const checkConfig = () => {
  const stored = readStoredConfig()
  const config = { ...DEFAULT_CONFIG }
  const errors: ConfigError[] = []
  for (const key of Object.keys(PARSERS) as (keyof Config)[]) {
    if (!(key in stored)) continue
    try {
      Object.assign(config, { [key]: PARSERS[key](String(stored[key])) })
    } catch (error) {
      errors.push({ key, message: (error as Error).message })
    }
  }
  return { config, errors }
}

// Throws on an invalid value, listing every one
export const readConfig = (): Config => {
  const { config, errors } = checkConfig()
  if (errors.length > 0) {
    throw new Error(
      errors
        .map(
          ({ key, message }) =>
            `${CONFIG_PATH}: ${message} Fix it with \`local-env config set ${key} <value>\`.`,
        )
        .join('\n'),
    )
  }
  return config
}

// Merges into the file as stored, so it works while a value is invalid
export const writeConfig = (patch: Partial<Config>) => {
  const config = { ...DEFAULT_CONFIG, ...readStoredConfig(), ...patch }
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
}
