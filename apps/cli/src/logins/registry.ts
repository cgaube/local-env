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
  isValidLoginName,
  LOGIN_COMMAND,
  listAccounts,
  loginCommandFor,
  readSourceLogins,
  sourcesWithLogins,
} from '#cli/logins/declared.js'
import {
  isIgnored as isIgnoredLogin,
  readRegistryToken,
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
//
// A registry whose tokens expire (AWS ECR) names a session login instead:
// local-env gets a token with its CLI and saves it in Dockhand
// (registry-tokens.ts; the type's `registryToken` says how)
//   ecr:
//     type: registry
//     host: 123456789012.dkr.ecr.us-east-1.amazonaws.com
//     login: acme-dev

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
  // The session login that gets the tokens (an aws login for ECR): `name`,
  // or `source/name` for a login of another source
  login?: string
}

// The region of an ECR host: an ECR token is good for that region only
// "123456789012.dkr.ecr.us-east-1.amazonaws.com" -> "us-east-1"
export const ecrRegion = (host: string) =>
  /^\d{12}\.dkr\.ecr(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/.exec(
    host,
  )?.[1]

const isLoginRef = (ref: string) => {
  const parts = ref.split('/')
  return parts.length <= 2 && parts.every(isValidLoginName)
}

export const registryLogin: LoginType<RegistryConfig> = {
  type: 'registry',
  parse: (entry) => {
    const host = registryHost(requiredText(entry, 'host'))
    if (!host) throw new Error('host is required')
    const usernameHelp = optionalText(entry, 'usernameHelp')
    const tokenHelp = optionalText(entry, 'tokenHelp')
    const login = optionalText(entry, 'login')
    if (login !== undefined) {
      if (!isLoginRef(login)) {
        throw new Error('login must name a login: its name, or <source>/<name>')
      }
      if (usernameHelp || tokenHelp) {
        throw new Error(
          'login gets the token: usernameHelp and tokenHelp are for a login the user types',
        )
      }
    }
    return { host, usernameHelp, tokenHelp, login }
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

// The username of a host that has only one: AWS for an ECR host. Not asked.
export const fixedUsername = (host: string) =>
  ecrRegion(host) ? 'AWS' : undefined

// The username: AWS for an ECR host, else asked, starting with the saved one
export const askUsername = async (
  host: string,
  help?: string,
  saved?: string | null,
) =>
  fixedUsername(host) ??
  (await askText(usernameQuestion(host, help), saved ?? '')).trim()

// A registry as Dockhand returns it. It never returns the password.
export type DockhandRegistry = {
  id: number
  name: string
  url: string
  username?: string | null
  isDefault: boolean
  hasCredentials: boolean
}

// A registry that one or more sources need, with the login that declares it
// first
export type DeclaredRegistry = RegistryConfig & {
  name: string
  source: string
  sources: string[]
}

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
  listAccounts(registryLogin).map(({ config, login, sources }) => ({
    ...config,
    name: login.name,
    source: login.source,
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
  { name, host, login: from }: { name: string; host: string; login?: string },
  registries: DockhandRegistry[] | undefined,
) => {
  const what = `${name}  ${styleText('dim', host)}`
  if (!registries) {
    return `${styleText('dim', '?')} ${what}  ${styleText('dim', "can't reach Dockhand")}`
  }
  const login = findLogin(registries, host)
  if (from) {
    const fix = styleText('dim', loginCommandFor(source, name))
    if (!login) {
      return `${styleText('yellow', S_WARN)} ${what}  no token: ${fix}`
    }
    return isTokenExpired(host)
      ? `${styleText('yellow', S_WARN)} ${what}  ${tokenState(host, from)}: ${fix}`
      : `${styleText('green', '✔')} ${what}  ${tokenState(host, from)}`
  }
  if (login) {
    return `${styleText('green', '✔')} ${what}  logged in as ${login.username}`
  }
  const state = isIgnored(host) ? 'no login, not asked' : 'no login'
  return `${styleText('yellow', S_WARN)} ${what}  ${state}: ${styleText('dim', loginCommandFor(source, name))}`
}

// The token local-env saved for this host has expired
export const isTokenExpired = (host: string, now = new Date()) => {
  const token = readRegistryToken(host)
  return token !== undefined && token.expiresAt <= now
}

// "token from acme-dev, expires in 9 h"
export const tokenState = (host: string, from: string, now = new Date()) => {
  const token = readRegistryToken(host)
  if (!token) return `token from ${from}`
  const hours = Math.floor(
    (token.expiresAt.getTime() - now.getTime()) / 3_600_000,
  )
  if (token.expiresAt <= now) return `token from ${from} expired`
  return `token from ${from}, expires in ${hours < 1 ? 'less than 1 h' : `${hours} h`}`
}

const loginHint = () => `Run \`${LOGIN_COMMAND}\` to log in.`

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
        hint: `${LOGIN_COMMAND} still works`,
      },
    ],
  )
  if (choice === 'never') {
    setIgnored(host, true)
    return false
  }
  if (choice === 'later') return false

  const username = await askUsername(host, usernameHelp)
  const password = (await askPassword(tokenQuestion(host, tokenHelp))).trim()
  try {
    await logInToRegistry(host, username, password)
    logger.success(`Logged in to ${host} as ${username}`)
    return true
  } catch (error) {
    logger.warn(
      `${error instanceof Error ? error.message : String(error)}. ${loginHint()}`,
    )
    return false
  }
}

// Asks for the login of every registry the sources need and Dockhand has no
// login for. Without a terminal, it only says how to log in.
export const registryLoginsStep: DockhandStep = {
  name: 'Registry logins',
  run: async (): Promise<DockhandStepResult> => {
    // A login gets the tokens of these (registryTokensStep)
    const declared = listDeclaredRegistries().filter(({ login }) => !login)
    if (declared.length === 0) return 'unchanged'

    const registries = await getRegistries()
    const missing = declared.filter(
      ({ host }) => !hasLogin(registries, host) && !isIgnored(host),
    )
    if (missing.length === 0) return 'unchanged'

    if (!canAsk()) {
      for (const { host, sources } of missing) {
        logger.warn(
          `${host}: ${sources.join(', ')} needs a login to pull private images. ${loginHint()}`,
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
