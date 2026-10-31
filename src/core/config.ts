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

export const readConfig = (): Config => {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG }
  try {
    return {
      ...DEFAULT_CONFIG,
      ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')),
    }
  } catch {
    throw new Error(`${CONFIG_PATH} is not valid JSON`)
  }
}

export const writeConfig = (patch: Partial<Config>) => {
  const config = { ...readConfig(), ...patch }
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
  return config
}
