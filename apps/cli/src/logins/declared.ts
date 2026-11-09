import { resolveInside } from '#cli/core/paths.js'
import { listSources, SOURCES_DIR } from '#cli/sources/sources.js'
import { tryReadSourceManifest } from '#services/dashboard/source-manifest.js'
import {
  type DeclaredLogin,
  isRecord,
  type LoginType,
} from '#cli/logins/types.js'

// The logins that the manifests of the sources declare, for one type at a
// time. An entry that is not valid is left out: `sources add` refuses it,
// and a source pulled since keeps working without it.

export const isValidLoginName = (name: string) =>
  /^[a-z0-9][a-z0-9-]*$/.test(name)

// The valid logins of this type that one source declares, once per identity
export const readSourceLogins = <Config>(
  source: string,
  type: LoginType<Config>,
): DeclaredLogin<Config>[] => {
  const manifest = tryReadSourceManifest(resolveInside(SOURCES_DIR, source))
  const byIdentity = new Map<string, DeclaredLogin<Config>>()
  for (const [name, entry] of Object.entries(manifest?.logins ?? {})) {
    if (!isValidLoginName(name) || !isRecord(entry)) continue
    if (entry.type !== type.type) continue
    let config: Config
    try {
      config = type.parse(entry)
    } catch {
      continue
    }
    const identity = type.identity(config, { source, name })
    // The first declaration of an account wins
    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, { source, name, identity, config })
    }
  }
  return [...byIdentity.values()]
}

// An account that one or more sources need
export type Account<Config> = {
  identity: string
  // As the first source declares it
  config: Config
  login: DeclaredLogin<Config>
  // In the order of the sources
  sources: string[]
}

// Every account of this type that the sources need, once
export const listAccounts = <Config>(
  type: LoginType<Config>,
): Account<Config>[] => {
  const byIdentity = new Map<string, Account<Config>>()
  for (const source of listSources()) {
    for (const login of readSourceLogins(source, type)) {
      const { identity, config } = login
      const account = byIdentity.get(identity) ?? {
        identity,
        config,
        login,
        sources: [],
      }
      if (!account.sources.includes(source)) account.sources.push(source)
      byIdentity.set(identity, account)
    }
  }
  return [...byIdentity.values()]
}

// The sources that declare a login of this type
export const sourcesWithLogins = <Config>(type: LoginType<Config>) =>
  listSources().filter((source) => readSourceLogins(source, type).length > 0)
