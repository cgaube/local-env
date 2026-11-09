import { S_WARN } from '@clack/prompts'
import { styleText } from 'node:util'
import { logger } from '#cli/utils/logger.js'
import { askPassword, askSelect, askText, canAsk } from '#cli/utils/prompt.js'
import {
  dockhandApi,
  dockhandPost,
  dockhandPut,
} from '#cli/providers/docker/api.js'
import type {
  DockhandStep,
  DockhandStepResult,
} from '#cli/providers/docker/types.js'
import {
  listAccounts,
  readSourceLogins,
  sourcesWithLogins,
} from '#cli/logins/declared.js'
import {
  isIgnored as isIgnoredLogin,
  setIgnored as setIgnoredLogin,
} from '#cli/logins/state.js'
import {
  type LoginType,
  optionalText,
  requiredText,
} from '#cli/logins/types.js'

// A registry of private images that the templates of a source pull from, in
// the `logins` of its manifest:
//   ghcr:
//     type: registry
//     host: ghcr.io
//     usernameHelp: your GitHub username
//     tokenHelp: a classic token with read:packages
// The user types a username and a token; Dockhand keeps them and logs in to
// the registry before each deploy.

// Dockhand counts all these names as Docker Hub
const DOCKER_HUB_HOSTS = new Set([
  'docker.io',
  'hub.docker.com',
  'registry.hub.docker.com',
  'index.docker.io',
  'registry-1.docker.io',
  'registry.docker.io',
  'docker.com',
])

// "https://GHCR.io/team/" -> "ghcr.io", "index.docker.io" -> "docker.io"
export const registryHost = (url: string) => {
  const host = url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]!
  return DOCKER_HUB_HOSTS.has(host) ? 'docker.io' : host
}

export type RegistryConfig = {
  // The full host: ghcr.io/team-a and ghcr.io/team-b are the same login
  host: string
  usernameHelp?: string
  tokenHelp?: string
}

export const registryLogin: LoginType<RegistryConfig> = {
  type: 'registry',
  parse: (entry) => {
    const host = registryHost(requiredText(entry, 'host'))
    if (!host) throw new Error('host is required')
    return {
      host,
      usernameHelp: optionalText(entry, 'usernameHelp'),
      tokenHelp: optionalText(entry, 'tokenHelp'),
    }
  },
  identity: ({ host }) => host,
  title: ({ host }) => host,
}

// The prompts show the help of the source: what to give, and where to get
// it
const question = (label: string, host: string, help?: string) =>
  help ? `${label} for ${host} (${help})` : `${label} for ${host}`

export const usernameQuestion = (host: string, help?: string) =>
  question('Username', host, help)

export const tokenQuestion = (host: string, help?: string) =>
  question('Token', host, help)

// A registry as Dockhand returns it. It never returns the password.
export type DockhandRegistry = {
  id: number
  name: string
  url: string
  username?: string | null
  isDefault: boolean
  hasCredentials: boolean
}

// A registry that one or more sources need
export type DeclaredRegistry = RegistryConfig & { sources: string[] }

type RegistryTest = {
  success: boolean
  connectivity: boolean
  authenticated?: boolean | null
  message: string
}

// Dockhand can scope a registry to a path (ghcr.io/team). The CLI only
// manages the registries of a full host.
const hasPath = (url: string) =>
  url
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .includes('/')

// The registries one source needs, once per host, with their login name
export const readSourceRegistries = (source: string) =>
  readSourceLogins(source, registryLogin).map(({ name, config }) => ({
    name,
    ...config,
  }))

// The sources that need a registry login
export const sourcesNeedingLogin = () => sourcesWithLogins(registryLogin)

// The registries all sources need, by host, in the order of the sources
export const listDeclaredRegistries = (): DeclaredRegistry[] =>
  listAccounts(registryLogin).map(({ config, sources }) => ({
    ...config,
    sources,
  }))

export const isIgnored = (host: string) =>
  isIgnoredLogin(registryLogin.type, host)

export const setIgnored = (host: string, ignored: boolean) =>
  setIgnoredLogin(registryLogin.type, host, ignored)

export const getRegistries = () =>
  dockhandApi<DockhandRegistry[]>('/registries')

// The registry of the full host, the one the CLI creates and updates
export const findHostRegistry = (
  registries: DockhandRegistry[],
  host: string,
) =>
  registries.find(
    (registry) => registryHost(registry.url) === host && !hasPath(registry.url),
  )

// Any registry of this host with a login, also one scoped to a path
export const findLogin = (registries: DockhandRegistry[], host: string) =>
  registries.find(
    (registry) =>
      registryHost(registry.url) === host && registry.hasCredentials,
  )

