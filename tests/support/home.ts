import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Config } from '../../src/core/config.js'
import { buildCertificate } from './factories/certificate.js'
import { buildConfig } from './factories/config.js'

// A LOCAL_ENV_HOME for one test, with helpers to seed and read its state
export const createHome = (dir: string) => {
  mkdirSync(dir, { recursive: true })

  const path = (relative: string) => join(dir, relative)

  const write = (relative: string, content: string) => {
    mkdirSync(dirname(path(relative)), { recursive: true })
    writeFileSync(path(relative), content)
  }

  const writeJson = (relative: string, data: unknown) =>
    write(relative, `${JSON.stringify(data, null, 2)}\n`)

  return {
    dir,
    path,
    exists: (relative: string) => existsSync(path(relative)),
    read: (relative: string) => readFileSync(path(relative), 'utf8'),
    readJson: <T = unknown>(relative: string) =>
      JSON.parse(readFileSync(path(relative), 'utf8')) as T,
    write,
    writeJson,

    // A home where `local-env setup` has run
    seedConfig: (overrides: Partial<Config> = {}) =>
      writeJson('config.json', buildConfig(overrides)),
    // The certificate `setup` creates for the configured domain
    seedCertificate: (state: 'valid' | 'expired' = 'valid') => {
      const { domain, cert, key } = buildCertificate(state)
      write(`services/proxy/certs/${domain}.crt`, cert)
      write(`services/proxy/certs/${domain}.key`, key)
    },
    seedRoutes: (routes: unknown[]) =>
      writeJson('volumes/proxy/routes.json', routes),
    seedLinks: (links: Record<string, unknown>) =>
      writeJson('volumes/template-links.json', links),
  }
}

export type Home = ReturnType<typeof createHome>
