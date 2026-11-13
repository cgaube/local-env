import { styleText } from 'node:util'
import { listSources } from '#cli/sources/sources.js'
import { readSourceLogins } from '#cli/logins/declared.js'
import { SESSION_TYPES } from '#cli/logins/index.js'
import {
  type DockhandRegistry,
  readSourceRegistries,
  registryLoginLine,
} from '#cli/logins/registry.js'
import { sessionLoginLine, sessionStatus } from '#cli/logins/session.js'
import type {
  DeclaredLogin,
  LoginStatus,
  SessionLoginType,
} from '#cli/logins/types.js'

// The logins of the sources as the commands show them: a line each, the
// registries first

export type SessionEntry = {
  type: SessionLoginType<any>
  login: DeclaredLogin<unknown>
}

// The aws and vault logins of a source
export const sourceSessionLogins = (source: string): SessionEntry[] =>
  SESSION_TYPES.flatMap((type) =>
    readSourceLogins(source, type).map((login) => ({ type, login })),
  )

// The sources that declare a login of any type
export const sourcesWithAnyLogin = () =>
  listSources().filter(
    (source) =>
      readSourceRegistries(source).length > 0 ||
      sourceSessionLogins(source).length > 0,
  )

// The status of each session once, when several sources share an account
export const createStatusCache = () => {
  const cache = new Map<string, Promise<LoginStatus>>()
  return ({ type, login }: SessionEntry) => {
    const key = `${type.type}:${login.identity}`
    if (!cache.has(key)) cache.set(key, sessionStatus(type, login))
    return cache.get(key)!
  }
}

// A line for each login of the source. `registries` is undefined when
// Dockhand can't be reached.
export const sourceLoginLines = async (
  source: string,
  registries: DockhandRegistry[] | undefined,
  status = createStatusCache(),
) => [
  ...readSourceRegistries(source).map((login) =>
    registryLoginLine(source, login, registries),
  ),
  ...(await Promise.all(
    sourceSessionLogins(source).map(async (entry) =>
      sessionLoginLine(entry.type, entry.login, await status(entry)),
    ),
  )),
]

// A login that works, in `local-env login`: its name, what it is (dim: the
// account or the host), its state. What the run changed is in cyan.
export const loginLineText = (
  ref: string,
  detail: string,
  state: string,
  changed = false,
) =>
  `${styleText('green', '✔')} ${ref}  ${styleText('dim', detail)}  ${changed ? styleText('cyan', state) : state}`