const hasLogin = (registries: DockhandRegistry[], host: string) =>
  findLogin(registries, host) !== undefined

// Dockhand tries the login against the registry. With a registry id, it uses
// the stored login.
export const testRegistryLogin = (
  login:
    | { registryId: number }
    | { url: string; username: string; password: string },
) => dockhandPost<RegistryTest>('/registries/test', login)

// Saves the login in Dockhand, which logs in to the registry before each
// deploy. Only the registry of the full host changes.
export const saveRegistryLogin = async (
  host: string,
  username: string,
  password: string,
): Promise<'created' | 'updated'> => {
  const existing = findHostRegistry(await getRegistries(), host)
  if (existing) {
    await dockhandPut(`/registries/${existing.id}`, {
      name: existing.name,
      url: existing.url,
      username,
      password,
      isDefault: existing.isDefault,
    })
    return 'updated'
  }
  await dockhandPost('/registries', {
    name: host,
    url: host,
    username,
    password,
    isDefault: false,
  })
  return 'created'
}

// Tests the login, then saves it. The token never goes into a message.
export const logInToRegistry = async (
  host: string,
  username: string,
  password: string,
) => {
  if (!username || !password) {
    throw new Error(`A username and a token are needed to log in to ${host}.`)
  }
  const test = await testRegistryLogin({ url: host, username, password })
  if (!test.success) {
    throw new Error(`${host} rejected the login: ${test.message}`)
  }
  setIgnored(host, false)
  return saveRegistryLogin(host, username, password)
}

// One line for a registry login of a source: its name, the host, the state
// and, without a login, the command to log in. `registries` is undefined
// when Dockhand can't be reached.
export const registryLoginLine = (
  source: string,
  { name, host }: { name: string; host: string },
  registries: DockhandRegistry[] | undefined,
) => {
  const what = `${name}  ${styleText('dim', host)}`
  if (!registries) {
    return `${styleText('dim', '?')} ${what}  ${styleText('dim', "can't reach Dockhand")}`
  }
  const login = findLogin(registries, host)
  if (login) {
    return `${styleText('green', '✔')} ${what}  logged in as ${login.username}`
  }
  const state = isIgnored(host) ? 'no login, not asked' : 'no login'
  return `${styleText('yellow', S_WARN)} ${what}  ${state}: ${styleText('dim', `${loginCommandFor(source)} --login ${name}`)}`
}

// The command that logs in to the registries of a source
export const loginCommandFor = (source: string) =>
  `local-env sources login ${source}`

const loginHint = (source: string) =>
  `Run \`${loginCommandFor(source)}\` to log in.`

// Asks for the login of one registry. False when the user does not log in.
const offerLogin = async (declared: DeclaredRegistry) => {
  const { host, usernameHelp, tokenHelp, sources } = declared
  const choice = await askSelect(
    `${host}: ${sources.join(', ')} needs a login to pull private images`,
    [
      { value: 'login', label: 'Log in now' },
      { value: 'later', label: 'Not now', hint: 'asked again next time' },
      {
        value: 'never',
        label: "Don't ask again",
        hint: `${loginCommandFor(sources[0]!)} still works`,
      },
    ],
  )
  if (choice === 'never') {
    setIgnored(host, true)
    return false
  }
  if (choice === 'later') return false

  const username = (
    await askText(usernameQuestion(host, usernameHelp), '')
  ).trim()
  const password = (await askPassword(tokenQuestion(host, tokenHelp))).trim()
  try {
    await logInToRegistry(host, username, password)
    logger.success(`Logged in to ${host} as ${username}`)
    return true
  } catch (error) {
    logger.warn(
      `${error instanceof Error ? error.message : String(error)}. ${loginHint(sources[0]!)}`,
    )
    return false
  }
}

// Asks for the login of every registry the sources need and Dockhand has no
// login for. Without a terminal, it only says how to log in.
export const registryLoginsStep: DockhandStep = {
  name: 'Registry logins',
  run: async (): Promise<DockhandStepResult> => {
    const declared = listDeclaredRegistries()
    if (declared.length === 0) return 'unchanged'

    const registries = await getRegistries()
    const missing = declared.filter(
      ({ host }) => !hasLogin(registries, host) && !isIgnored(host),
    )
    if (missing.length === 0) return 'unchanged'

    if (!canAsk()) {
      for (const { host, sources } of missing) {
        logger.warn(
          `${host}: ${sources.join(', ')} needs a login to pull private images. ${loginHint(sources[0]!)}`,
        )
      }
      return 'unchanged'
    }

    let created = false
    for (const registry of missing) {
      if (await offerLogin(registry)) created = true
    }
    return created ? 'created' : 'unchanged'
  },
}
